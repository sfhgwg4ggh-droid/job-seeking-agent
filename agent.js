#!/usr/bin/env node
/**
 * 自主求职 Agent — 主入口 + 决策引擎
 *
 * 优先级驱动决策: discover_jobs > analyze_skills > learn > apply
 * CLI: node agent.js [--daemon] [--report] [--dry-run] [--reset]
 */
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import CONFIG from './modules/shared/config.js';
import { readJSON, writeJSON } from './modules/shared/storage.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ========== 状态管理 ==========

const DEFAULT_STATE = {
  startedAt: new Date().toISOString(),
  totalRuns: 0,
  totalErrors: 0,
  consecutiveErrors: 0,
  lastDiscoverJobsAt: null,
  lastAnalyzeSkillsAt: null,
  lastLearnAt: null,
  lastApplyAt: null,
  lastErrorAt: null,
  apiCallsToday: 0,
  apiCallDate: new Date().toISOString().split('T')[0],
};

async function loadState() {
  const state = await readJSON('agent-state.json', null);
  if (!state || Object.keys(state).length === 0) {
    return { ...DEFAULT_STATE };
  }
  // 每日 API 计数重置
  const today = new Date().toISOString().split('T')[0];
  if (state.apiCallDate !== today) {
    state.apiCallsToday = 0;
    state.apiCallDate = today;
  }
  return { ...DEFAULT_STATE, ...state };
}

async function saveState(state) {
  await writeJSON('agent-state.json', state);
}

// ========== 决策引擎 ==========

/**
 * 分析当前状态，返回按优先级排序的动作列表
 */
async function decide(state) {
  const actions = [];
  const now = new Date();

  // 检查熔断
  if (state.consecutiveErrors >= 5) {
    console.warn('[Agent] ⚠️  连续 5 次错误，触发熔断。跳过所有操作。');
    console.warn(`[Agent]    上次错误: ${state.lastErrorAt}`);
    console.warn('[Agent]    运行 node agent.js --reset 重置状态');
    return actions;
  }

  // 检查 API 配额
  const today = now.toISOString().split('T')[0];
  if (state.apiCallDate !== today) {
    state.apiCallsToday = 0;
    state.apiCallDate = today;
  }
  const apiExhausted = state.apiCallsToday >= CONFIG.anthropic.dailyLimit;
  if (apiExhausted) {
    console.log(`[Agent] ⚡ API 今日配额已用完 (${state.apiCallsToday}/${CONFIG.anthropic.dailyLimit})`);
  }

  // === 优先级 1: 发现职位 ===
  const hoursSinceDiscover = state.lastDiscoverJobsAt
    ? (now - new Date(state.lastDiscoverJobsAt)) / (1000 * 60 * 60)
    : Infinity;
  const jobs = await readJSON('jobs.json', []);
  const hasNoJobs = jobs.length === 0;
  const discoverDue = hoursSinceDiscover > CONFIG.jobs.searchInterval;

  if (hasNoJobs || discoverDue) {
    actions.push({
      priority: 1,
      action: 'discover_jobs',
      reason: hasNoJobs
        ? '没有职位数据，需要首次爬取'
        : `距上次搜索 ${hoursSinceDiscover.toFixed(1)} 小时 (> ${CONFIG.jobs.searchInterval}h)`,
      data: { keywordCount: CONFIG.jobs.keywords.length, platformCount: CONFIG.jobs.platforms.length },
    });
  }

  // === 优先级 2: 分析技能缺口 ===
  const newJobs = jobs.filter(j => j.status === 'new');
  const hoursSinceAnalyze = state.lastAnalyzeSkillsAt
    ? (now - new Date(state.lastAnalyzeSkillsAt)) / (1000 * 60 * 60)
    : Infinity;

  if (newJobs.length > 0 && !apiExhausted && hoursSinceAnalyze > 2) {
    actions.push({
      priority: 2,
      action: 'analyze_skills',
      reason: `${newJobs.length} 个新职位待分析`,
      data: { newJobCount: newJobs.length },
    });
  }

  // === 优先级 3: 学习技能 ===
  const inventory = await readJSON('skills-inventory.json', { skills: [] });
  const pendingGaps = (inventory.skills || []).filter(s => s.status === 'pending' && s.level === 'none');
  const hoursSinceLearn = state.lastLearnAt
    ? (now - new Date(state.lastLearnAt)) / (1000 * 60 * 60)
    : Infinity;

  if (pendingGaps.length > 0 && !apiExhausted && hoursSinceLearn > 3) {
    const urgentGaps = pendingGaps.filter(g => g.urgency === 'high');
    const gapsToShow = urgentGaps.length > 0 ? urgentGaps : pendingGaps;
    actions.push({
      priority: 3,
      action: 'learn',
      reason: `${pendingGaps.length} 个技能缺口待学习 (${urgentGaps.length} 紧急)`,
      data: { gapCount: pendingGaps.length, urgentCount: urgentGaps.length },
    });
  }

  // === 优先级 4: 投递申请 ===
  const eligibleJobs = jobs.filter(j =>
    j.status === 'analyzed' &&
    (j.matchScore || 0) >= CONFIG.application.minMatchScore
  );
  const applications = await readJSON('applications.json', []);
  const appliedIds = new Set(applications.map(a => a.jobId));
  const unapplied = eligibleJobs.filter(j => !appliedIds.has(j.id));
  const hoursSinceApply = state.lastApplyAt
    ? (now - new Date(state.lastApplyAt)) / (1000 * 60 * 60)
    : Infinity;

  if (unapplied.length > 0 && hoursSinceApply > 4) {
    actions.push({
      priority: 4,
      action: 'apply',
      reason: `${unapplied.length} 个匹配职位待投递 (匹配度 ≥ ${(CONFIG.application.minMatchScore * 100).toFixed(0)}%)`,
      data: { unappliedCount: unapplied.length, topJob: unapplied[0]?.title },
    });
  }

  // 按优先级排序
  actions.sort((a, b) => a.priority - b.priority);
  return actions;
}

// ========== 动作执行器 ==========

/**
 * 执行职位发现
 */
async function executeDiscoverJobs(state) {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🔍 优先级 1: 发现新职位');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  const { default: discovery } = await import('./modules/jobs/discovery.js');
  const jobs = await discovery.discoverJobs();

  state.lastDiscoverJobsAt = new Date().toISOString();
  return { action: 'discover_jobs', result: `${jobs.length} 个新职位` };
}

/**
 * 执行技能缺口分析
 */
async function executeAnalyzeSkills(state) {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📊 优先级 2: 分析技能缺口');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  const { default: gapAnalyzer } = await import('./modules/skills/gap-analyzer.js');
  const report = await gapAnalyzer.analyzeSkillGaps();

  state.lastAnalyzeSkillsAt = new Date().toISOString();
  return {
    action: 'analyze_skills',
    result: `分析了 ${report.totalJobsAnalyzed} 个职位，发现 ${report.gaps?.length || 0} 个技能缺口`,
    detail: report.summary,
  };
}

/**
 * 执行学习任务
 */
async function executeLearn(state) {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📚 优先级 3: 学习新技能');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  const inventory = await readJSON('skills-inventory.json', { skills: [] });
  const pendingGaps = (inventory.skills || [])
    .filter(s => s.status === 'pending' && s.level === 'none')
    .sort((a, b) => {
      const urgencyOrder = { high: 0, medium: 1, low: 2 };
      return (urgencyOrder[a.urgency] || 2) - (urgencyOrder[b.urgency] || 2);
    });

  if (pendingGaps.length === 0) {
    console.log('[Learn] 没有待学习的技能缺口');
    state.lastLearnAt = new Date().toISOString();
    return { action: 'learn', result: '无需学习' };
  }

  // 每次最多学 maxGapsPerRun 个技能
  const gapsToLearn = pendingGaps.slice(0, CONFIG.learning.maxGapsPerRun);
  const results = [];

  for (const gap of gapsToLearn) {
    try {
      console.log(`[Learn] 🎯 学习目标: ${gap.name} (目标: ${gap.requiredLevel || 'intermediate'})`);

      // 1. 搜索学习资源
      const { default: researcher } = await import('./modules/learning/researcher.js');
      const resources = await researcher.searchLearningResources(gap);

      // 2. 执行学习
      const { default: executor } = await import('./modules/learning/executor.js');
      const learningResult = await executor.executeLearning(gap, resources);

      // 3. 验证学习成果
      const { default: validator } = await import('./modules/learning/validator.js');
      const validation = await validator.validateLearning(gap.name, {
        ...learningResult,
        requiredLevel: gap.requiredLevel || 'intermediate',
      });

      results.push({ skill: gap.name, ...validation });
      state.apiCallsToday += 3; // 搜索 + 学习 + 验证 ≈ 3 次 AI 调用

    } catch (err) {
      console.error(`[Learn] 学习 "${gap.name}" 失败: ${err.message}`);
      results.push({ skill: gap.name, passed: false, error: err.message });
    }
  }

  state.lastLearnAt = new Date().toISOString();
  const passed = results.filter(r => r.passed).length;
  return {
    action: 'learn',
    result: `学习了 ${results.length} 个技能，${passed} 个通过验证`,
    detail: results.map(r => `${r.skill}: ${r.passed ? '✅ 通过' : '📚 待继续'}`).join(', '),
  };
}

/**
 * 执行投递申请
 */
async function executeApply(state) {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🚀 优先级 4: 投递申请');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  const { default: submitter } = await import('./modules/applications/submitter.js');
  const results = await submitter.autoApply();

  state.lastApplyAt = new Date().toISOString();
  return {
    action: 'apply',
    result: `处理了 ${results.length} 个职位`,
    detail: results.map(r => `${r.jobTitle}: ${r.success ? '✅' : '❌'} ${r.status || r.error}`).join('\n         '),
  };
}

// ========== 报告生成 ==========

async function generateReport(state) {
  const jobs = await readJSON('jobs.json', []);
  const inventory = await readJSON('skills-inventory.json', { skills: [] });
  const applications = await readJSON('applications.json', []);
  const progress = await readJSON('learning-progress.json', []);

  const now = new Date();
  const uptime = state.startedAt
    ? Math.floor((now - new Date(state.startedAt)) / (1000 * 60 * 60))
    : 0;

  const report = `
┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃         🤖 自主求职 Agent — 运行报告                         ┃
┣━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┫
┃ 📅 启动时间: ${(state.startedAt || '').slice(0, 19)}                    ┃
┃ ⏱  运行时长: ${uptime} 小时                                           ┃
┃ 🔄 总运行次数: ${state.totalRuns}                                         ┃
┃ ❌ 累计错误: ${state.totalErrors}                                           ┃
┃ 📡 API 今日用量: ${state.apiCallsToday}/${CONFIG.anthropic.dailyLimit}                               ┃
┣━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┫
┃ 🔍 职位数据                                                   ┃
┃    总数: ${jobs.length} 个职位                                            ┃
┃    状态分布: new=${jobs.filter(j => j.status === 'new').length} | analyzed=${jobs.filter(j => j.status === 'analyzed').length} | applied=${jobs.filter(j => j.status === 'applied').length} ┃
┃    平均匹配度: ${(jobs.filter(j => j.matchScore != null).reduce((s, j) => s + j.matchScore, 0) / Math.max(1, jobs.filter(j => j.matchScore != null).length) * 100).toFixed(0)}%                                        ┃
┣━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┫
┃ 💪 技能清单                                                   ┃
┃    已掌握: ${inventory.skills?.filter(s => s.level !== 'none').length || 0} 个 | 待学习: ${inventory.skills?.filter(s => s.level === 'none').length || 0} 个                    ┃
┃    技能: ${(inventory.skills || []).filter(s => s.level !== 'none').map(s => `${s.name}(${s.level})`).join(', ') || '无'} ┃
┣━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┫
┃ 📝 申请进度                                                   ┃
┃    已生成: ${applications.length} 个 | 已提交: ${applications.filter(a => a.status === 'submitted').length} 个              ┃
┃    面试邀请: ${applications.filter(a => a.status === 'interview').length} 个 | Offer: ${applications.filter(a => a.status === 'offer').length} 个     ┃
┣━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┫
┃ 📚 学习进度                                                   ┃
┃    学习记录: ${progress.length} 条                                            ┃
┃    验证通过: ${progress.filter(p => p.validationStatus === 'verified' || p.passed).length} 个                                      ┃
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛
`;

  console.log(report);
}

// ========== 主循环 ==========

async function main() {
  // 解析 CLI 参数
  const args = process.argv.slice(2);
  const isDaemon = args.includes('--daemon');
  const isReport = args.includes('--report');
  const isDryRun = args.includes('--dry-run');
  const isReset = args.includes('--reset');

  console.log(`
╔══════════════════════════════════════════════════╗
║       🤖 自主求职 Agent v1.0                     ║
║       找工作 · 学技能 · 投简历                   ║
╚══════════════════════════════════════════════════╝
`);

  // 加载状态
  let state = await loadState();

  if (isReset) {
    console.log('[Agent] 🔄 重置错误状态...');
    state.consecutiveErrors = 0;
    state.totalErrors = 0;
    state.lastErrorAt = null;
    await saveState(state);
    console.log('[Agent] ✅ 状态已重置');
    if (!isDaemon) return;
  }

  // 仅报告模式
  if (isReport) {
    await generateReport(state);
    return;
  }

  // 决策
  state.totalRuns++;
  const actions = await decide(state);

  if (actions.length === 0) {
    console.log('[Agent] 😴 当前没有需要执行的任务');
    console.log('[Agent]    所有模块状态健康，等待下一次检查周期');

    if (isDaemon) {
      console.log(`[Agent] 💤 ${CONFIG.daemonInterval} 分钟后再次检查...\n`);
      await saveState(state);
      setTimeout(() => {
        process.argv = [process.argv[0], process.argv[1], '--daemon'];
        main();
      }, CONFIG.daemonInterval * 60 * 1000);
    }
    return;
  }

  // 预演模式
  if (isDryRun) {
    console.log('[Agent] 🔮 DRY RUN — 以下是将要执行的动作:\n');
    for (const a of actions) {
      console.log(`  P${a.priority} [${a.action}] ${a.reason}`);
      console.log(`     数据: ${JSON.stringify(a.data)}\n`);
    }
    console.log(`[Agent] 共 ${actions.length} 个动作。去掉 --dry-run 以执行。`);
    return;
  }

  // 执行动作
  console.log(`[Agent] 🎯 本次执行 ${actions.length} 个动作:\n`);
  for (const a of actions) {
    console.log(`  P${a.priority} [${a.action}] — ${a.reason}`);
  }
  console.log('');

  const executorMap = {
    discover_jobs: executeDiscoverJobs,
    analyze_skills: executeAnalyzeSkills,
    learn: executeLearn,
    apply: executeApply,
  };

  for (const action of actions) {
    const executor = executorMap[action.action];
    if (!executor) {
      console.warn(`[Agent] 未知动作: ${action.action}`);
      continue;
    }

    try {
      const result = await executor(state);
      state.consecutiveErrors = 0; // 成功后重置错误计数
      console.log(`[Agent] ✅ ${result.action}: ${result.result}`);
      if (result.detail) {
        console.log(`         ${result.detail}`);
      }
    } catch (err) {
      state.consecutiveErrors++;
      state.totalErrors++;
      state.lastErrorAt = new Date().toISOString();
      console.error(`[Agent] ❌ ${action.action} 执行失败: ${err.message}`);
      // 不中断，继续执行剩余动作
    }
  }

  // 保存状态
  await saveState(state);

  // 生成简要报告
  console.log('');
  await generateReport(state);

  // 守护模式：定时循环
  if (isDaemon) {
    const interval = CONFIG.daemonInterval;
    console.log(`[Agent] 💤 守护模式 — ${interval} 分钟后再次检查...`);
    console.log(`[Agent]    按 Ctrl+C 停止\n`);
    setTimeout(() => {
      process.argv = [process.argv[0], process.argv[1], '--daemon'];
      main();
    }, interval * 60 * 1000);
  }
}

// ========== 启动 ==========
main().catch(err => {
  console.error('[Agent] 💥 致命错误:', err);
  process.exit(1);
});
