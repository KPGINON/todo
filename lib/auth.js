const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const store = require('./store');

// 需登录才能访问的路由
function requireAuth(req, res, next) {
  // 如果需要初始化，则允许访问 /login 设置密码
  if (needsInit()) {
    if (req.path === '/login' && req.method === 'GET') {
      return next();
    }
    // POST /login 来设置密码
    if (req.path === '/login' && req.method === 'POST') {
      return next();
    }
    // 其他所有请求都重定向到 /login
    return res.redirect('/login');
  }

  // 正常登录流程
  if (req.session.authenticated) {
    return next();
  }

  // 未认证，重定向到登录页
  res.redirect('/login');
}

// 首次访问时若未设置密码，则跳到初始化页设置密码
function needsInit() {
  return !store.getUser().passwordHash;
}

// 简易登录频率限制：同一 IP 在窗口期内失败次数过多则临时封禁
const loginAttempts = new Map(); // ip -> { count, firstAt }
const WINDOW_MS = 15 * 60 * 1000; // 15 分钟窗口
const MAX_ATTEMPTS = 10;
function checkRateLimit(ip) {
  const now = Date.now();
  const rec = loginAttempts.get(ip);
  if (rec && now - rec.firstAt > WINDOW_MS) {
    loginAttempts.delete(ip);
  }
  const cur = loginAttempts.get(ip);
  if (cur && cur.count >= MAX_ATTEMPTS) {
    throw new Error('尝试过于频繁，请 15 分钟后再试');
  }
}
function recordFailedLogin(ip) {
  const now = Date.now();
  const rec = loginAttempts.get(ip);
  if (!rec || now - rec.firstAt > WINDOW_MS) {
    loginAttempts.set(ip, { count: 1, firstAt: now });
  } else {
    rec.count++;
  }
}
function clearFailedLogin(ip) {
  loginAttempts.delete(ip);
}

function login(password, ip) {
  const hash = store.getUser().passwordHash;
  if (!hash) return false;
  checkRateLimit(ip);
  const ok = bcrypt.compareSync(password, hash);
  if (!ok) recordFailedLogin(ip);
  else clearFailedLogin(ip);
  return ok;
}

function initPassword(password) {
  const hash = bcrypt.hashSync(password, 10);
  store.setUserPasswordHash(hash);
  return true;
}

function logout(req) {
  return new Promise(resolve => {
    req.session.destroy(() => resolve());
  });
}

// CSRF：基于 session 的 token 方案
function ensureCsrfToken(req) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(16).toString('hex');
  }
  return req.session.csrfToken;
}

function verifyCsrf(req) {
  const token = req.body && req.body._csrf;
  return token && req.session.csrfToken && token === req.session.csrfToken;
}

module.exports = {
  requireAuth, needsInit, login, initPassword, logout,
  ensureCsrfToken, verifyCsrf,
  checkRateLimit
};
