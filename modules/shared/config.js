/**
 * 全局配置 —— 自主求职 Agent
 * 所有路径、API 密钥、策略参数集中管理
 */
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');

export const CONFIG = {
  // ========== 路径 ==========
  rootDir: ROOT,
  dataDir: resolve(ROOT, 'data'),
  modulesDir: resolve(ROOT, 'modules'),

  // ========== AI API (通过 DeepSeek 兼容端点) ==========
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY || '',
    baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.deepseek.com/anthropic',
    model: process.env.ANTHROPIC_MODEL || 'DeepSeek-V4-flash',
    fallbackModel: process.env.ANTHROPIC_FALLBACK_MODEL || 'DeepSeek-V4-pro[1m]',
    maxTokens: 8000,
    dailyLimit: 20,          // 每天 AI 调用上限，控制成本
  },

  // ========== 求职策略 ==========
  jobs: {
    platforms: ['boss', 'lagou', '51job'],
    keywords: [
      '前端开发', '后端开发', '全栈开发',
      'Node.js 开发', 'Python 开发', 'React 开发',
    ],
    city: '不限',
    maxJobsPerRun: 30,       // 每次最多爬取职位数
    searchInterval: 6,       // 搜索间隔 (小时)
  },

  // ========== 学习策略 ==========
  learning: {
    maxGapsPerRun: 2,        // 每次最多学习的技能缺口数
    maxResourcesPerGap: 3,   // 每个缺口最多找 3 个学习资源
    validationThreshold: 0.7,// 验证通过阈值 (70%)
    sources: [
      { name: 'MDN', url: 'https://developer.mozilla.org' },
      { name: 'freeCodeCamp', url: 'https://www.freecodecamp.org' },
      { name: '菜鸟教程', url: 'https://www.runoob.com' },
      { name: 'B站', url: 'https://search.bilibili.com' },
    ],
  },

  // ========== 投递策略 ==========
  application: {
    maxApplicationsPerDay: 5,
    minMatchScore: 0.4,      // 最低匹配分数才生成简历
    autoSubmit: false,        // 是否自动填表提交 (安全起见默认关)
    requireGapAnalysis: true, // 是否需要先分析技能缺口再投递
  },

  // ========== 运行环境 ==========
  daemonInterval: 60,        // 守护模式间隔 (分钟)
  isCI: !!process.env.CI || !!process.env.GITHUB_ACTIONS,
};

export default CONFIG;
