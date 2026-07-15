const express = require('express');
const router = express.Router();
const store = require('../lib/store');
const ai = require('../lib/ai');
const { connectDB } = require('../lib/database');
const { checkRateLimit, recordFailedLogin, clearFailedLogin } = require('../lib/auth');

// 登录用户
router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  const ip = req.ip;

  if (!username || !password) {
    return res.render('login', { error: '用户名和密码都是必填的' });
  }

  try {
    const db = await connectDB();
    const users = db.collection('users');

    // 查找用户
    const user = await users.findOne({ username });
    if (!user) {
      // 记录失败登录
      recordFailedLogin(ip);
      return res.render('login', { error: '用户名或密码错误' });
    }

    // 验证密码
    const bcrypt = require('bcrypt');
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      // 记录失败登录
      recordFailedLogin(ip);
      return res.render('login', { error: '用户名或密码错误' });
    }

    // 登录成功，清除失败记录并设置会话
    clearFailedLogin(ip);
    req.session.userId = user._id;
    req.session.username = user.username;
    req.session.authenticated = true;

    res.redirect('/today');
  } catch (error) {
    console.error('登录失败:', error);
    res.render('login', { error: '登录失败，请稍后重试' });
  }
});

// 注册新用户
router.post('/register', async (req, res) => {
  const { username, password, confirmPassword } = req.body;

  // 验证输入
  if (!username || !password || !confirmPassword) {
    return res.render('register', { error: '所有字段都是必填的' });
  }

  if (password !== confirmPassword) {
    return res.render('register', { error: '两次输入的密码不一致' });
  }

  if (password.length < 6) {
    return res.render('register', { error: '密码至少需要6个字符' });
  }

  try {
    const db = await connectDB();
    const users = db.collection('users');

    // 检查用户名是否已存在
    const existingUser = await users.findOne({ username });
    if (existingUser) {
      return res.render('register', { error: '用户名已被占用' });
    }

    // 创建新用户
    const bcrypt = require('bcrypt');
    const hashedPassword = await bcrypt.hash(password, 10);
    await users.insertOne({
      username,
      password: hashedPassword,
      createdAt: new Date()
    });

    res.redirect('/login?msg=' + encodeURIComponent('注册成功，请登录'));
  } catch (error) {
    console.error('注册失败:', error);
    res.render('register', { error: '注册失败，请稍后重试' });
  }
});

// 设置页
router.get('/', (req, res) => {
  const settings = store.getSettings();
  res.render('settings', { settings, msg: req.query.msg || '' });
});

// 保存设置（兼清除 API Key 动作）
router.post('/', (req, res) => {
  // 清除 Key 动作：通过按钮 name=action value=clear-key 触发
  if (req.body.action === 'clear-key') {
    store.setSettings({ aiApiKey: '' });
    return res.redirect('/settings?msg=' + encodeURIComponent('API Key 已清除'));
  }
  const { aiBaseUrl, aiApiKey, aiModel, visionModel } = req.body;
  const patch = {
    aiBaseUrl: (aiBaseUrl || '').trim(),
    aiModel: (aiModel || '').trim(),
    visionModel: (visionModel || '').trim()
  };
  // 仅在用户填写了新 key 时才更新，避免掩码提交覆盖原值
  if (aiApiKey && aiApiKey.trim()) {
    patch.aiApiKey = aiApiKey.trim();
  }
  store.setSettings(patch);
  res.redirect('/settings?msg=' + encodeURIComponent('设置已保存'));
});

// 测试 AI 连接（异步返回 JSON，供前端展示结果）
router.post('/ai/test', async (req, res) => {
  try {
    const result = await ai.testConnection();
    res.json({ ok: true, model: result.model });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// 导出全部数据为 JSON 文件下载
router.get('/export', (req, res) => {
  const data = store.exportData();
  const filename = `todo-backup-${Date.now()}.json`;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(JSON.stringify(data, null, 2));
});

// 导入数据（从 JSON 文本覆盖现有数据）
router.post('/import', (req, res) => {
  const json = req.body.json || '';
  if (!json.trim()) {
    return res.redirect('/settings?msg=' + encodeURIComponent('未提供数据'));
  }
  try {
    const payload = JSON.parse(json);
    store.importData(payload);
    res.redirect('/settings?msg=' + encodeURIComponent('数据导入成功'));
  } catch (e) {
    res.redirect('/settings?msg=' + encodeURIComponent('导入失败：' + e.message));
  }
});

module.exports = router;
