const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_FILE = path.join(__dirname, '..', 'data.json');

const DEFAULT_DATA = {
  user: { passwordHash: null },
  settings: { aiBaseUrl: '', aiApiKey: '', aiModel: '', visionModel: '' },
  sessionSecret: null,
  todos: [],
  archives: []
};

// API Key 加密：用 sessionSecret 派生密钥进行 AES-256-GCM 加密
// 密文格式：base64(iv:authTag:ciphertext)，与明文区分（明文不含冒号）
const ALGO = 'aes-256-gcm';
function deriveKey(secret) {
  return crypto.createHash('sha256').update(String(secret)).digest();
}
function encryptApiKey(plain, secret) {
  if (!plain) return '';
  const key = deriveKey(secret);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}
function decryptApiKey(cipher, secret) {
  if (!cipher) return '';
  // 兼容未加密的明文（向后兼容历史数据）
  if (!/^[A-Za-z0-9+/]+=*$/.test(cipher) || cipher.length < 24) return cipher;
  try {
    const buf = Buffer.from(cipher, 'base64');
    if (buf.length < 12 + 16) return cipher; // 太短，当明文处理
    const iv = buf.slice(0, 12);
    const tag = buf.slice(12, 28);
    const enc = buf.slice(28);
    const key = deriveKey(secret);
    const decipher = crypto.createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
  } catch (e) {
    // 解密失败说明是明文历史数据，原样返回
    return cipher;
  }
}

function read() {
  if (!fs.existsSync(DATA_FILE)) {
    return JSON.parse(JSON.stringify(DEFAULT_DATA));
  }
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
}

function write(data) {
  // 原子写入：先写临时文件再 rename，避免写入中途崩溃导致 data.json 损坏
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, DATA_FILE);
}

function update(mutator) {
  const data = read();
  const ret = mutator(data);
  write(data);
  return ret !== undefined ? ret : data;
}

// 统一解析 tags：兼容数组与逗号分隔字符串
function parseTags(tags) {
  if (Array.isArray(tags)) return tags.map(s => String(s).trim()).filter(Boolean);
  return String(tags || '').split(',').map(s => s.trim()).filter(Boolean);
}

// 取今天日期 YYYY-MM-DD（本地时区）
function today() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// 启动时顺延：把所有未完成且 date < today 的 todo 的 date 更新为今天
function carryOver() {
  return update(data => {
    const t = today();
    let changed = false;
    data.todos.forEach(todo => {
      if (!todo.completed && todo.date < t) {
        todo.date = t;
        changed = true;
      }
    });
    return changed;
  });
}

// Todo CRUD
function listTodos(date) {
  const data = read();
  if (date) return data.todos.filter(t => t.date === date);
  return data.todos;
}

function getTodo(id) {
  return read().todos.find(t => t.id === id);
}

function createTodo({ title, priority = 'medium', dueDate = '', dueTime = '', tags = [], notes = '' }) {
  let todo;
  update(data => {
    // 默认 order = 现有最大 order + 1，新任务排到最后；无任何 order 时从 0 开始
    const maxOrder = data.todos.reduce((m, t) => {
      const o = typeof t.order === 'number' ? t.order : -1;
      return o > m ? o : m;
    }, -1);
    todo = {
      id: crypto.randomUUID(),
      title: title.trim(),
      completed: false,
      priority,
      dueDate,
      dueTime,
      tags: parseTags(tags),
      notes,
      createdAt: new Date().toISOString(),
      completedAt: null,
      date: today(),
      order: maxOrder + 1
    };
    data.todos.push(todo);
  });
  return todo;
}

function updateTodo(id, patch) {
  let updated = null;
  update(data => {
    const todo = data.todos.find(t => t.id === id);
    if (!todo) return;
    Object.assign(todo, patch);
    if (patch.completed === true && !todo.completedAt) todo.completedAt = new Date().toISOString();
    if (patch.completed === false) todo.completedAt = null;
    updated = todo;
  });
  return updated;
}

function deleteTodo(id) {
  update(data => {
    data.todos = data.todos.filter(t => t.id !== id);
  });
}

function reorderTodos(ids) {
  update(data => {
    const map = new Map(data.todos.map(t => [t.id, t]));
    // 当前最大 order，新顺序从它之后递增，保证排过的任务排在未排过的之前
    const maxOrder = data.todos.reduce((m, t) => {
      const o = typeof t.order === 'number' ? t.order : -1;
      return o > m ? o : m;
    }, -1);
    // 去重，避免重复 id 导致任务在列表中出现多次
    const seen = new Set();
    const ordered = [];
    ids.forEach((id, i) => {
      if (map.has(id) && !seen.has(id)) {
        seen.add(id);
        const t = map.get(id);
        t.order = maxOrder + i + 1; // 写入手动顺序
        ordered.push(t);
      }
    });
    const rest = data.todos.filter(t => !seen.has(t.id));
    data.todos = [...ordered, ...rest];
  });
}

// 批量操作：对多个 id 的任务统一应用 patch（完成/优先级/标签等）
function batchUpdate(ids, patch) {
  const idSet = new Set(ids);
  update(data => {
    data.todos.forEach(todo => {
      if (idSet.has(todo.id)) {
        Object.assign(todo, patch);
        if (patch.completed === true && !todo.completedAt) todo.completedAt = new Date().toISOString();
        if (patch.completed === false) todo.completedAt = null;
      }
    });
  });
}

// 批量删除
function batchDelete(ids) {
  const idSet = new Set(ids);
  update(data => {
    data.todos = data.todos.filter(t => !idSet.has(t.id));
  });
}

// 批量追加标签（在现有 tags 基础上增加，去重）
function batchAddTags(ids, tags) {
  const idSet = new Set(ids);
  const newTags = parseTags(tags);
  update(data => {
    data.todos.forEach(todo => {
      if (idSet.has(todo.id)) {
        const existing = new Set(todo.tags || []);
        newTags.forEach(tg => existing.add(tg));
        todo.tags = Array.from(existing);
      }
    });
  });
}

// 日清归档：把当天已完成的 todo 移入 archives，未完成的顺延到明天（其实启动已顺延，这里再保险）
function dailyClear(date) {
  return update(data => {
    const target = date || today();
    const done = data.todos.filter(t => t.date === target && t.completed);
    const undone = data.todos.filter(t => t.date === target && !t.completed);
    if (done.length === 0 && undone.length === 0) return { archived: 0, carriedOver: 0 };

    // 已完成的归档
    if (done.length > 0) {
      let arch = data.archives.find(a => a.date === target);
      if (!arch) {
        arch = { date: target, items: [] };
        data.archives.push(arch);
      }
      arch.items.push(...done);
    }
    // 未完成的顺延到今天（保险，通常 carryOver 已处理）；仅统计真正发生变更的
    const todayStr = today();
    let carried = 0;
    undone.forEach(item => {
      if (item.date < todayStr) { item.date = todayStr; carried++; }
    });

    // 从 todos 移除当天已归档的
    data.todos = data.todos.filter(t => !(t.date === target && t.completed));
    return { archived: done.length, carriedOver: carried };
  });
}

function listArchives() {
  return read().archives.sort((a, b) => b.date.localeCompare(a.date));
}

// 全局搜索：在 todos 和 archives.items 中按关键词匹配标题/备注/标签
function search(keyword) {
  const data = read();
  const kw = String(keyword || '').trim().toLowerCase();
  if (!kw) return { todos: [], archives: [] };

  const matchTodo = t => {
    if (t.title && t.title.toLowerCase().includes(kw)) return true;
    if (t.notes && t.notes.toLowerCase().includes(kw)) return true;
    if (Array.isArray(t.tags) && t.tags.some(tg => tg.toLowerCase().includes(kw))) return true;
    return false;
  };

  const todoHits = data.todos.filter(matchTodo);
  const archiveHits = [];
  data.archives.forEach(arch => {
    const items = arch.items.filter(matchTodo);
    if (items.length > 0) archiveHits.push({ date: arch.date, items });
  });

  return { todos: todoHits, archives: archiveHits };
}

// 统计：完成率、连续打卡天数、近 7 天归档数量、标签分布、优先级分布
function stats() {
  const data = read();
  const t = today();
  const todayTodos = data.todos.filter(x => x.date === t);
  const todayDone = todayTodos.filter(x => x.completed).length;
  const todayTotal = todayTodos.length;

  // 连续打卡天数：从今天往回数，有归档记录的连续天数
  const archiveDates = new Set(data.archives.map(a => a.date));
  let streak = 0;
  const d = new Date();
  for (;;) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const ds = `${y}-${m}-${day}`;
    if (archiveDates.has(ds) || (ds === t && todayDone > 0)) {
      streak++;
      d.setDate(d.getDate() - 1);
    } else if (ds === t && todayTotal === 0) {
      // 今天还没任务，不算断
      d.setDate(d.getDate() - 1);
    } else {
      break;
    }
    if (streak > 365) break; // 安全上限
  }

  // 近 7 天每日完成数
  const last7 = [];
  for (let i = 6; i >= 0; i--) {
    const dd = new Date();
    dd.setDate(dd.getDate() - i);
    const y = dd.getFullYear();
    const m = String(dd.getMonth() + 1).padStart(2, '0');
    const day = String(dd.getDate()).padStart(2, '0');
    const ds = `${y}-${m}-${day}`;
    const arch = data.archives.find(a => a.date === ds);
    const cnt = arch ? arch.items.length : 0;
    last7.push({ date: ds, count: cnt });
  }

  // 标签分布（近 30 天归档）
  const tagCount = {};
  const since = new Date();
  since.setDate(since.getDate() - 30);
  data.archives.forEach(arch => {
    if (arch.date >= `${since.getFullYear()}-${String(since.getMonth()+1).padStart(2,'0')}-${String(since.getDate()).padStart(2,'0')}`) {
      arch.items.forEach(item => {
        (item.tags || []).forEach(tg => { tagCount[tg] = (tagCount[tg] || 0) + 1; });
      });
    }
  });
  const tagDist = Object.entries(tagCount).sort((a, b) => b[1] - a[1]).slice(0, 8);

  // 总归档数
  const totalArchived = data.archives.reduce((s, a) => s + a.items.length, 0);

  return {
    todayDone,
    todayTotal,
    todayRate: todayTotal === 0 ? 0 : Math.round(todayDone / todayTotal * 100),
    streak,
    last7,
    tagDist,
    totalArchived,
    archiveDays: data.archives.length
  };
}

// 导出全部数据为可序列化对象（不含 sessionSecret 和加密的 API Key，避免泄露）
function exportData() {
  const data = read();
  const settings = { ...data.settings, aiApiKey: '' }; // 导出时清空 API Key
  return {
    user: { ...data.user },
    settings,
    todos: data.todos,
    archives: data.archives,
    exportedAt: new Date().toISOString()
  };
}

// 导入数据（覆盖现有数据）
function importData(payload) {
  update(data => {
    if (payload.user) data.user = payload.user;
    if (payload.settings) data.settings = payload.settings;
    if (Array.isArray(payload.todos)) data.todos = payload.todos;
    if (Array.isArray(payload.archives)) data.archives = payload.archives;
  });
}

// 用户/设置
function getUser() { return read().user; }
function setUserPasswordHash(hash) {
  update(data => { data.user.passwordHash = hash; });
}
// 读取设置：自动解密 aiApiKey（供后端调用 AI 时使用）
function getSettings() {
  const data = read();
  const settings = { ...data.settings };
  if (settings.aiApiKey && data.sessionSecret) {
    settings.aiApiKey = decryptApiKey(settings.aiApiKey, data.sessionSecret);
  }
  return settings;
}
// 保存设置：自动加密 aiApiKey（若提供了新 key）
function setSettings(patch) {
  update(data => {
    if (patch.aiApiKey) {
      // 有 sessionSecret 才加密，否则原样存（首次启动场景）
      patch = { ...patch };
      if (data.sessionSecret) {
        patch.aiApiKey = encryptApiKey(patch.aiApiKey, data.sessionSecret);
      }
    }
    Object.assign(data.settings, patch);
  });
}

// 持久化 session secret，避免重启后所有登录态失效
function getSessionSecret() {
  let data = read();
  if (!data.sessionSecret) {
    data.sessionSecret = crypto.randomBytes(32).toString('hex');
    write(data);
  }
  return data.sessionSecret;
}
function setSessionSecret(secret) {
  update(data => { data.sessionSecret = secret; });
}

module.exports = {
  read, write, update, parseTags,
  today, carryOver,
  listTodos, getTodo, createTodo, updateTodo, deleteTodo, reorderTodos,
  batchUpdate, batchDelete, batchAddTags,
  dailyClear, listArchives, search, stats, exportData, importData,
  getUser, setUserPasswordHash, getSettings, setSettings,
  getSessionSecret, setSessionSecret
};
