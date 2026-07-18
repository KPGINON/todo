const express = require('express');
const router = express.Router();
const auth = require('../lib/auth');

// 注册页面
router.get('/', (req, res) => {
  res.render('register', { error: null, success: null });
});

// 发送注册验证码
router.post('/code', async (req, res) => {
  const { email } = req.body;
  const result = await auth.sendRegisterCode(email);
  if (!result.success) {
    return res.status(400).json({ success: false, error: result.error });
  }
  res.json({ success: true });
});

// 处理注册请求
router.post('/', async (req, res) => {
  const { email, code, password, confirmPassword } = req.body;

  const result = await auth.registerWithCode(email, code, password, confirmPassword);

  if (!result.success) {
    return res.render('register', { error: result.error, success: null });
  }

  // 注册成功，自动登录
  req.session.userId = result.userId;
  res.redirect('/');
});

module.exports = router;
