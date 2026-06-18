/**
 * 学习资源搜索器 —— 为技能缺口找最佳学习资源
 */
import CONFIG from '../shared/config.js';
import { callAI } from '../shared/ai-client.js';

/**
 * 为技能缺口搜索学习资源
 * @param {object} gap - 技能缺口 { skillName, currentLevel, requiredLevel }
 * @returns {Promise<LearningResource[]>}
 */
export async function searchLearningResources(gap) {
  console.log(`[Researcher] 🔍 搜索 "${gap.skillName}" 的学习资源...`);

  const sources = CONFIG.learning.sources;
  const resources = [];

  // 1. 官方文档链接（直接拼接，无需搜索）
  const officialDoc = getOfficialDocUrl(gap.skillName);
  if (officialDoc) {
    resources.push({
      id: `doc-${slug(gap.skillName)}`,
      skillName: gap.skillName,
      title: `${gap.skillName} 官方文档`,
      url: officialDoc,
      source: '官方文档',
      type: 'documentation',
      difficulty: gap.requiredLevel || 'intermediate',
      description: `${gap.skillName} 官方文档 - 最权威的学习资料`,
      language: '多语言',
    });
  }

  // 2. 用 AI 推荐最佳学习资源
  const aiResources = await searchWithAI(gap);
  resources.push(...aiResources);

  // 3. 用 AI 评估和排序
  const ranked = await rankResourcesByAI(resources, gap);

  console.log(`[Researcher] 📚 找到 ${ranked.length} 个资源: ${ranked.map(r => r.source).join(', ')}`);
  return ranked.slice(0, CONFIG.learning.maxResourcesPerGap);
}

/**
 * 使用 AI 搜索并推荐学习资源
 */
async function searchWithAI(gap) {
  const systemPrompt = `你是一个技术学习顾问。为技能"${gap.skillName}"推荐最佳在线学习资源。
返回严格的 JSON 数组格式：
[
  {
    "title": "资源标题",
    "url": "完整URL",
    "source": "MDN/freeCodeCamp/菜鸟教程/B站/其他",
    "type": "tutorial/documentation/video/exercise",
    "difficulty": "beginner/intermediate/advanced",
    "description": "简短描述 (1-2句)",
    "language": "zh/en"
  }
]
推荐 3-5 个高质量资源。优先中文资源。URL 必须是真实的、可访问的链接。`;

  const userMessage = `
技能: ${gap.skillName}
当前水平: ${gap.currentLevel || 'none'}
目标水平: ${gap.requiredLevel || 'intermediate'}
需求热度: ${gap.urgency || 'medium'} (${gap.demandCount || 0} 个职位要求)
`.trim();

  const fallback = getFallbackResources(gap.skillName);

  try {
    const result = await callAI(systemPrompt, userMessage, fallback);
    return Array.isArray(result) ? result : (result.resources || fallback);
  } catch {
    return fallback;
  }
}

/**
 * AI 评估和排序资源
 */
export async function rankResourcesByAI(resources, gap) {
  if (resources.length <= 2) return resources;

  const systemPrompt = `你是学习资源评估专家。根据以下标准给每个资源打分：
- 与技能"${gap.skillName}"的相关性
- 内容质量和权威性
- 适合学习者水平（当前: ${gap.currentLevel || 'none'} → 目标: ${gap.requiredLevel || 'intermediate'}）
返回带 aiRating 的排序资源列表。`;

  try {
    const userMessage = JSON.stringify(resources, null, 2);
    const result = await callAI(systemPrompt, userMessage, resources);
    const rated = Array.isArray(result) ? result : (result.resources || resources);
    return rated.sort((a, b) => (b.aiRating?.relevance || 0.5) - (a.aiRating?.relevance || 0.5));
  } catch {
    return resources;
  }
}

/**
 * 获取技能的官方文档 URL
 */
function getOfficialDocUrl(skillName) {
  const docs = {
    'javascript': 'https://developer.mozilla.org/zh-CN/docs/Web/JavaScript',
    'typescript': 'https://www.typescriptlang.org/docs/handbook/intro.html',
    'react': 'https://react.dev/learn',
    'vue': 'https://cn.vuejs.org/guide/introduction.html',
    'node.js': 'https://nodejs.org/zh-cn/docs/guides/',
    'python': 'https://docs.python.org/zh-cn/3/tutorial/index.html',
    'java': 'https://docs.oracle.com/javase/tutorial/',
    'go': 'https://go.dev/doc/',
    'rust': 'https://doc.rust-lang.org/book/',
    'docker': 'https://docs.docker.com/get-started/',
    'kubernetes': 'https://kubernetes.io/zh-cn/docs/tutorials/',
    'aws': 'https://docs.aws.amazon.com/',
    'mysql': 'https://dev.mysql.com/doc/refman/8.0/en/',
    'postgresql': 'https://www.postgresql.org/docs/current/',
    'mongodb': 'https://www.mongodb.com/docs/manual/',
    'redis': 'https://redis.io/docs/latest/develop/',
    'git': 'https://git-scm.com/book/zh/v2',
    'webpack': 'https://webpack.js.org/concepts/',
    'vite': 'https://cn.vitejs.dev/guide/',
    'css': 'https://developer.mozilla.org/zh-CN/docs/Web/CSS',
    'html': 'https://developer.mozilla.org/zh-CN/docs/Web/HTML',
    'linux': 'https://linuxcommand.org/',
    'nginx': 'https://nginx.org/en/docs/',
  };

  const lower = skillName.toLowerCase();
  return docs[lower] || null;
}

/**
 * 离线回退资源
 */
function getFallbackResources(skillName) {
  const generic = [
    {
      title: `${skillName} 菜鸟教程`,
      url: `https://www.runoob.com/${skillName.toLowerCase().replace(/\./g, '')}/`,
      source: '菜鸟教程',
      type: 'tutorial',
      difficulty: 'beginner',
      description: `${skillName} 入门教程 (中文)`,
      language: 'zh',
    },
    {
      title: `${skillName} - freeCodeCamp 中文`,
      url: `https://www.freecodecamp.org/chinese/news/search/?query=${encodeURIComponent(skillName)}`,
      source: 'freeCodeCamp',
      type: 'tutorial',
      difficulty: 'intermediate',
      description: `${skillName} 免费教程和文章`,
      language: 'zh',
    },
  ];

  const officialDoc = getOfficialDocUrl(skillName);
  if (officialDoc) {
    generic.unshift({
      title: `${skillName} 官方文档`,
      url: officialDoc,
      source: '官方文档',
      type: 'documentation',
      difficulty: 'intermediate',
      description: `${skillName} 官方参考文档`,
      language: '多语言',
    });
  }

  return generic;
}

function slug(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

export default { searchLearningResources, rankResourcesByAI };
