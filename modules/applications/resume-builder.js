/**
 * 动态简历生成器 —— 针对每个职位优化简历
 * 使用 Handlebars 模板 + AI 内容生成
 */
import { mkdir, writeFile } from 'fs/promises';
import { resolve } from 'path';
import CONFIG from '../shared/config.js';
import { callAI } from '../shared/ai-client.js';
import { getSkillInventory } from '../skills/inventory.js';
import { readJSON } from '../shared/storage.js';
import Handlebars from 'handlebars';

/**
 * 为特定职位生成优化简历
 * @param {object} job - 职位信息
 * @returns {Promise<Resume>}
 */
export async function generateResumeForJob(job) {
  console.log(`[ResumeBuilder] 📝 为 "${job.title} @ ${job.company}" 生成简历...`);

  const inventory = await getSkillInventory();
  const userProfile = getUserProfile();

  // 1. AI 生成针对性的个人总结
  const summary = await generateSummary(job, inventory.skills, userProfile);

  // 2. AI 优化技能描述，突出与职位匹配的技能
  const optimizedSkills = await optimizeSkillDescriptions(
    inventory.skills.filter(s => s.level !== 'none'),
    job
  );

  // 3. AI 优化工作经历描述
  const optimizedExperiences = await optimizeExperiences(userProfile, job);

  // 4. 渲染简历
  const resume = {
    id: `resume-${job.id}`,
    jobId: job.id,
    jobTitle: job.title,
    company: job.company,
    createdAt: new Date().toISOString(),
    profile: userProfile,
    summary,
    skills: optimizedSkills,
    experiences: optimizedExperiences,
    matchScore: job.matchScore || 0,
  };

  // 5. 保存
  const htmlPath = await renderResume(resume);

  return { ...resume, htmlPath };
}

/**
 * AI 生成针对性的个人总结
 */
async function generateSummary(job, skills, profile) {
  const systemPrompt = `你是专业简历顾问。为以下职位写一段个人总结 (100-150字，中文)。
根据职位要求，突出候选人的匹配技能和经验。
风格：专业、自信、有数据支撑。`;

  const userMessage = `
职位: ${job.title} @ ${job.company}
职位要求: ${(job.requiredSkills || job.rawSkills || []).join(', ')}
候选人技能: ${skills.map(s => `${s.name} (${s.level})`).join(', ')}
工作年限: ${profile.yearsExperience} 年
当前岗位: ${profile.currentRole}
城市: ${profile.city}
`.trim();

  const fallback = `${profile.yearsExperience} 年${profile.currentRole}经验，熟练掌握 ${skills.slice(0, 5).map(s => s.name).join('、')}。`
    + `对 ${job.title} 岗位有深入理解，期待加入 ${job.company} 创造价值。`;

  try {
    const result = await callAI(systemPrompt, userMessage, { summary: fallback });
    return typeof result === 'string' ? result : (result.summary || fallback);
  } catch {
    return fallback;
  }
}

/**
 * AI 优化技能描述，突出与职位匹配的技能
 */
async function optimizeSkillDescriptions(allSkills, job) {
  const requiredSkills = (job.requiredSkills || job.rawSkills || []).map(s => s.toLowerCase());
  const matched = allSkills.filter(s => requiredSkills.includes(s.name.toLowerCase()));
  const other = allSkills.filter(s => !requiredSkills.includes(s.name.toLowerCase()));

  // 匹配的技能排在前面，用更强的描述
  const sorted = [...matched, ...other];

  return sorted.map(s => ({
    name: s.name,
    level: s.level,
    isMatched: requiredSkills.includes(s.name.toLowerCase()),
    description: s.isMatched
      ? `熟练掌握 ${s.name}，具备实际项目经验`
      : `了解 ${s.name} 基础，持续学习中`,
  }));
}

/**
 * AI 优化工作经历描述，使其贴近目标职位
 */
async function optimizeExperiences(profile, job) {
  if (!profile.experiences || profile.experiences.length === 0) {
    return [{
      company: profile.currentCompany || '待补充',
      role: profile.currentRole,
      duration: `${profile.yearsExperience} 年`,
      highlights: [
        `负责核心业务系统的开发与维护`,
        `参与技术方案设计与代码评审`,
        `持续优化系统性能和用户体验`,
      ],
    }];
  }

  const systemPrompt = `你是简历优化专家。根据目标职位"${job.title} @ ${job.company}"的要求，优化工作经历描述。
让每条经历都和职位相关。突出成果和影响力。`;

  try {
    const result = await callAI(systemPrompt, JSON.stringify(profile.experiences), { experiences: profile.experiences });
    return Array.isArray(result) ? result : (result.experiences || profile.experiences);
  } catch {
    return profile.experiences;
  }
}

/**
 * 渲染简历为 HTML 文件
 */
async function renderResume(resume) {
  const template = Handlebars.compile(RESUME_TEMPLATE);
  const html = template(resume);

  const outputDir = resolve(CONFIG.rootDir, 'data', 'resumes');
  await mkdir(outputDir, { recursive: true });
  const filename = `resume-${resume.jobId}.html`;
  const filepath = resolve(outputDir, filename);
  await writeFile(filepath, html, 'utf-8');

  return filepath;
}

/**
 * 获取用户基本信息 (从环境变量)
 */
function getUserProfile() {
  return {
    name: process.env.USER_NAME || '候选人',
    email: process.env.USER_EMAIL || 'candidate@example.com',
    phone: process.env.USER_PHONE || '13800000000',
    city: process.env.USER_CITY || process.env.TARGET_CITY || '北京',
    currentRole: process.env.USER_CURRENT_ROLE || '软件工程师',
    yearsExperience: parseInt(process.env.USER_YEARS_EXPERIENCE || '3'),
    currentCompany: process.env.USER_CURRENT_COMPANY || '',
    education: process.env.USER_EDUCATION || '本科',
    school: process.env.USER_SCHOOL || '',
    experiences: [],
  };
}

// ========== Handlebars 简历模板 ==========

const RESUME_TEMPLATE = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{{profile.name}} - 简历</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: "PingFang SC", "Microsoft YaHei", "Helvetica Neue", sans-serif;
      color: #333;
      line-height: 1.6;
      max-width: 800px;
      margin: 0 auto;
      padding: 40px 20px;
      background: #fafafa;
    }
    .resume {
      background: white;
      padding: 48px;
      border-radius: 8px;
      box-shadow: 0 2px 12px rgba(0,0,0,0.08);
    }
    h1 { font-size: 28px; color: #1a1a1a; margin-bottom: 8px; }
    .contact {
      color: #666; font-size: 14px; margin-bottom: 24px;
      padding-bottom: 20px; border-bottom: 2px solid #4A7C59;
    }
    .contact span { margin-right: 16px; }
    .section { margin-bottom: 24px; }
    .section h2 {
      font-size: 18px; color: #4A7C59; margin-bottom: 12px;
      padding-left: 12px; border-left: 4px solid #4A7C59;
    }
    .summary { font-size: 15px; color: #444; line-height: 1.8; }
    .skills { display: flex; flex-wrap: wrap; gap: 8px; }
    .skill-tag {
      display: inline-block; padding: 4px 12px;
      background: #f0f7f2; color: #4A7C59; border-radius: 16px;
      font-size: 13px;
    }
    .skill-tag.matched {
      background: #4A7C59; color: white; font-weight: 500;
    }
    .experience-item { margin-bottom: 16px; }
    .experience-item h3 { font-size: 16px; color: #1a1a1a; }
    .experience-item .meta { font-size: 13px; color: #888; margin-bottom: 4px; }
    .experience-item li { font-size: 14px; color: #555; margin-left: 20px; }
    .match-badge {
      display: inline-block; padding: 2px 10px;
      background: #D4A853; color: white; border-radius: 12px;
      font-size: 12px; margin-left: 8px;
    }
  </style>
</head>
<body>
  <div class="resume">
    <h1>{{profile.name}}</h1>
    <div class="contact">
      <span>📧 {{profile.email}}</span>
      <span>📱 {{profile.phone}}</span>
      <span>📍 {{profile.city}}</span>
      <span>💼 {{profile.yearsExperience}} 年经验</span>
    </div>

    <div class="section">
      <h2>求职意向</h2>
      <p class="summary">
        🎯 目标岗位: <strong>{{jobTitle}}</strong> @ {{company}}
        <span class="match-badge">匹配度 {{matchScorePercent}}%</span>
      </p>
    </div>

    <div class="section">
      <h2>个人总结</h2>
      <p class="summary">{{summary}}</p>
    </div>

    <div class="section">
      <h2>技能特长</h2>
      <div class="skills">
        {{#each skills}}
        <span class="skill-tag {{#if isMatched}}matched{{/if}}">
          {{name}} ({{level}})
          {{#if isMatched}} ✓{{/if}}
        </span>
        {{/each}}
      </div>
    </div>

    <div class="section">
      <h2>工作经历</h2>
      {{#each experiences}}
      <div class="experience-item">
        <h3>{{role}} — {{company}}</h3>
        <p class="meta">⏱ {{duration}}</p>
        <ul>
          {{#each highlights}}
          <li>{{this}}</li>
          {{/each}}
        </ul>
      </div>
      {{/each}}
    </div>

    <div class="section">
      <h2>教育背景</h2>
      <p>{{profile.education}} · {{profile.school}}</p>
    </div>

    <p style="text-align: center; color: #999; font-size: 12px; margin-top: 32px;">
      📄 由自主求职 Agent 自动生成 · {{createdAt}}
    </p>
  </div>
</body>
</html>`;

// 注册 Handlebars helper
Handlebars.registerHelper('matchScorePercent', function() {
  const score = this.matchScore || 0;
  return Math.round(score * 100);
});

// ========== 自执行支持 ==========
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  const testJob = {
    id: 'test-job-001',
    title: '高级前端开发工程师',
    company: '示例科技',
    requiredSkills: ['JavaScript', 'TypeScript', 'React', 'Node.js'],
    rawSkills: ['JavaScript', 'TypeScript', 'React', 'Node.js', 'Docker'],
    matchScore: 0.72,
  };
  generateResumeForJob(testJob).then(resume => {
    console.log(`\n✅ 简历已生成: ${resume.htmlPath}`);
  }).catch(err => {
    console.error('生成简历失败:', err);
    process.exit(1);
  });
}

export default { generateResumeForJob };
