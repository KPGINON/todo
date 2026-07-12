const express = require('express');
const router = express.Router();
const auth = require('../lib/auth');

// 登录页（兼首次初始化密码）
router.get('/login', (req, res) => {
  const init = auth.needsInit();
  res.render('login', { init, error: null });
});

router.post('/login', (req, res) => {
  const { password } = req.body;
  const ip = req.ip;
  if (auth.needsInit()) {
    // 首次：设置密码
    if (!password || password.length < 4) {
      return res.render('login', { init: true, error: '密码至少 4 位' });
    }
    auth.initPassword(password);
    req.session.userId = 'me';
    return res.redirect('/');
  }
  let ok;
  try {
    ok = auth.login(password, ip);
  } catch (e) {
    return res.render('login', { init: false, error: e.message });
  }
  if (!ok) {
    return res.render('login', { init: false, error: '密码错误' });
  }
  req.session.userId = 'me';
  res.redirect('/');
});

router.post('/logout', async (req, res) => {
  await auth.logout(req);
  res.redirect('/login');
});

module.exports = router;
