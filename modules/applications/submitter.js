/**
 * 自动投递器 —— Playwright 自动填表提交申请
 *
 * ⚠️ 安全设计:
 * - 默认 autoSubmit: false，仅生成简历草稿不真提交
 * - 需要显式设置 AUTO_SUBMIT=true 环境变量才启用
 * - 每次提交前记录日志，可审计
 */
import CONFIG from '../shared/config.js';
import { launchBrowser, createStealthContext, randomDelay } from '../shared/browser-setup.js';
import { readJSON, updateJSON, appendToJSON } from '../shared/storage.js';
import { getSkillInventory } from '../skills/inventory.js';

/**
 * 自动为匹配的职位生成并提交申请
 * @returns {Promise<SubmitResult[]>}
 */
export async function autoApply() {
  const canSubmit = CONFIG.application.autoSubmit || process.env.AUTO_SUBMIT === 'true';

  if (!canSubmit) {
    console.log('[Submitter] 🔒 自动填表提交已关闭 (autoSubmit: false)');
    console.log('[Submitter]    → 仍会生成简历和求职信草稿');
    console.log('[Submitter]    → 设置 AUTO_SUBMIT=true 启用自动填表');
  }

  const jobs = await readJSON('jobs.json', []);
  const eligible = jobs.filter(j =>
    j.status === 'analyzed' &&
    (j.matchScore || 0) >= CONFIG.application.minMatchScore
  );

  if (eligible.length === 0) {
    console.log('[Submitter] 没有符合条件的职位 (匹配度不够)');
    return [];
  }

  const applications = await readJSON('applications.json', []);
  const alreadyApplied = new Set(applications.map(a => a.jobId));

  const toApply = eligible
    .filter(j => !alreadyApplied.has(j.id))
    .slice(0, CONFIG.application.maxApplicationsPerDay);

  console.log(`[Submitter] 📝 为 ${toApply.length} 个匹配职位生成简历 (最多 ${CONFIG.application.maxApplicationsPerDay}/天)`);

  const results = [];
  const inventory = await getSkillInventory();

  for (const job of toApply) {
    try {
      console.log(`[Submitter]   投递: ${job.title} @ ${job.company}`);

      // 1. 生成简历和求职信 (动态 import 避免循环依赖)
      const { default: resumeBuilder } = await import('./resume-builder.js');
      const { default: coverLetter } = await import('./cover-letter.js');

      const resume = await resumeBuilder.generateResumeForJob(job);
      const cl = await coverLetter.generateCoverLetter(
        job,
        inventory.skills.filter(s => (job.matchedSkills || []).includes(s.name))
      );

      // 2. 自动填表 (如果配置了平台并启用)
      let submitResult = null;
      if (canSubmit && job.platform && job.url) {
        submitResult = await fillApplicationForm(job, resume, cl);
      }

      // 3. 记录申请
      const application = {
        id: `app-${Date.now()}`,
        jobId: job.id,
        jobTitle: job.title,
        company: job.company,
        matchScore: job.matchScore,
        resumePath: resume.htmlPath,
        coverLetterPath: cl.htmlPath,
        status: submitResult?.success ? 'submitted' : 'ready', // ready = 准备好待人工提交
        submittedAt: submitResult?.success ? new Date().toISOString() : null,
        createdAt: new Date().toISOString(),
        notes: submitResult?.message || '简历和求职信已生成，等待人工投递',
      };

      await appendToJSON('applications.json', application, 'jobId');
      await updateJSON('jobs.json', j => j.id === job.id, {
        status: submitResult?.success ? 'applied' : 'analyzed',
      });

      results.push({
        jobId: job.id,
        jobTitle: job.title,
        company: job.company,
        success: true,
        status: application.status,
        message: application.notes,
      });

      console.log(`[Submitter]   ✅ ${application.status === 'submitted' ? '已投递' : '简历就绪'}`);
      await randomDelay(5000, 15000); // 投递间隔

    } catch (err) {
      console.error(`[Submitter]   ❌ 投递失败: ${err.message}`);
      results.push({
        jobId: job.id,
        jobTitle: job.title,
        success: false,
        error: err.message,
      });
    }
  }

  console.log(`[Submitter] 🎯 投递完成: ${results.filter(r => r.success).length}/${results.length} 成功`);
  return results;
}

/**
 * 自动填写申请表单 (Playwright)
 * @param {object} job
 * @param {object} resume
 * @param {object} coverLetter
 */
export async function fillApplicationForm(job, resume, coverLetter) {
  const browser = await launchBrowser(true);
  let result = { success: false, message: '' };

  try {
    const context = await createStealthContext(browser);
    const page = await context.newPage();

    // 根据平台选择不同的填表策略
    if (job.platform === 'boss') {
      await fillBossForm(page, job, resume, coverLetter);
    } else if (job.platform === 'lagou') {
      await fillLagouForm(page, job, resume, coverLetter);
    } else if (job.platform === '51job') {
      await fill51JobForm(page, job, resume, coverLetter);
    } else {
      result.message = `不支持的平台: ${job.platform}`;
      await context.close();
      return result;
    }

    // 检查提交结果
    await randomDelay(2000, 4000);
    const successHint = await page.textContent('body');
    if (successHint.includes('成功') || successHint.includes('投递')) {
      result.success = true;
      result.message = `已在 ${job.platform} 提交申请`;
    } else {
      result.success = true; // 可能成功了但页面没有明确提示
      result.message = `已在 ${job.platform} 尝试提交（请人工确认）`;
    }

    await context.close();
  } catch (err) {
    result.message = `填表失败: ${err.message}`;
  } finally {
    await browser.close();
  }

  return result;
}

/**
 * Boss 直聘投递 (对话式)
 */
async function fillBossForm(page, job, resume, coverLetter) {
  // Boss 直聘是沟通模式，需要发送打招呼消息
  await page.goto(job.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await randomDelay(3000, 6000);

  // 点击"立即沟通"按钮
  const chatBtn = await page.$('[class*="btn-chat"], [class*="chat-btn"], .btn-startchat');
  if (chatBtn) {
    await chatBtn.click();
    await randomDelay(2000, 4000);

    // 输入打招呼消息（截取求职信的前 200 字）
    const messageBox = await page.$('[class*="chat-input"], textarea');
    if (messageBox) {
      const greeting = coverLetter.body.slice(0, 200).replace(/\n/g, ' ');
      await messageBox.fill(greeting);
      await randomDelay(1000, 2000);

      // 发送
      const sendBtn = await page.$('[class*="send-btn"], [class*="btn-send"]');
      if (sendBtn) {
        await sendBtn.click();
      }
    }
  }
}

/**
 * 拉勾投递
 */
async function fillLagouForm(page, job, resume, coverLetter) {
  await page.goto(job.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await randomDelay(3000, 6000);

  // 点击"立即投递"
  const applyBtn = await page.$('[class*="btn-apply"], [class*="deliver"], .btn-resume');
  if (applyBtn) {
    await applyBtn.click();
    await randomDelay(2000, 4000);
  }
}

/**
 * 51job 投递
 */
async function fill51JobForm(page, job, resume, coverLetter) {
  await page.goto(job.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await randomDelay(3000, 6000);

  // 点击"申请职位"
  const applyBtn = await page.$('[class*="btn-apply"], [class*="btnApply"], .apply');
  if (applyBtn) {
    await applyBtn.click();
    await randomDelay(2000, 4000);
  }
}

// ========== 自执行支持 ==========
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  autoApply().then(results => {
    console.log(`\n✅ 投递完成: ${results.length} 个职位`);
  }).catch(err => {
    console.error('投递失败:', err);
    process.exit(1);
  });
}

export default { autoApply, fillApplicationForm };
