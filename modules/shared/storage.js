/**
 * JSON 文件持久化 —— 文件系统即数据库
 * 完全复用 auto-earn-agent 的 storage 模式
 */
import { readFile, writeFile, mkdir } from 'fs/promises';
import { dirname } from 'path';
import CONFIG from './config.js';

/**
 * 读取 JSON 文件，不存在时返回默认值
 */
export async function readJSON(filename, defaultValue = null) {
  const filePath = filename.startsWith(CONFIG.dataDir)
    ? filename
    : `${CONFIG.dataDir}/${filename}`;
  try {
    const raw = await readFile(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') {
      return defaultValue !== null ? defaultValue : (Array.isArray(defaultValue) ? [] : null);
    }
    throw err;
  }
}

/**
 * 写入 JSON 文件，自动创建目录
 */
export async function writeJSON(filename, data) {
  const filePath = filename.startsWith(CONFIG.dataDir)
    ? filename
    : `${CONFIG.dataDir}/${filename}`;
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

/**
 * 追加到 JSON 数组，支持按 uniqueKey 去重
 */
export async function appendToJSON(filename, item, uniqueKey = null) {
  const list = await readJSON(filename, []);
  if (uniqueKey) {
    const exists = list.some(entry => entry[uniqueKey] === item[uniqueKey]);
    if (exists) return list;
  }
  item._updated = new Date().toISOString();
  list.push(item);
  await writeJSON(filename, list);
  return list;
}

/**
 * 按条件更新 JSON 数组中的第一个匹配项
 */
export async function updateJSON(filename, predicate, updates) {
  const list = await readJSON(filename, []);
  const idx = list.findIndex(predicate);
  if (idx === -1) return null;
  list[idx] = { ...list[idx], ...updates, _updated: new Date().toISOString() };
  await writeJSON(filename, list);
  return list[idx];
}

export default { readJSON, writeJSON, appendToJSON, updateJSON };
