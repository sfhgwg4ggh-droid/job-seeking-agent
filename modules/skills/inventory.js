/**
 * 技能清单管理 —— 当前技能 CRUD + 等级追踪
 */
import CONFIG from '../shared/config.js';
import { readJSON, writeJSON } from '../shared/storage.js';

const SKILLS_FILE = 'skills-inventory.json';

/**
 * 获取完整技能清单
 * @returns {Promise<{skills: Skill[], targetRoles: string[], desiredSkills: string[], lastAnalysisAt: string|null}>}
 */
export async function getSkillInventory() {
  const data = await readJSON(SKILLS_FILE, {
    skills: [],
    targetRoles: (process.env.TARGET_ROLES || '前端开发,全栈开发').split(','),
    desiredSkills: (process.env.TARGET_SKILLS || '').split(',').filter(Boolean),
    lastAnalysisAt: null,
  });

  // 确保向后兼容
  if (!data.skills) data.skills = [];
  if (!data.targetRoles) data.targetRoles = ['前端开发', '全栈开发'];
  if (!data.desiredSkills) data.desiredSkills = [];

  return data;
}

/**
 * 获取技能列表 (简化版)
 */
export async function listSkills() {
  const inventory = await getSkillInventory();
  return inventory.skills;
}

/**
 * 添加或更新技能
 * @param {string} name - 技能名
 * @param {string} level - beginner | intermediate | advanced | expert
 * @param {string} source - 来源: 'manual' | 'learning' | 'ai-analysis'
 */
export async function upsertSkill(name, level = 'beginner', source = 'manual') {
  const inventory = await getSkillInventory();
  const existing = inventory.skills.find(s => s.name.toLowerCase() === name.toLowerCase());

  if (existing) {
    // 升级不降级：只有新等级更高时才更新
    const levels = ['beginner', 'intermediate', 'advanced', 'expert'];
    if (levels.indexOf(level) > levels.indexOf(existing.level)) {
      existing.level = level;
      existing.lastUpdated = new Date().toISOString();
      existing.source = source;
    }
  } else {
    inventory.skills.push({
      name,
      level,
      category: guessCategory(name),
      lastUpdated: new Date().toISOString(),
      verified: source === 'learning', // 学习验证通过的才标记 verified
      verifiedBy: source === 'learning' ? 'learning-validator' : null,
      source,
      notes: '',
    });
  }

  await writeJSON(SKILLS_FILE, inventory);
  return inventory;
}

/**
 * 获取技能缺口列表
 */
export async function getSkillGaps() {
  const inventory = await getSkillInventory();
  return inventory.skills
    .filter(s => s.status === 'pending' && s.level === 'none')
    .map(s => ({ skillName: s.name, ...s }));
}

/**
 * 更新技能缺口状态
 */
export async function updateSkillGapStatus(skillName, status, newLevel = null) {
  const inventory = await getSkillInventory();
  const skill = inventory.skills.find(s => s.name.toLowerCase() === skillName.toLowerCase());

  if (skill) {
    if (status === 'completed' || status === 'verified') {
      skill.status = status;
      if (newLevel) skill.level = newLevel;
      skill.lastUpdated = new Date().toISOString();
    }
  }

  await writeJSON(SKILLS_FILE, inventory);
  return inventory;
}

/**
 * 根据技能名推测分类
 */
function guessCategory(name) {
  const categories = {
    frontend: ['html', 'css', 'javascript', 'typescript', 'react', 'vue', 'angular', 'webpack', 'vite', 'sass'],
    backend: ['node.js', 'python', 'java', 'go', 'rust', 'express', 'django', 'spring'],
    devops: ['docker', 'kubernetes', 'aws', 'nginx', 'linux', 'ci/cd', 'jenkins'],
    database: ['mysql', 'postgresql', 'mongodb', 'redis', 'sql'],
    language: ['javascript', 'typescript', 'python', 'java', 'go', 'rust', 'c++'],
  };

  const lower = name.toLowerCase();
  for (const [cat, keywords] of Object.entries(categories)) {
    if (keywords.some(k => lower.includes(k))) return cat;
  }
  return 'other';
}

/**
 * 保存技能分析时间戳
 */
export async function markAnalyzed() {
  const inventory = await getSkillInventory();
  inventory.lastAnalysisAt = new Date().toISOString();
  await writeJSON(SKILLS_FILE, inventory);
}

export default { getSkillInventory, listSkills, upsertSkill, getSkillGaps, updateSkillGapStatus, markAnalyzed };
