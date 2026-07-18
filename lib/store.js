const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { connectDB, isUsingFileStorage, getAllData, saveAllData } = require('./database');

const DATA_FILE = path.join(__dirname, '..', 'data.json');

const DEFAULT_DATA = {
  users: [],
  settings: { aiBaseUrl: '', aiApiKey: '', aiModel: '', visionModel: '' },
  userSettings: {},
  sessionSecret: null,
  todos: [],
  archives: []
};

// 启动时迁移：把没有 userId 的 todos/archives/settings 归到第一个用户（admin）名下
// 保证升级前的数据升级后仍可见、可操作
async function migrateOwnership() {
  await update(data => {
    if (!data.userSettings) data.userSettings = {};
    if (!Array.isArray(data.users) || data.users.length === 0) return false;
    const owner = data.users[0];
    let changed = false;
    data.todos.forEach(t => {
      if (!t.userId) { t.userId = owner.id; changed = true; }
    });
    data.archives.forEach(a => {
      if (!a.userId) { a.userId = owner.id; changed = true; }
    });
    // 把全局 settings 迁移给第一个用户（仅当该用户尚无 settings 时）
    if (data.settings && Object.keys(data.settings).length > 0 && !data.userSettings[owner.id]) {
      data.userSettings[owner.id] = { ...data.settings };
      changed = true;
    }
    return changed;
  });
}

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

async function read() {
  // 先确保连接已建立；connectDB 失败会回退到文件存储（置 usingFileStorage=true）
  if (!isUsingFileStorage()) {
    await connectDB();
  }
  if (isUsingFileStorage()) {
    if (!fs.existsSync(DATA_FILE)) {
      return JSON.parse(JSON.stringify(DEFAULT_DATA));
    }
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
  }
  const db = await connectDB();
  const data = await db.collection('app_data').findOne({ _id: 'main' });
  if (!data) {
    // 初始化数据
    await db.collection('app_data').insertOne({
      _id: 'main',
      ...DEFAULT_DATA
    });
    return { ...DEFAULT_DATA };
  }
  return data;
}

async function write(data) {
  if (!isUsingFileStorage()) {
    await connectDB();
  }
  if (isUsingFileStorage()) {
    // 原子写入：先写临时文件再 rename，避免写入中途崩溃导致 data.json 损坏
    const tmp = DATA_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, DATA_FILE);
    return;
  }
  const db = await connectDB();
  await db.collection('app_data').updateOne(
    { _id: 'main' },
    { $set: data },
    { upsert: true }
  );
}

async function update(mutator) {
  const data = await read();
  const ret = mutator(data);
  await write(data);
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
async function carryOver() {
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

// Todo CRUD —— 所有方法均按 userId 隔离
async function listTodos(date, userId) {
  const data = await read();
  let todos = userId ? data.todos.filter(t => t.userId === userId) : data.todos;
  if (date) todos = todos.filter(t => t.date === date);
  return todos;
}

async function getTodo(id, userId) {
  const data = await read();
  const todo = data.todos.find(t => t.id === id);
  if (!todo) return null;
  if (userId && todo.userId !== userId) return null;
  return todo;
}

async function createTodo({ title, priority = 'medium', dueDate = '', dueTime = '', tags = [], notes = '', userId }) {
  let todo;
  await update(data => {
    // 默认 order = 现有最大 order + 1，新任务排到最后；无任何 order 时从 0 开始
    const maxOrder = data.todos.reduce((m, t) => {
      const o = typeof t.order === 'number' ? t.order : -1;
      return o > m ? o : m;
    }, -1);
    todo = {
      id: crypto.randomUUID(),
      userId: userId || null,
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

async function updateTodo(id, userId, patch) {
  let updated = null;
  await update(data => {
    const todo = data.todos.find(t => t.id === id);
    if (!todo) return;
    if (userId && todo.userId !== userId) return;
    Object.assign(todo, patch);
    if (patch.completed === true && !todo.completedAt) todo.completedAt = new Date().toISOString();
    if (patch.completed === false) todo.completedAt = null;
    updated = todo;
  });
  return updated;
}

async function deleteTodo(id, userId) {
  await update(data => {
    data.todos = data.todos.filter(t => {
      if (t.id !== id) return true;
      if (userId && t.userId !== userId) return true;
      return false;
    });
  });
}

async function reorderTodos(ids, userId) {
  await update(data => {
    const map = new Map(data.todos.map(t => [t.id, t]));
    // 当前最大 order，新顺序从它之后递增，保证排过的任务排在未排过的之前
    const maxOrder = data.todos.reduce((m, t) => {
      const o = typeof t.order === 'number' ? t.order : -1;
      return o > m ? o : m;
    }, -1);
    // 去重，避免重复 id 导致任务在列表中出现多次；同时校验归属
    const seen = new Set();
    const ordered = [];
    ids.forEach((id, i) => {
      if (map.has(id) && !seen.has(id)) {
        const t = map.get(id);
        if (userId && t.userId !== userId) return; // 非本人任务，跳过
        seen.add(id);
        t.order = maxOrder + i + 1; // 写入手动顺序
        ordered.push(t);
      }
    });
    const rest = data.todos.filter(t => !seen.has(t.id));
    data.todos = [...ordered, ...rest];
  });
}

// 批量操作：对多个 id 的任务统一应用 patch（完成/优先级/标签等）
async function batchUpdate(ids, userId, patch) {
  const idSet = new Set(ids);
  await update(data => {
    data.todos.forEach(todo => {
      if (idSet.has(todo.id)) {
        if (userId && todo.userId !== userId) return;
        Object.assign(todo, patch);
        if (patch.completed === true && !todo.completedAt) todo.completedAt = new Date().toISOString();
        if (patch.completed === false) todo.completedAt = null;
      }
    });
  });
}

// 批量删除
async function batchDelete(ids, userId) {
  const idSet = new Set(ids);
  await update(data => {
    data.todos = data.todos.filter(t => {
      if (!idSet.has(t.id)) return true;
      if (userId && t.userId !== userId) return true;
      return false;
    });
  });
}

// 批量追加标签（在现有 tags 基础上增加，去重）
async function batchAddTags(ids, userId, tags) {
  const idSet = new Set(ids);
  const newTags = parseTags(tags);
  await update(data => {
    data.todos.forEach(todo => {
      if (idSet.has(todo.id)) {
        if (userId && todo.userId !== userId) return;
        const existing = new Set(todo.tags || []);
        newTags.forEach(tg => existing.add(tg));
        todo.tags = Array.from(existing);
      }
    });
  });
}

// 日清归档：把当天已完成的 todo 移入 archives，未完成的顺延到明天（其实启动已顺延，这里再保险）
async function dailyClear(date, userId) {
  return update(data => {
    const target = date || today();
    const done = data.todos.filter(t => t.date === target && t.completed && (!userId || t.userId === userId));
    const undone = data.todos.filter(t => t.date === target && !t.completed && (!userId || t.userId === userId));
    if (done.length === 0 && undone.length === 0) return { archived: 0, carriedOver: 0 };

    // 已完成的归档（按用户隔离归档记录）
    if (done.length > 0) {
      let arch = data.archives.find(a => a.date === target && (!userId || a.userId === userId));
      if (!arch) {
        arch = { userId: userId || null, date: target, items: [] };
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

    // 从 todos 移除当天已归档的（仅本人）
    const doneIds = new Set(done.map(d => d.id));
    data.todos = data.todos.filter(t => !doneIds.has(t.id));
    return { archived: done.length, carriedOver: carried };
  });
}

async function listArchives(userId) {
  const data = await read();
  const archives = userId ? data.archives.filter(a => a.userId === userId) : data.archives;
  return archives.sort((a, b) => b.date.localeCompare(a.date));
}

// 全局搜索：在 todos 和 archives.items 中按关键词匹配标题/备注/标签
async function search(keyword, userId) {
  const data = await read();
  const kw = String(keyword || '').trim().toLowerCase();
  if (!kw) return { todos: [], archives: [] };

  const matchTodo = t => {
    if (t.title && t.title.toLowerCase().includes(kw)) return true;
    if (t.notes && t.notes.toLowerCase().includes(kw)) return true;
    if (Array.isArray(t.tags) && t.tags.some(tg => tg.toLowerCase().includes(kw))) return true;
    return false;
  };

  const userTodos = userId ? data.todos.filter(t => t.userId === userId) : data.todos;
  const userArchives = userId ? data.archives.filter(a => a.userId === userId) : data.archives;
  const todoHits = userTodos.filter(matchTodo);
  const archiveHits = [];
  userArchives.forEach(arch => {
    const items = arch.items.filter(matchTodo);
    if (items.length > 0) archiveHits.push({ date: arch.date, items });
  });

  return { todos: todoHits, archives: archiveHits };
}

// 统计：完成率、连续打卡天数、近 7 天归档数量、标签分布、优先级分布
async function stats(userId) {
  const data = await read();
  const t = today();
  const userTodos = userId ? data.todos.filter(x => x.userId === userId) : data.todos;
  const userArchives = userId ? data.archives.filter(a => a.userId === userId) : data.archives;
  const todayTodos = userTodos.filter(x => x.date === t);
  const todayDone = todayTodos.filter(x => x.completed).length;
  const todayTotal = todayTodos.length;

  // 连续打卡天数：从今天往回数，有归档记录的连续天数
  const archiveDates = new Set(userArchives.map(a => a.date));
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
    const arch = userArchives.find(a => a.date === ds);
    const cnt = arch ? arch.items.length : 0;
    last7.push({ date: ds, count: cnt });
  }

  // 标签分布（近 30 天归档）
  const tagCount = {};
  const since = new Date();
  since.setDate(since.getDate() - 30);
  const sinceStr = `${since.getFullYear()}-${String(since.getMonth()+1).padStart(2,'0')}-${String(since.getDate()).padStart(2,'0')}`;
  userArchives.forEach(arch => {
    if (arch.date >= sinceStr) {
      arch.items.forEach(item => {
        (item.tags || []).forEach(tg => { tagCount[tg] = (tagCount[tg] || 0) + 1; });
      });
    }
  });
  const tagDist = Object.entries(tagCount).sort((a, b) => b[1] - a[1]).slice(0, 8);

  // 总归档数
  const totalArchived = userArchives.reduce((s, a) => s + a.items.length, 0);

  return {
    todayDone,
    todayTotal,
    todayRate: todayTotal === 0 ? 0 : Math.round(todayDone / todayTotal * 100),
    streak,
    last7,
    tagDist,
    totalArchived,
    archiveDays: userArchives.length
  };
}

// 导出全部数据为可序列化对象（不含 sessionSecret 和加密的 API Key，避免泄露）
async function exportData(userId) {
  const data = await read();
  const settings = userId ? (data.userSettings && data.userSettings[userId] ? { ...data.userSettings[userId] } : {}) : { ...data.settings };
  if (settings.aiApiKey && data.sessionSecret) {
    settings.aiApiKey = decryptApiKey(settings.aiApiKey, data.sessionSecret);
  }
  const todos = userId ? data.todos.filter(t => t.userId === userId) : data.todos;
  const archives = userId ? data.archives.filter(a => a.userId === userId) : data.archives;
  return {
    users: userId ? data.users.filter(u => u.id === userId) : data.users,
    settings,
    todos,
    archives,
    exportedAt: new Date().toISOString()
  };
}

// 导入数据（按用户隔离导入，保留当前登录用户的归属）
async function importData(payload, userId) {
  await update(data => {
    if (Array.isArray(payload.todos)) {
      const todos = userId
        ? payload.todos.map(t => ({ ...t, userId: t.userId || userId }))
        : payload.todos;
      data.todos = userId ? data.todos.filter(t => t.userId !== userId).concat(todos) : todos;
    }
    if (Array.isArray(payload.archives)) {
      const archives = userId
        ? payload.archives.map(a => ({ ...a, userId: a.userId || userId }))
        : payload.archives;
      data.archives = userId ? data.archives.filter(a => a.userId !== userId).concat(archives) : archives;
    }
    if (payload.settings && userId) {
      if (!data.userSettings) data.userSettings = {};
      data.userSettings[userId] = { ...data.userSettings[userId], ...payload.settings };
    }
  });
}

async function getUsers() {
  const data = await read();
  return data.users;
}

async function getUserByUsername(username) {
  const data = await read();
  return data.users.find(u => u.username === username);
}

async function getUserByEmail(email) {
  const data = await read();
  const e = String(email || '').toLowerCase();
  return data.users.find(u => (u.email || '').toLowerCase() === e);
}

async function createUser(email, passwordHash) {
  let user;
  await update(data => {
    // 检查邮箱是否已注册
    const e = String(email || '').toLowerCase();
    if (data.users.some(u => (u.email || '').toLowerCase() === e)) {
      throw new Error('该邮箱已注册');
    }

    user = {
      id: crypto.randomUUID(),
      email,
      // 兼容旧逻辑：username 取邮箱 @ 前部分，便于显示与历史 getUserByUsername
      username: String(email).split('@')[0],
      passwordHash,
      createdAt: new Date().toISOString(),
      lastLoginAt: null
    };
    data.users.push(user);
  });
  return user;
}

async function updateUserLoginTime(userId) {
  await update(data => {
    const user = data.users.find(u => u.id === userId);
    if (user) {
      user.lastLoginAt = new Date().toISOString();
    }
  });
}

// 保留原来的 getUser 和 setUserPasswordHash 函数，但更新其实现
async function getUser() {
  const data = await read();
  return data.users.length > 0 ? data.users[0] : { passwordHash: null };
}

async function setUserPasswordHash(hash) {
  await update(data => {
    if (data.users.length > 0) {
      data.users[0].passwordHash = hash;
    } else {
      // 为了向后兼容，如果还没有用户，则创建一个默认用户
      data.users.push({
        id: crypto.randomUUID(),
        username: 'admin',
        passwordHash: hash,
        createdAt: new Date().toISOString(),
        lastLoginAt: null
      });
    }
  });
}

// 注册邮箱验证码：email -> { code, expiresAt }
const registerCodes = new Map();
const REGISTER_CODE_EXPIRY = 10 * 60 * 1000; // 10 分钟
// 同一邮箱发送频率限制：email -> 最近一次发送时间戳
const registerCodeLastSent = new Map();
const REGISTER_CODE_COOLDOWN = 60 * 1000; // 60 秒冷却

function saveRegisterCode(email) {
  const e = String(email).toLowerCase();
  // 冷却检查：防止短时间内重复发送
  const lastSent = registerCodeLastSent.get(e);
  if (lastSent && Date.now() - lastSent < REGISTER_CODE_COOLDOWN) {
    const wait = Math.ceil((REGISTER_CODE_COOLDOWN - (Date.now() - lastSent)) / 1000);
    throw new Error(`发送太频繁，请 ${wait} 秒后再试`);
  }
  // 生成 6 位数字验证码
  const code = String(Math.floor(100000 + Math.random() * 900000));
  const expiresAt = Date.now() + REGISTER_CODE_EXPIRY;
  registerCodes.set(e, { code, expiresAt });
  registerCodeLastSent.set(e, Date.now());
  cleanupExpiredRegisterCodes();
  return code;
}

function verifyRegisterCode(email, code) {
  const e = String(email).toLowerCase();
  const record = registerCodes.get(e);
  if (!record) return false;
  if (Date.now() > record.expiresAt) {
    registerCodes.delete(e);
    return false;
  }
  if (record.code !== String(code)) return false;
  // 验证成功后消费掉，避免复用
  registerCodes.delete(e);
  registerCodeLastSent.delete(e);
  return true;
}

function cleanupExpiredRegisterCodes() {
  const now = Date.now();
  for (const [e, record] of registerCodes.entries()) {
    if (now > record.expiresAt) registerCodes.delete(e);
  }
}

// 密码找回功能
const passwordResetTokens = new Map(); // username -> { token, expiresAt }
const RESET_TOKEN_EXPIRY = 15 * 60 * 1000; // 15分钟

function generateResetToken(username) {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = Date.now() + RESET_TOKEN_EXPIRY;

  passwordResetTokens.set(username, { token, expiresAt });

  // 清理过期的token
  cleanupExpiredTokens();

  return token;
}

function validateResetToken(username, token) {
  const record = passwordResetTokens.get(username);

  if (!record) {
    return false;
  }

  if (Date.now() > record.expiresAt) {
    passwordResetTokens.delete(username);
    return false;
  }

  if (record.token !== token) {
    return false;
  }

  return true;
}

function clearResetToken(username) {
  passwordResetTokens.delete(username);
}

function cleanupExpiredTokens() {
  const now = Date.now();
  for (const [username, record] of passwordResetTokens.entries()) {
    if (now > record.expiresAt) {
      passwordResetTokens.delete(username);
    }
  }
}

async function getSettings(userId) {
  const data = await read();
  // 按用户隔离设置；回退到全局 settings 兼容旧数据与无 userId 调用
  let settings;
  if (userId && data.userSettings && data.userSettings[userId]) {
    // 用户设置优先，但用全局设置补齐缺失字段（如 AI 配置可能仍存全局）
    settings = { ...data.settings, ...data.userSettings[userId] };
  } else {
    settings = { ...data.settings };
  }
  if (settings.aiApiKey && data.sessionSecret) {
    settings.aiApiKey = decryptApiKey(settings.aiApiKey, data.sessionSecret);
  }
  return settings;
}
// 保存设置：自动加密 aiApiKey（若提供了新 key）
async function setSettings(patch, userId) {
  await update(data => {
    let target;
    if (userId) {
      if (!data.userSettings) data.userSettings = {};
      if (!data.userSettings[userId]) data.userSettings[userId] = {};
      target = data.userSettings[userId];
    } else {
      target = data.settings;
    }
    if (patch.aiApiKey) {
      // 有 sessionSecret 才加密，否则原样存（首次启动场景）
      patch = { ...patch };
      if (data.sessionSecret) {
        patch.aiApiKey = encryptApiKey(patch.aiApiKey, data.sessionSecret);
      }
    }
    Object.assign(target, patch);
  });
}

// 持久化 session secret，避免重启后所有登录态失效
async function getSessionSecret() {
  let data = await read();
  if (!data.sessionSecret) {
    data.sessionSecret = crypto.randomBytes(32).toString('hex');
    await write(data);
  }
  return data.sessionSecret;
}
async function setSessionSecret(secret) {
  await update(data => { data.sessionSecret = secret; });
}

module.exports = {
  read, write, update, parseTags,
  today, carryOver,
  listTodos, getTodo, createTodo, updateTodo, deleteTodo, reorderTodos,
  batchUpdate, batchDelete, batchAddTags,
  dailyClear, listArchives, search, stats, exportData, importData,
  getUser, setUserPasswordHash, getSettings, setSettings,
  getSessionSecret, setSessionSecret,
  getUsers, getUserByUsername, getUserByEmail, createUser, updateUserLoginTime,
  generateResetToken, validateResetToken, clearResetToken,
  saveRegisterCode, verifyRegisterCode,
  migrateOwnership
};
