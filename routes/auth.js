const express = require('express');
const router = express.Router();
const auth = require('../lib/auth');

// 登录页（兼首次初始化密码）
router.get('/login', async (req, res) => {
  const init = await auth.needsInit();
  res.render('login', { init, error: null });
});

router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  const ip = req.ip;

  if (await auth.needsInit()) {
    // 首次：设置密码（创建第一个 admin 用户）
    if (!password || password.length < 4) {
      return res.render('login', { init: true, error: '密码至少 4 位' });
    }
    await auth.initPassword(password);
    // initPassword 已创建 username='admin' 的用户，登录拿到真实 userId
    const result = await auth.login('admin', password, ip);
    if (result.success) {
      req.session.userId = result.userId;
    }
    return res.redirect('/');
  }

  // 正常登录流程
  if (!username) {
    return res.render('login', { init: false, error: '请输入用户名' });
  }

  let result;
  try {
    result = await auth.login(username, password, ip);
  } catch (e) {
    return res.render('login', { init: false, error: e.message });
  }

  if (!result.success) {
    return res.render('login', { init: false, error: result.error });
  }

  req.session.userId = result.userId;
  res.redirect('/');
});

router.post('/logout', async (req, res) => {
  await auth.logout(req);
  res.redirect('/login');
});

module.exports = router;
