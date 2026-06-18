/**
 * AI 调用封装 —— Anthropic SDK 指向 DeepSeek 兼容端点
 * 提炼自 auto-earn-agent 的 generator.js 模式
 */
import { Anthropic } from '@anthropic-ai/sdk';
import CONFIG from './config.js';

let client = null;

function getClient() {
  if (!client) {
    client = new Anthropic({
      apiKey: CONFIG.anthropic.apiKey || 'sk-placeholder',
      baseURL: CONFIG.anthropic.baseUrl,
    });
  }
  return client;
}

/**
 * 从 AI 返回文本中提取 JSON
 * 策略 1: ```json ... ``` 代码块
 * 策略 2: 裸 JSON.parse
 * 策略 3: 正则匹配 {...}
 */
export function extractJSON(text) {
  if (!text || typeof text !== 'string') return {};

  // 策略 1: markdown 代码块
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) {
    try { return JSON.parse(fence[1].trim()); } catch {}
  }

  // 策略 2: 直接解析
  try { return JSON.parse(text.trim()); } catch {}

  // 策略 3: 正则提取 {...} 或 [...]
  const objMatch = text.match(/\{[\s\S]*\}/);
  if (objMatch) {
    try { return JSON.parse(objMatch[0]); } catch {}
  }
  const arrMatch = text.match(/\[[\s\S]*\]/);
  if (arrMatch) {
    try { return JSON.parse(arrMatch[0]); } catch {}
  }

  return {};
}

/**
 * 调用 AI 并提取 JSON 结果
 * @param {string} systemPrompt - 系统提示词
 * @param {string} userMessage - 用户消息
 * @param {object} fallbackTemplate - 失败时的回退数据
 * @returns {Promise<object>} 解析后的 JSON
 */
export async function callAI(systemPrompt, userMessage, fallbackTemplate = {}) {
  const apiKey = CONFIG.anthropic.apiKey;
  if (!apiKey || apiKey === 'sk-placeholder') {
    console.warn('[AI] ⚠️  未配置 API Key，使用回退模板');
    return generateFallback(fallbackTemplate);
  }

  const anthropic = getClient();

  try {
    const msg = await anthropic.messages.create({
      model: CONFIG.anthropic.model,
      max_tokens: CONFIG.anthropic.maxTokens,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    });

    const text = msg.content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('') || '';

    return extractJSON(text);
  } catch (err) {
    console.error(`[AI] 调用失败: ${err.message}`);
    console.error(`[AI] 使用回退模板`);
    return generateFallback(fallbackTemplate);
  }
}

/**
 * 生成回退数据 (API 不可用时)
 */
export function generateFallback(template) {
  // 深拷贝模板避免引用共享
  return JSON.parse(JSON.stringify(template));
}

export default { callAI, extractJSON, generateFallback };
