/**
 * Playwright 浏览器工厂 —— 反检测 + 中文本地化
 * 适配自 auto-earn-agent 的 browser-setup.js
 */
import { chromium } from 'playwright';

// 中文环境 User-Agent 轮换池
const UA_POOL = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
];

/**
 * 启动 Chromium 浏览器
 * @param {boolean} headless - 是否无头模式
 */
export async function launchBrowser(headless = true) {
  const args = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-blink-features=AutomationControlled',
    '--disable-dev-shm-usage',
  ];
  if (!process.env.CI && !process.env.GITHUB_ACTIONS) {
    args.push('--disable-software-rasterizer');
  }

  return chromium.launch({
    headless,
    args,
    slowMo: process.env.CI ? 0 : 80, // 非 CI 模式模拟人类操作速度
  });
}

/**
 * 创建反检测浏览器上下文 (中文环境)
 */
export async function createStealthContext(browser) {
  const ua = UA_POOL[Math.floor(Math.random() * UA_POOL.length)];

  const context = await browser.newContext({
    userAgent: ua,
    viewport: { width: 1920, height: 1080 },
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    extraHTTPHeaders: {
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    },
  });

  // 注入反检测脚本：隐藏 webdriver 标记
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    // @ts-ignore
    window.chrome = { runtime: {} };
  });

  return context;
}

/**
 * 随机延迟 (毫秒)
 */
export function randomDelay(min = 2000, max = 6000) {
  const ms = Math.floor(Math.random() * (max - min + 1)) + min;
  return new Promise(resolve => setTimeout(resolve, ms));
}

export default { launchBrowser, createStealthContext, randomDelay };
