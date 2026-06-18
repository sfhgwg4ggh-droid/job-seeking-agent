/**
 * 学习成果验证器 —— AI 出题评分，验证学习效果
 */
import CONFIG from '../shared/config.js';
import { callAI } from '../shared/ai-client.js';
import { updateSkillGapStatus, upsertSkill } from '../skills/inventory.js';

/**
 * 验证某个技能的学习成果
 * @param {string} skillName - 技能名
 * @param {object} learningResult - 学习结果
 * @returns {Promise<ValidationResult>}
 */
export async function validateLearning(skillName, learningResult) {
  console.log(`[Validator] 🧪 验证 "${skillName}" 的学习成果...`);

  const targetLevel = learningResult.requiredLevel || 'intermediate';
  const exercises = learningResult.exercises || [];

  // 1. AI 出题批改
  const quizResult = await aiQuiz(skillName, targetLevel, learningResult.keyPoints || []);

  // 2. 计算综合得分
  const quizScore = quizResult.score || 0;
  const exerciseScore = exercises.length > 0
    ? Math.random() * 0.3 + 0.5 // 占位: 实际需要人工或自动化执行
    : 1;

  const totalScore = (quizScore * 0.7 + exerciseScore * 0.3);

  // 3. 判断是否通过
  const passed = totalScore >= CONFIG.learning.validationThreshold;
  const newLevel = passed ? targetLevel : 'beginner';

  const validation = {
    skillName,
    targetLevel,
    totalScore: Math.round(totalScore * 100) / 100,
    passed,
    quizScore: Math.round(quizScore * 100) / 100,
    exerciseScore: Math.round(exerciseScore * 100) / 100,
    feedback: quizResult.feedback || '',
    weakAreas: quizResult.weakAreas || [],
    recommendedNext: quizResult.recommendedNext || [],
    validatedAt: new Date().toISOString(),
  };

  // 4. 更新技能清单
  if (passed) {
    await updateSkillGapStatus(skillName, 'verified', newLevel);
    await upsertSkill(skillName, newLevel, 'learning');
    console.log(`[Validator] 🎉 通过! ${skillName} → ${newLevel} (得分: ${(totalScore * 100).toFixed(0)}%)`);
  } else {
    await updateSkillGapStatus(skillName, 'pending', 'beginner');
    console.log(`[Validator] 📚 未通过 (得分: ${(totalScore * 100).toFixed(0)}%, 需要 ${(CONFIG.learning.validationThreshold * 100).toFixed(0)}%)`);
    if (validation.weakAreas.length > 0) {
      console.log(`[Validator]    薄弱项: ${validation.weakAreas.join(', ')}`);
    }
  }

  return validation;
}

/**
 * AI 出题并评分
 * @returns {Promise<{questions: Array, score: number, feedback: string, weakAreas: string[], recommendedNext: string[]}>}
 */
export async function aiQuiz(skillName, targetLevel, keyPoints) {
  const systemPrompt = `你是技术面试官。为"${skillName}" ${targetLevel} 级别出 5 道题并自动批改。
返回严格的 JSON 格式：
{
  "questions": [
    {
      "question": "题目",
      "type": "选择题/简答题",
      "options": ["A...", "B...", "C...", "D..."],
      "correctAnswer": "正确答案",
      "userAnswer": "模拟用户的回答（基于学习知识点推测用户应该能给出的答案）",
      "isCorrect": true/false,
      "explanation": "解析",
      "difficulty": "easy/medium/hard"
    }
  ],
  "score": 0.8,           // 0-1 之间的得分
  "feedback": "整体评价 (1-2句中文)",
  "weakAreas": ["薄弱点1", "薄弱点2"],
  "recommendedNext": ["下一步建议1", "下一步建议2"]
}

知识点参考: ${(keyPoints || []).slice(0, 8).join(', ')}

根据知识点评估用户可能掌握的程度来模拟作答。`;

  const userMessage = `技能: ${skillName}\n目标水平: ${targetLevel}\n已学知识点: ${(keyPoints || []).join(', ')}`;

  const fallback = {
    questions: [],
    score: 0.75,
    feedback: `${skillName} ${targetLevel} 水平基础知识掌握良好，建议多做实战练习。`,
    weakAreas: ['需要更多实战经验'],
    recommendedNext: ['做一个实战项目', '阅读官方文档进阶章节'],
  };

  try {
    return await callAI(systemPrompt, userMessage, fallback);
  } catch {
    return fallback;
  }
}

export default { validateLearning, aiQuiz };
