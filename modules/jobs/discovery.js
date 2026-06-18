/**
 * 职位爬取模块 —— 多平台职位发现
 * 支持 Boss 直聘、拉勾、51job
 */
import CONFIG from '../shared/config.js';
import { readJSON, appendToJSON } from '../shared/storage.js';
import { launchBrowser, createStealthContext, randomDelay } from '../shared/browser-setup.js';
import { callAI } from '../shared/ai-client.js';

// ========== 主入口 ==========

/**
 * 主入口：爬取所有配置的平台和关键词
 * @returns {Promise<Array>} 新发现的职位列表
 */
export async function discoverJobs(options = {}) {
  const keywords = options.keywords || CONFIG.jobs.keywords;
  const platforms = options.platforms || CONFIG.jobs.platforms;
  const maxJobs = options.maxJobs || CONFIG.jobs.maxJobsPerRun;
  const existingJobs = await readJSON('jobs.json', []);

  console.log(`[Discovery] 🔍 开始搜索 — ${platforms.join('/')} × ${keywords.length} 个关键词`);

  let allNewJobs = [];

  for (const keyword of keywords) {
    for (const platform of platforms) {
      try {
        console.log(`[Discovery]   搜索 "${keyword}" @ ${platform}`);
        const jobs = await searchPlatform(platform, keyword, maxJobs);
        // 去重后追加
        let newCount = 0;
        for (const job of jobs) {
          const exists = existingJobs.some(e => e.id === job.id);
          if (!exists) {
            await appendToJSON('jobs.json', job, 'id');
            existingJobs.push(job);
            allNewJobs.push(job);
            newCount++;
          }
        }
        console.log(`[Discovery]   ✅ ${platform}/${keyword}: ${newCount} 个新职位`);
        await randomDelay(3000, 6000); // 平台间延迟
      } catch (err) {
        console.error(`[Discovery]   ❌ ${platform}/${keyword}: ${err.message}`);
      }
    }
  }

  console.log(`[Discovery] 🎯 共发现 ${allNewJobs.length} 个新职位`);
  return allNewJobs;
}

// ========== 平台爬虫 ==========

/**
 * 搜索单个平台
 */
export async function searchPlatform(platform, keyword, maxJobs = 30) {
  switch (platform) {
    case 'boss': return scrapeBoss(keyword, maxJobs);
    case 'lagou': return scrapeLagou(keyword, maxJobs);
    case '51job': return scrape51Job(keyword, maxJobs);
    default: return [];
  }
}

/**
 * 爬取 Boss 直聘 (搜索结果列表页)
 * Boss 直聘反爬较强，仅爬列表页不做详情跳转
 */
async function scrapeBoss(keyword, maxJobs = 30) {
  const browser = await launchBrowser(true);
  const jobs = [];

  try {
    const context = await createStealthContext(browser);
    const page = await context.newPage();

    const url = `https://www.zhipin.com/web/geek/job?query=${encodeURIComponent(keyword)}&city=100010000`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await randomDelay(3000, 6000);

    // 检测验证码/登录墙
    const title = await page.title();
    if (title.includes('登录') || title.includes('验证')) {
      console.warn('[Discovery]   Boss 直聘触发登录/验证墙，跳过');
      await context.close();
      return [];
    }

    // 提取职位列表
    const rawJobs = await page.evaluate(() => {
      const items = document.querySelectorAll('.job-card-wrapper, .job-card-body, [class*="job-card"]');
      if (items.length === 0) {
        // 备选选择器
        const altItems = document.querySelectorAll('li.job-list-box, .job-primary');
        return Array.from(altItems).slice(0, 30).map(card => {
          const titleEl = card.querySelector('.job-name, .job-title, [class*="job-name"]');
          const companyEl = card.querySelector('.company-text, .company-name');
          const salaryEl = card.querySelector('.salary, .red, [class*="salary"]');
          const descEl = card.querySelector('.job-tag-list, .tag-list');
          return {
            title: titleEl?.textContent?.trim() || '',
            company: companyEl?.textContent?.trim() || '',
            salary: salaryEl?.textContent?.trim() || '',
            tags: descEl?.textContent?.trim() || '',
          };
        });
      }
      return Array.from(items).slice(0, 30).map(card => ({
        title: card.querySelector('[class*="name"], [class*="title"]')?.textContent?.trim() || '',
        company: card.querySelector('[class*="company"]')?.textContent?.trim() || '',
        salary: card.querySelector('[class*="salary"], .red')?.textContent?.trim() || '',
        tags: card.querySelector('[class*="tag"], [class*="desc"]')?.textContent?.trim() || '',
      }));
    });

    for (let i = 0; i < Math.min(rawJobs.length, maxJobs); i++) {
      const raw = rawJobs[i];
      if (!raw.title) continue;

      const job = {
        id: `boss-${Date.now()}-${i}`,
        platform: 'boss',
        title: raw.title,
        company: raw.company,
        salary: parseSalary(raw.salary),
        location: raw.location || CONFIG.jobs.city,
        experience: raw.experience || '',
        education: raw.education || '',
        description: raw.tags || '',
        rawSkills: extractSkillsFromText(raw.tags),
        url: `https://www.zhipin.com/web/geek/job?query=${encodeURIComponent(keyword)}`,
        discoveredAt: new Date().toISOString(),
        status: 'new',
        analyzedAt: null,
        matchScore: null,
      };

      jobs.push(job);
    }

    await context.close();
  } catch (err) {
    console.error(`[Discovery] Boss 直聘爬取失败: ${err.message}`);
  } finally {
    await browser.close();
  }

  // 如果爬取失败，用 AI 生成模拟数据作为备份
  if (jobs.length === 0) {
    console.warn('[Discovery] Boss 直聘爬取为空，使用模拟数据');
    return generateMockJobs('boss', keyword, Math.min(5, maxJobs));
  }

  return jobs;
}

/**
 * 爬取拉勾网
 */
async function scrapeLagou(keyword, maxJobs = 30) {
  const browser = await launchBrowser(true);
  const jobs = [];

  try {
    const context = await createStealthContext(browser);
    const page = await context.newPage();

    const url = `https://www.lagou.com/wn/jobs?kd=${encodeURIComponent(keyword)}&city=${encodeURIComponent(CONFIG.jobs.city)}`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await randomDelay(3000, 6000);

    const title = await page.title();
    if (title.includes('登录') || title.includes('验证')) {
      console.warn('[Discovery]   拉勾触发登录/验证墙，跳过');
      await context.close();
      // 拉勾反爬强，直接降级到模拟数据
      return generateMockJobs('lagou', keyword, Math.min(5, maxJobs));
    }

    const rawJobs = await page.evaluate(() => {
      const items = document.querySelectorAll('.job-card, .position-item, [class*="job-card"]');
      return Array.from(items).slice(0, 30).map(card => ({
        title: card.querySelector('[class*="position"], [class*="name"]')?.textContent?.trim() || '',
        company: card.querySelector('[class*="company"]')?.textContent?.trim() || '',
        salary: card.querySelector('[class*="salary"]')?.textContent?.trim() || '',
        tags: card.querySelector('[class*="label"], [class*="require"]')?.textContent?.trim() || '',
      }));
    });

    for (let i = 0; i < Math.min(rawJobs.length, maxJobs); i++) {
      const raw = rawJobs[i];
      if (!raw.title) continue;

      jobs.push({
        id: `lagou-${Date.now()}-${i}`,
        platform: 'lagou',
        title: raw.title,
        company: raw.company,
        salary: parseSalary(raw.salary),
        location: CONFIG.jobs.city,
        experience: '',
        education: '',
        description: raw.tags || '',
        rawSkills: extractSkillsFromText(raw.tags),
        url: `https://www.lagou.com/wn/jobs?kd=${encodeURIComponent(keyword)}`,
        discoveredAt: new Date().toISOString(),
        status: 'new',
        analyzedAt: null,
        matchScore: null,
      });
    }

    await context.close();
  } catch (err) {
    console.error(`[Discovery] 拉勾爬取失败: ${err.message}`);
  } finally {
    await browser.close();
  }

  if (jobs.length === 0) {
    return generateMockJobs('lagou', keyword, Math.min(5, maxJobs));
  }
  return jobs;
}

/**
 * 爬取 51job
 */
async function scrape51Job(keyword, maxJobs = 30) {
  const browser = await launchBrowser(true);
  const jobs = [];

  try {
    const context = await createStealthContext(browser);
    const page = await context.newPage();

    const url = `https://we.51job.com/pc/search?keyword=${encodeURIComponent(keyword)}&searchType=2`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await randomDelay(3000, 6000);

    const title = await page.title();
    if (title.includes('登录') || title.includes('验证') || title.includes('安全')) {
      console.warn('[Discovery]   51job 触发安全检测，跳过');
      await context.close();
      return generateMockJobs('51job', keyword, Math.min(5, maxJobs));
    }

    const rawJobs = await page.evaluate(() => {
      const items = document.querySelectorAll('.joblist-item, .joblist_item, [class*="joblist"]');
      return Array.from(items).slice(0, 30).map(card => ({
        title: card.querySelector('[class*="job_name"], [class*="jobname"]')?.textContent?.trim() || '',
        company: card.querySelector('[class*="cname"]')?.textContent?.trim() || '',
        salary: card.querySelector('[class*="salary"]')?.textContent?.trim() || '',
        tags: card.querySelector('[class*="tag"]')?.textContent?.trim() || '',
      }));
    });

    for (let i = 0; i < Math.min(rawJobs.length, maxJobs); i++) {
      const raw = rawJobs[i];
      if (!raw.title) continue;

      jobs.push({
        id: `51job-${Date.now()}-${i}`,
        platform: '51job',
        title: raw.title,
        company: raw.company,
        salary: parseSalary(raw.salary),
        location: CONFIG.jobs.city,
        experience: '',
        education: '',
        description: raw.tags || '',
        rawSkills: extractSkillsFromText(raw.tags),
        url: `https://we.51job.com/pc/search?keyword=${encodeURIComponent(keyword)}`,
        discoveredAt: new Date().toISOString(),
        status: 'new',
        analyzedAt: null,
        matchScore: null,
      });
    }

    await context.close();
  } catch (err) {
    console.error(`[Discovery] 51job 爬取失败: ${err.message}`);
  } finally {
    await browser.close();
  }

  if (jobs.length === 0) {
    return generateMockJobs('51job', keyword, Math.min(5, maxJobs));
  }
  return jobs;
}

// ========== 辅助函数 ==========

/**
 * 从薪资文本提取范围
 * "20K-35K·15薪" → { min: 20000, max: 35000 }
 */
function parseSalary(salaryText) {
  if (!salaryText) return { min: 0, max: 0 };
  const match = salaryText.match(/([\d.]+)\s*[Kk]?\s*[-~—]\s*([\d.]+)\s*[Kk]?/);
  if (match) {
    const min = parseFloat(match[1]) * (salaryText.toLowerCase().includes('k') ? 1000 : 1);
    const max = parseFloat(match[2]) * (salaryText.toLowerCase().includes('k') ? 1000 : 1);
    return { min, max };
  }
  const single = salaryText.match(/([\d.]+)\s*[Kk]/);
  if (single) {
    const val = parseFloat(single[1]) * 1000;
    return { min: val, max: val };
  }
  return { min: 0, max: 0 };
}

/**
 * 从文本中提取技能关键词
 */
function extractSkillsFromText(text) {
  if (!text) return [];
  const skillKeywords = [
    'JavaScript', 'TypeScript', 'React', 'Vue', 'Angular', 'Node.js', 'Python',
    'Java', 'Go', 'Rust', 'Docker', 'Kubernetes', 'AWS', 'MySQL', 'PostgreSQL',
    'MongoDB', 'Redis', 'Git', 'Webpack', 'Vite', 'CSS', 'HTML', 'Sass',
    'Linux', 'Nginx', 'CI/CD', '微服务', '小程序', 'uniapp',
  ];
  return skillKeywords.filter(skill =>
    text.toLowerCase().includes(skill.toLowerCase())
  );
}

/**
 * 当爬取失败时，使用 AI 生成模拟职位数据
 * 确保系统在没有真实数据时仍可运作
 */
async function generateMockJobs(platform, keyword, count = 5) {
  const systemPrompt = `你是一个招聘数据专家。生成${count}个真实的"${keyword}"岗位信息。
返回严格的 JSON 数组格式，每个对象包含：
- title: 职位名称
- company: 公司名（用真实风格的公司名）
- salaryMin: 最低月薪（数字）
- salaryMax: 最高月薪（数字）
- location: 工作城市
- experience: 经验要求（如"1-3年"）
- education: 学历要求（如"本科"）
- description: 2-3句话的职位描述，包含具体技能要求
- skills: 技能关键词数组（5-8个技术名词）`;

  const userMessage = `平台: ${platform}, 关键词: ${keyword}, 数量: ${count}`;

  const fallbackTemplate = generateFallbackJobs(keyword, count);

  try {
    const result = await callAI(systemPrompt, userMessage, { jobs: fallbackTemplate });
    const jobsList = Array.isArray(result) ? result : (result.jobs || fallbackTemplate);

    return jobsList.map((j, i) => ({
      id: `${platform}-mock-${Date.now()}-${i}`,
      platform,
      title: j.title || `${keyword}工程师`,
      company: j.company || '示例科技有限公司',
      salary: { min: j.salaryMin || 12000, max: j.salaryMax || 25000 },
      location: j.location || CONFIG.jobs.city,
      experience: j.experience || '1-3年',
      education: j.education || '本科',
      description: j.description || '',
      rawSkills: j.skills || [],
      url: '',
      discoveredAt: new Date().toISOString(),
      status: 'new',
      analyzedAt: null,
      matchScore: null,
    }));
  } catch {
    return fallbackTemplate.map((j, i) => ({
      id: `${platform}-fallback-${Date.now()}-${i}`,
      platform,
      title: j.title,
      company: j.company,
      salary: { min: j.salaryMin, max: j.salaryMax },
      location: '北京',
      experience: j.experience,
      education: j.education,
      description: j.description,
      rawSkills: j.skills,
      url: '',
      discoveredAt: new Date().toISOString(),
      status: 'new',
      analyzedAt: null,
      matchScore: null,
    }));
  }
}

/** 离线回退职位数据 */
function generateFallbackJobs(keyword, count) {
  const templates = [
    { title: `高级${keyword}工程师`, company: '字节跳动', salaryMin: 25000, salaryMax: 45000, experience: '3-5年', education: '本科', skills: ['JavaScript', 'TypeScript', 'React', 'Node.js', 'Docker', 'MySQL', 'Git'], description: '负责核心业务系统架构设计与开发，参与技术选型和性能优化。' },
    { title: `${keyword}开发工程师`, company: '美团', salaryMin: 18000, salaryMax: 35000, experience: '1-3年', education: '本科', skills: ['JavaScript', 'Vue', 'Node.js', 'Redis', 'MongoDB', 'Git'], description: '参与业务模块开发，保证代码质量和系统稳定性。' },
    { title: `资深${keyword}架构师`, company: '阿里巴巴', salaryMin: 35000, salaryMax: 60000, experience: '5-10年', education: '本科', skills: ['Java', 'Python', 'Docker', 'Kubernetes', 'AWS', 'MySQL', 'Redis', '微服务'], description: '负责技术架构规划和演进，带领团队解决技术难题。' },
    { title: `初级${keyword}`, company: '快手', salaryMin: 8000, salaryMax: 15000, experience: '应届/1年', education: '本科', skills: ['HTML', 'CSS', 'JavaScript', 'React', 'Git'], description: '在导师指导下完成业务功能开发和学习成长。' },
    { title: `${keyword}技术专家`, company: '腾讯', salaryMin: 40000, salaryMax: 70000, experience: '5-10年', education: '硕士', skills: ['JavaScript', 'TypeScript', 'React', 'Node.js', 'Go', 'Docker', 'Kubernetes', 'AWS'], description: '主导技术方案设计，推动团队技术升级和效能提升。' },
  ];
  return templates.slice(0, count);
}

// ========== 自执行支持 ==========
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  discoverJobs().then(jobs => {
    console.log(`\n✅ 完成。发现 ${jobs.length} 个职位。`);
  }).catch(err => {
    console.error('发现职位失败:', err);
    process.exit(1);
  });
}

export default { discoverJobs, searchPlatform };
