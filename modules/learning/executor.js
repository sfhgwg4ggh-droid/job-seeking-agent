/**
 * 学习执行器 —— 读取在线文档、AI 总结笔记、生成练习题
 */
import CONFIG from '../shared/config.js';
import { callAI } from '../shared/ai-client.js';
import { readJSON, appendToJSON } from '../shared/storage.js';

/**
 * 执行一个技能的学习任务
 * @param {object} gap - 技能缺口
 * @param {Array} resources - 学习资源列表
 * @returns {Promise<LearningResult>}
 */
export async function executeLearning(gap, resources) {
  const skillName = gap.skillName || gap.name;
  console.log(`[Executor] 📖 开始学习 "${skillName}"...`);

  const result = {
    skillName,
    startedAt: new Date().toISOString(),
    completedAt: null,
    resourcesUsed: resources.map(r => r.id || r.url),
    notes: '',
    keyPoints: [],
    codeExamples: [],
    exercises: [],
    validationStatus: 'pending',
    validationScore: null,
  };

  // 1. 为每个资源生成学习笔记
  const allNotes = [];
  for (const resource of resources.slice(0, 2)) { // 最多读 2 个资源
    try {
      console.log(`[Executor]   阅读: ${resource.title || resource.url}`);
      const notes = await readAndTakeNotes(resource, skillName);
      if (notes) allNotes.push(notes);
    } catch (err) {
      console.error(`[Executor]   读取资源失败: ${err.message}`);
    }
  }

  // 2. AI 总结所有笔记，提取关键知识点
  if (allNotes.length > 0) {
    const combined = allNotes.join('\n\n---\n\n');
    const summary = await summarizeWithAI(combined, skillName, gap.requiredLevel || 'intermediate');
    result.notes = combined;
    result.keyPoints = summary.keyPoints || [];
    result.codeExamples = summary.codeExamples || [];
  } else {
    // 没有可读资源时，直接用 AI 生成知识点
    const summary = await generateKnowledgeDirectly(skillName, gap.requiredLevel || 'intermediate');
    result.notes = `# ${skillName} 学习笔记\n\n(由 AI 直接生成，无外部资源)\n\n${summary.overview || ''}`;
    result.keyPoints = summary.keyPoints || [];
    result.codeExamples = summary.codeExamples || [];
  }

  // 3. AI 生成练习题
  const exercises = await generateExercises(skillName, gap.requiredLevel || 'intermediate');
  result.exercises = exercises;

  result.completedAt = new Date().toISOString();

  // 4. 保存学习记录
  await appendToJSON('learning-progress.json', {
    id: `learn-${slug(skillName)}-${Date.now()}`,
    ...result,
  });

  console.log(`[Executor] ✅ 学习完成 — 提取了 ${result.keyPoints.length} 个知识点, ${result.exercises.length} 道练习题`);
  return result;
}

/**
 * 读取在线文档并生成学习笔记 (通过 AI 模拟)
 * 实际环境中的文档读取需要通过 WebFetch 或 Playwright
 */
export async function readAndTakeNotes(resource, skillName) {
  const systemPrompt = `你是一个技术学习助手。为你正在学习的"${skillName}"生成一份学习笔记。
即使无法访问 URL，也要基于你对这个技能的了解，生成高质量的学习内容。

格式: Markdown
包含:
1. 核心概念
2. 基础语法/用法
3. 常见模式和最佳实践
4. 注意事项和常见坑`;

  const userMessage = `资源: ${resource.title || resource.url}
URL: ${resource.url || '未知'}
来源: ${resource.source || '未知'}
难度: ${resource.difficulty || 'intermediate'}

请基于你对"${skillName}"的了解生成学习笔记。`;

  try {
    const result = await callAI(systemPrompt, userMessage, { notes: '' });
    return typeof result === 'string' ? result : (result.notes || result.content || '');
  } catch {
    return `# ${skillName} 学习笔记\n\n## 概述\n${skillName} 是一个重要的技术技能。\n\n## 核心概念\n待学习...`;
  }
}

/**
 * 使用 AI 总结学习内容，提取关键知识点
 */
export async function summarizeWithAI(content, skillName, level) {
  const systemPrompt = `你是技术教育专家。总结以下关于"${skillName}"的学习材料。
返回严格的 JSON 格式：
{
  "overview": "一段话概述 (50-100字)",
  "keyPoints": ["知识点1", "知识点2", ...],     // 5-8 个关键知识点
  "codeExamples": ["示例代码1", "示例代码2", ...], // 2-3 个代码示例
  "commonPitfalls": ["常见坑1", "常见坑2"]        // 1-3 个常见错误
}`;

  const userMessage = `技能: ${skillName}\n目标水平: ${level}\n\n学习材料:\n${content.slice(0, 3000)}`;

  const fallback = {
    overview: `${skillName} 的核心知识体系`,
    keyPoints: [`${skillName} 基础概念`, `${skillName} 进阶用法`, `${skillName} 最佳实践`],
    codeExamples: [`// ${skillName} 示例代码\nconsole.log("Hello World");`],
    commonPitfalls: ['忽略边界条件', '未处理错误情况'],
  };

  try {
    return await callAI(systemPrompt, userMessage, fallback);
  } catch {
    return fallback;
  }
}

/**
 * 无法获取资源时，直接用 AI 生成知识点
 */
async function generateKnowledgeDirectly(skillName, level) {
  const systemPrompt = `你是"${skillName}"专家。为一位想要达到"${level}"水平的学习者生成学习内容。
返回 JSON：
{
  "overview": "技能概述 (100-200字)",
  "keyPoints": ["知识点..."],  // 8-12 个
  "codeExamples": ["代码示例..."], // 3-5 个
  "commonPitfalls": ["常见问题..."]
}`;

  return callAI(systemPrompt, `教我 ${skillName}`, {
    overview: `${skillName} ${level} 级别知识点`,
    keyPoints: [`${skillName} 基础知识`, `${skillName} 核心概念`, `${skillName} 实践应用`],
    codeExamples: [`// ${skillName} demo`],
    commonPitfalls: [],
  });
}

/**
 * 生成练习题
 */
export async function generateExercises(skillName, level = 'intermediate') {
  const systemPrompt = `你是技术面试官。为"${skillName}"生成 ${level} 级别的练习题。
返回 JSON 数组：
[
  {
    "question": "题目",
    "type": "单选题/多选题/简答题/代码题",
    "options": ["A. ...", "B. ...", "C. ...", "D. ..."],   // 选择题必填
    "answer": "正确答案或参考实现",
    "explanation": "题解说明",
    "difficulty": "easy/medium/hard"
  }
]
生成 5 道题，难度分布 2 easy + 2 medium + 1 hard。`;

  const userMessage = `技能: ${skillName}, 目标水平: ${level}`;

  const fallback = [
    {
      question: `${skillName} 的核心特性是什么？`,
      type: '简答题',
      answer: `${skillName} 的核心特性包括...（请参考官方文档）`,
      explanation: '理解核心特性有助于掌握技术本质',
      difficulty: 'easy',
    },
    {
      question: `写出一个 ${skillName} 的简单使用示例`,
      type: '代码题',
      answer: `// ${skillName} 示例`,
      explanation: '动手实践是最好的学习方式',
      difficulty: 'medium',
    },
  ];

  try {
    const result = await callAI(systemPrompt, userMessage, fallback);
    return Array.isArray(result) ? result : (result.exercises || result.questions || fallback);
  } catch {
    return fallback;
  }
}

function slug(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

// ========== 自执行支持 ==========
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  const testGap = {
    skillName: process.argv[2] || 'TypeScript',
    requiredLevel: 'intermediate',
    urgency: 'high',
    demandCount: 5,
  };
  const testResources = [
    { id: 'doc-ts', title: 'TypeScript 官方文档', url: 'https://www.typescriptlang.org/docs/', source: '官方文档' },
  ];
  executeLearning(testGap, testResources).then(result => {
    console.log(`\n✅ 学习完成: ${result.skillName}`);
    console.log(`   知识点: ${result.keyPoints.length} 个`);
    console.log(`   练习题: ${result.exercises.length} 道`);
  }).catch(err => {
    console.error('学习失败:', err);
    process.exit(1);
  });
}

export default { executeLearning, readAndTakeNotes, summarizeWithAI, generateExercises };
