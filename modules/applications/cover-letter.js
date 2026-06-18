/**
 * 求职信生成器 —— 为每个职位生成针对性求职信
 */
import { mkdir, writeFile } from 'fs/promises';
import { resolve } from 'path';
import CONFIG from '../shared/config.js';
import { callAI } from '../shared/ai-client.js';

/**
 * 为特定职位生成求职信
 * @param {object} job - 职位信息
 * @param {Array} matchedSkills - 匹配的技能列表
 * @returns {Promise<CoverLetter>}
 */
export async function generateCoverLetter(job, matchedSkills = []) {
  console.log(`[CoverLetter] ✉️  为 "${job.title} @ ${job.company}" 生成求职信...`);

  const userProfile = getUserProfile();

  // AI 生成求职信正文
  const body = await generateBody(job, matchedSkills, userProfile);

  const coverLetter = {
    id: `cl-${job.id}`,
    jobId: job.id,
    jobTitle: job.title,
    company: job.company,
    createdAt: new Date().toISOString(),
    subject: `应聘 ${job.title} - ${userProfile.name}`,
    body,
  };

  // 保存为 HTML
  const htmlPath = await renderCoverLetter(coverLetter, userProfile);

  return { ...coverLetter, htmlPath };
}

/**
 * AI 生成求职信正文
 */
async function generateBody(job, matchedSkills, profile) {
  const systemPrompt = `你是专业的求职顾问。为以下职位写一封求职信正文。
要求：
- 300-500 字，中文
- 结构：开头表达兴趣 → 展示匹配能力 → 说明价值贡献 → 结尾期待面试
- 语气：专业但不僵硬，自信但不自大
- 自然融入职位要求和候选人技能，不要生硬列举
- 研究公司和职位，展示真诚的兴趣`;

  const userMessage = `
职位: ${job.title}
公司: ${job.company}
职位要求: ${(job.requiredSkills || job.rawSkills || []).join('、')}
职位描述: ${job.description || '无'}
匹配技能: ${matchedSkills.map(s => s.name || s).join('、')}

候选人信息:
- 工作年限: ${profile.yearsExperience} 年
- 当前岗位: ${profile.currentRole}
- 城市: ${profile.city}
`.trim();

  const fallback = `
尊敬的招聘负责人：

您好！我在招聘平台看到贵公司正在招聘${job.title}，对这个机会非常感兴趣。

我拥有 ${profile.yearsExperience} 年 ${profile.currentRole} 经验，熟练掌握 ${matchedSkills.slice(0, 5).map(s => s.name || s).join('、')} 等技能，与贵公司的岗位要求高度匹配。

在过去的工作中，我注重代码质量和团队协作，持续关注技术前沿。我相信我的经验和能力能为贵公司带来价值。

非常期待有机会与您进一步沟通。

此致
敬礼
${profile.name}
${profile.phone}
`.trim();

  try {
    const result = await callAI(systemPrompt, userMessage, { body: fallback });
    return typeof result === 'string' ? result : (result.body || fallback);
  } catch {
    return fallback;
  }
}

/**
 * 渲染求职信为 HTML
 */
async function renderCoverLetter(coverLetter, profile) {
  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>求职信 - ${coverLetter.jobTitle}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: "PingFang SC", "Microsoft YaHei", "Helvetica Neue", sans-serif;
      color: #333;
      line-height: 1.8;
      max-width: 700px;
      margin: 40px auto;
      padding: 20px;
      background: #fafafa;
    }
    .letter {
      background: white;
      padding: 48px;
      border-radius: 8px;
      box-shadow: 0 2px 12px rgba(0,0,0,0.08);
    }
    .header { margin-bottom: 32px; padding-bottom: 20px; border-bottom: 2px solid #4A7C59; }
    .header h1 { font-size: 20px; color: #1a1a1a; margin-bottom: 8px; }
    .header .meta { font-size: 14px; color: #888; }
    .body { font-size: 15px; white-space: pre-wrap; }
    .footer {
      margin-top: 40px; padding-top: 20px; border-top: 1px solid #eee;
      font-size: 14px; color: #666;
    }
    .footer p { margin-bottom: 4px; }
  </style>
</head>
<body>
  <div class="letter">
    <div class="header">
      <h1>📨 ${coverLetter.subject}</h1>
      <p class="meta">生成时间: ${coverLetter.createdAt}</p>
    </div>
    <div class="body">${escapeHTML(coverLetter.body)}</div>
    <div class="footer">
      <p>${profile.name}</p>
      <p>📧 ${profile.email}</p>
      <p>📱 ${profile.phone}</p>
    </div>
  </div>
</body>
</html>`;

  const outputDir = resolve(CONFIG.rootDir, 'data', 'cover-letters');
  await mkdir(outputDir, { recursive: true });
  const filename = `cl-${coverLetter.jobId}.html`;
  const filepath = resolve(outputDir, filename);
  await writeFile(filepath, html, 'utf-8');

  return filepath;
}

function getUserProfile() {
  return {
    name: process.env.USER_NAME || '候选人',
    email: process.env.USER_EMAIL || 'candidate@example.com',
    phone: process.env.USER_PHONE || '13800000000',
    city: process.env.USER_CITY || '北京',
    currentRole: process.env.USER_CURRENT_ROLE || '软件工程师',
    yearsExperience: parseInt(process.env.USER_YEARS_EXPERIENCE || '3'),
  };
}

function escapeHTML(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>');
}

// ========== 自执行支持 ==========
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  const testJob = {
    id: 'test-job-001',
    title: '高级前端开发工程师',
    company: '示例科技',
    requiredSkills: ['JavaScript', 'TypeScript', 'React'],
    matchScore: 0.72,
  };
  const matchedSkills = [
    { name: 'JavaScript', level: 'advanced' },
    { name: 'TypeScript', level: 'intermediate' },
    { name: 'React', level: 'advanced' },
  ];
  generateCoverLetter(testJob, matchedSkills).then(cl => {
    console.log(`\n✅ 求职信已生成: ${cl.htmlPath}`);
  }).catch(err => {
    console.error('生成求职信失败:', err);
    process.exit(1);
  });
}

export default { generateCoverLetter };
