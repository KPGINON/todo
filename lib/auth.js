const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const store = require('./store');

// 需登录才能访问的路由
async function requireAuth(req, res, next) {
  // 如果没有用户，则允许访问 /login 设置密码
  if (await needsInit()) {
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
  if (req.session.userId) {
    return next();
  }

  // 未认证，重定向到登录页
  res.redirect('/login');
}

// 首次访问时若未设置密码，则跳到初始化页设置密码
async function needsInit() {
  const users = await store.getUsers();
  return users.length === 0;
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

async function login(username, password, ip) {
  // 兼容邮箱登录：优先按邮箱查，回退到用户名
  let user = await store.getUserByEmail(username);
  if (!user) user = await store.getUserByUsername(username);
  if (!user) return { success: false, error: '用户名不存在' };

  checkRateLimit(ip);
  const ok = bcrypt.compareSync(password, user.passwordHash);

  if (!ok) {
    recordFailedLogin(ip);
    return { success: false, error: '密码错误' };
  }

  clearFailedLogin(ip);


  // 更新用户最后登录时间
  store.updateUserLoginTime(user.id);

  return { success: true, userId: user.id };
}

async function initPassword(password) {
  const hash = bcrypt.hashSync(password, 10);
  await store.setUserPasswordHash(hash);
  return true;
}

// 用户注册
async function register(username, password) {
  // 验证密码强度
  if (!password || password.length < 6) {
    return { success: false, error: '密码至少需要6位' };
  }

  const hash = bcrypt.hashSync(password, 10);
  try {
    const user = await store.createUser(username, hash);
    return { success: true, userId: user.id };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// 发送注册验证码：校验邮箱未注册 → 生成验证码 → 发送邮件
async function sendRegisterCode(email) {
  const e = String(email || '').trim().toLowerCase();
  if (!e || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) {
    return { success: false, error: '请输入有效的邮箱地址' };
  }

  // 邮箱已注册则不允许再发验证码（不暴露"是否已注册"，统一返回成功以防探测）
  const existing = await store.getUserByEmail(e);
  if (existing) {
    return { success: false, error: '该邮箱已注册' };
  }

  let code;
  try {
    code = store.saveRegisterCode(e);
  } catch (err) {
    return { success: false, error: err.message };
  }

  if (!mailTransporter) {
    return { success: false, error: '邮件服务未配置' };
  }

  const mailOptions = {
    from: process.env.MAIL_FROM,
    to: e,
    subject: '注册验证码',
    html: `<p>您好，</p>
           <p>您的注册验证码是：<strong style="font-size:18px">${code}</strong></p>
           <p>验证码 10 分钟内有效，请勿告知他人。</p>
           <p>如非本人操作，请忽略此邮件。</p>
           <p>此致，<br>Todo 应用团队</p>`
  };

  return new Promise(resolve => {
    mailTransporter.sendMail(mailOptions, (error) => {
      if (error) {
        console.log('注册验证码发送失败:', error);
        resolve({ success: false, error: '验证码发送失败，请稍后重试' });
      } else {
        resolve({ success: true });
      }
    });
  });
}

// 使用验证码完成注册
async function registerWithCode(email, code, password, confirmPassword) {
  const e = String(email || '').trim().toLowerCase();
  if (!e || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) {
    return { success: false, error: '请输入有效的邮箱地址' };
  }
  if (!code) {
    return { success: false, error: '请输入验证码' };
  }
  if (!password || password.length < 6) {
    return { success: false, error: '密码至少需要6位' };
  }
  if (password !== confirmPassword) {
    return { success: false, error: '两次输入的密码不一致' };
  }
  if (!store.verifyRegisterCode(e, code)) {
    return { success: false, error: '验证码无效或已过期' };
  }

  const hash = bcrypt.hashSync(password, 10);
  try {
    const user = await store.createUser(e, hash);
    return { success: true, userId: user.id };
  } catch (error) {
    return { success: false, error: error.message };
  }
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

let mailTransporter = null;

// 设置邮件服务
function setMailTransporter(transporter) {
  mailTransporter = transporter;
}

// 密码找回相关功能
async function requestPasswordReset(username) {
  // 兼容邮箱找回：优先按邮箱查，回退到用户名
  let user = await store.getUserByEmail(username);
  if (!user) user = await store.getUserByUsername(username);
  if (!user) {
    return { success: false, error: '用户名不存在' };
  }

  const token = store.generateResetToken(username);

  // 发送密码重置邮件
  if (mailTransporter) {
    const resetLink = `${process.env.APP_URL || 'http://localhost:3002'}/password/reset-password?token=${token}&username=${encodeURIComponent(username)}`;

    const mailOptions = {
      from: process.env.MAIL_FROM,
      to: user.username, // 在实际应用中，这里应该是用户的邮箱
      subject: '密码重置请求',
      html: `<p>您好，</p>
             <p>您收到了一封密码重置请求。如果这不是您本人操作，请忽略此邮件。</p>
             <p>点击以下链接重置您的密码：</p>
             <p><a href="${resetLink}">${resetLink}</a></p>
             <p>此链接将在15分钟后失效。</p>
             <p>此致，</p>
             <p>Todo 应用团队</p>`
    };

    // 发送邮件
    mailTransporter.sendMail(mailOptions, (error, info) => {
      if (error) {
        console.log('邮件发送失败:', error);
      } else {
        console.log('邮件已发送:', info.response);
      }
    });
  }

  return { success: true };
}

async function resetPassword(username, token, newPassword) {
  if (!await store.validateResetToken(username, token)) {
    return { success: false, error: '重置链接无效或已过期' };
  }

  if (!newPassword || newPassword.length < 6) {
    return { success: false, error: '密码至少需要6位' };
  }

  const hash = bcrypt.hashSync(newPassword, 10);

  // 更新用户密码
  await store.update(data => {
    const user = data.users.find(u => u.username === username);
    if (user) {
      user.passwordHash = hash;
    }
  });

  // 清除重置token
  store.clearResetToken(username);

  return { success: true };
}

module.exports = {
  requireAuth, needsInit, login, initPassword, register, registerWithCode, sendRegisterCode, logout,
  ensureCsrfToken, verifyCsrf,
  checkRateLimit,
  requestPasswordReset,
  resetPassword,
  setMailTransporter
};
