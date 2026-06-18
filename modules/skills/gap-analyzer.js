/**
 * 技能缺口分析 —— AI 从职位描述提取技能，对比现有技能，生成学习计划
 */
import CONFIG from '../shared/config.js';
import { readJSON, writeJSON, updateJSON } from '../shared/storage.js';
import { callAI } from '../shared/ai-client.js';
import { getSkillInventory, markAnalyzed } from './inventory.js';

/**
 * 主入口：分析所有新职位，生成技能缺口报告
 * @returns {Promise<GapReport>}
 */
export async function analyzeSkillGaps() {
  const jobs = await readJSON('jobs.json', []);
  const newJobs = jobs.filter(j => j.status === 'new');

  if (newJobs.length === 0) {
    console.log('[GapAnalyzer] 没有新职位需要分析');
    return { totalJobsAnalyzed: 0, gaps: [], learningPlan: null, summary: '无新职位' };
  }

  console.log(`[GapAnalyzer] 📊 分析 ${newJobs.length} 个新职位的技能要求...`);

  const inventory = await getSkillInventory();
  const currentSkillNames = inventory.skills.map(s => s.name.toLowerCase());
  const allGaps = [];
  const analyzed = [];

  for (const job of newJobs) {
    try {
      // 1. AI 提取结构化技能要求
      const extracted = await extractSkillRequirements(job);

      // 2. 计算匹配分数
      const { score, gaps, matched } = calculateMatchScore(
        extracted.requiredSkills || extracted.skills || job.rawSkills || [],
        inventory.skills
      );

      // 3. 更新职位分析结果
      await updateJSON('jobs.json', j => j.id === job.id, {
        status: 'analyzed',
        analyzedAt: new Date().toISOString(),
        matchScore: score,
        requiredSkills: extracted.requiredSkills || extracted.skills || job.rawSkills || [],
        preferredSkills: extracted.preferredSkills || [],
        matchedSkills: matched,
        gapSkills: gaps.map(g => g.skillName),
        level: extracted.level || '中级',
      });

      analyzed.push({ job, score, gaps });
      allGaps.push(...gaps.map(g => ({ ...g, relatedJobId: job.id, relatedJobTitle: job.title })));
    } catch (err) {
      console.error(`[GapAnalyzer] 分析失败 ${job.title}: ${err.message}`);
    }
  }

  // 4. 聚合缺口（合并同名技能，按需求量排序）
  const mergedGaps = mergeSkillGaps(allGaps);

  // 5. 生成学习计划
  const learningPlan = generateLearningPlan(mergedGaps);

  // 6. 更新技能清单中的缺口数据
  await updateSkillsWithGaps(mergedGaps, inventory);

  await markAnalyzed();

  const report = {
    analyzedAt: new Date().toISOString(),
    totalJobsAnalyzed: analyzed.length,
    avgMatchScore: analyzed.length > 0
      ? Math.round(analyzed.reduce((s, a) => s + a.score, 0) / analyzed.length * 100)
      : 0,
    gaps: mergedGaps.filter(g => g.urgency !== 'low'),
    allGaps: mergedGaps,
    learningPlan,
    summary: generateSummary(mergedGaps, analyzed.length),
  };

  console.log(`[GapAnalyzer] ✅ 分析完成: 平均匹配度 ${report.avgMatchScore}%, ${mergedGaps.length} 个技能缺口`);
  if (mergedGaps.length > 0) {
    const urgent = mergedGaps.filter(g => g.urgency === 'high');
    if (urgent.length > 0) {
      console.log(`[GapAnalyzer] 🔴 紧急缺口: ${urgent.map(g => g.skillName).join(', ')}`);
    }
  }

  return report;
}

/**
 * 使用 AI 从职位描述中提取结构化技能要求
 */
export async function extractSkillRequirements(job) {
  const systemPrompt = `你是一个技术招聘专家。从职位描述中提取结构化的技能要求。
返回严格的 JSON 格式：
{
  "requiredSkills": ["技能1", "技能2", ...],     // 必须掌握的技能
  "preferredSkills": ["技能1", "技能2", ...],     // 加分项
  "level": "初级|中级|高级|资深",                   // 职位级别
  "domainKnowledge": ["领域1", ...]               // 领域知识
}`;

  const userMessage = `
职位: ${job.title}
公司: ${job.company}
描述: ${job.description || '无详细描述'}
标签/技能: ${(job.rawSkills || []).join(', ')}
`.trim();

  const fallback = {
    requiredSkills: job.rawSkills || extractBasicSkills(job),
    preferredSkills: [],
    level: guessLevel(job.title),
    domainKnowledge: [],
  };

  try {
    return await callAI(systemPrompt, userMessage, fallback);
  } catch {
    return fallback;
  }
}

/**
 * 计算技能匹配分数
 * @param {string[]} requiredSkills
 * @param {Skill[]} currentSkills
 * @returns {{score: number, gaps: SkillGap[], matched: string[]}}
 */
export function calculateMatchScore(requiredSkills, currentSkills) {
  if (!requiredSkills || requiredSkills.length === 0) {
    return { score: 0.5, gaps: [], matched: [] };
  }

  const currentMap = {};
  currentSkills.forEach(s => {
    currentMap[s.name.toLowerCase()] = s.level;
  });

  const matched = [];
  const gaps = [];

  for (const skill of requiredSkills) {
    const lower = skill.toLowerCase();
    if (currentMap[lower]) {
      matched.push(skill);
    } else {
      gaps.push({
        skillName: skill,
        currentLevel: 'none',
        requiredLevel: 'intermediate',
        demandCount: 1,
        urgency: 'medium',
        status: 'pending',
      });
    }
  }

  const score = requiredSkills.length > 0
    ? matched.length / (requiredSkills.length + gaps.length * 0.5)
    : 0;

  return { score: Math.min(score, 1), gaps, matched };
}

/**
 * 合并同名技能缺口，按需求量排序
 */
function mergeSkillGaps(allGaps) {
  const merged = {};
  for (const gap of allGaps) {
    const key = gap.skillName.toLowerCase();
    if (!merged[key]) {
      merged[key] = {
        skillName: gap.skillName,
        currentLevel: gap.currentLevel || 'none',
        requiredLevel: gap.requiredLevel || 'intermediate',
        demandCount: 0,
        relatedJobs: [],
        urgency: 'low',
        status: 'pending',
      };
    }
    merged[key].demandCount++;
    if (gap.relatedJobId) {
      merged[key].relatedJobs.push(`${gap.relatedJobTitle} (${gap.relatedJobId})`);
    }
  }

  // 计算紧急度
  for (const key of Object.keys(merged)) {
    const g = merged[key];
    if (g.demandCount >= 5) g.urgency = 'high';
    else if (g.demandCount >= 2) g.urgency = 'medium';
    else g.urgency = 'low';
  }

  // 按需求量降序排列
  return Object.values(merged).sort((a, b) => b.demandCount - a.demandCount);
}

/**
 * 生成学习计划
 */
export function generateLearningPlan(gaps) {
  const urgent = gaps.filter(g => g.urgency === 'high');
  const medium = gaps.filter(g => g.urgency === 'medium');

  const priorities = [...urgent, ...medium];
  const estimatedHours = priorities.reduce((sum, g) => {
    const hoursMap = { beginner: 5, intermediate: 15, advanced: 40, expert: 80 };
    return sum + (hoursMap[g.requiredLevel] || 10);
  }, 0);

  return {
    priorities: priorities.map(g => `${g.skillName} (${g.urgency === 'high' ? '紧急' : '建议'}, ${g.demandCount} 个职位要求)`),
    estimatedHours,
    suggestedOrder: priorities.slice(0, 5).map(g => ({
      skill: g.skillName,
      reason: g.urgency === 'high'
        ? `最急迫缺口，${g.demandCount} 个职位要求`
        : `${g.demandCount} 个职位需要，提升竞争力`,
      estimatedHours: { beginner: 5, intermediate: 15, advanced: 40, expert: 80 }[g.requiredLevel] || 10,
    })),
  };
}

/**
 * 更新技能清单，将缺口写入
 */
async function updateSkillsWithGaps(gaps, inventory) {
  const existingNames = new Set(inventory.skills.map(s => s.name.toLowerCase()));

  for (const gap of gaps) {
    if (existingNames.has(gap.skillName.toLowerCase())) continue;

    inventory.skills.push({
      name: gap.skillName,
      level: 'none',
      category: 'unknown',
      lastUpdated: new Date().toISOString(),
      verified: false,
      source: 'ai-analysis',
      status: 'pending',
      demandCount: gap.demandCount,
      urgency: gap.urgency,
      requiredLevel: gap.requiredLevel,
    });
  }

  await writeJSON('skills-inventory.json', inventory);
}

/**
 * 生成分析摘要
 */
function generateSummary(gaps, totalJobs) {
  const urgent = gaps.filter(g => g.urgency === 'high');
  const medium = gaps.filter(g => g.urgency === 'medium');

  if (urgent.length === 0 && medium.length === 0) {
    return `分析了 ${totalJobs} 个职位，未发现明显的技能缺口。当前技能与市场需求匹配良好。`;
  }

  const parts = [`分析了 ${totalJobs} 个职位，发现 ${gaps.length} 个技能缺口。`];
  if (urgent.length > 0) {
    parts.push(`紧急学习: ${urgent.map(g => g.skillName).join('、')}`);
  }
  if (medium.length > 0) {
    parts.push(`建议学习: ${medium.slice(0, 3).map(g => g.skillName).join('、')}`);
  }
  return parts.join(' ');
}

/**
 * 从标题推测级别
 */
function guessLevel(title) {
  const lower = title.toLowerCase();
  if (lower.includes('资深') || lower.includes('高级') || lower.includes('senior') || lower.includes('staff')) return '高级';
  if (lower.includes('初级') || lower.includes('实习') || lower.includes('junior') || lower.includes('intern')) return '初级';
  if (lower.includes('总监') || lower.includes('架构') || lower.includes('lead') || lower.includes('principal')) return '资深';
  return '中级';
}

/**
 * 从标题和描述中提取基本技能
 */
function extractBasicSkills(job) {
  const text = [job.title, job.description].join(' ').toLowerCase();
  const skillPatterns = [
    'javascript', 'typescript', 'react', 'vue', 'angular', 'node.js', 'nodejs',
    'python', 'java', 'go', 'rust', 'docker', 'kubernetes', 'aws', 'mysql',
    'postgresql', 'mongodb', 'redis', 'git', 'webpack', 'vite',
  ];
  return skillPatterns.filter(s => text.includes(s));
}

// ========== 自执行支持 ==========
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  analyzeSkillGaps().then(report => {
    console.log(`\n${report.summary}`);
  }).catch(err => {
    console.error('技能分析失败:', err);
    process.exit(1);
  });
}

export default { analyzeSkillGaps, extractSkillRequirements, calculateMatchScore, generateLearningPlan };
