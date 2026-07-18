const express = require('express');
const router = express.Router();
const auth = require('../lib/auth');

// 密码找回页面
router.get('/forgot', (req, res) => {
  res.render('forgot-password', { error: null, success: null });
});

// 处理密码找回请求
router.post('/forgot', async (req, res) => {
  const { username } = req.body;

  if (!username) {
    return res.render('forgot-password', {
      error: '请输入用户名',
      success: null
    });
  }

  const result = await auth.requestPasswordReset(username);

  if (!result.success) {
    return res.render('forgot-password', {
      error: result.error,
      success: null
    });
  }

  // 在实际应用中，这里会发送邮件
  // 为了演示，我们只显示成功消息
  res.render('forgot-password', {
    error: null,
    success: '密码重置链接已发送到您的邮箱，请查收邮件。\n\n（在演示环境中，邮件发送功能已集成，但您需要配置真实的邮件服务）'
  });
});

// 重置密码页面
router.get('/reset-password', (req, res) => {
  const { token, username } = req.query;

  if (!token || !username) {
    return res.render('reset-password', {
      error: '无效的重置链接',
      token: '',
      username: ''
    });
  }

  res.render('reset-password', {
    error: null,
    token,
    username
  });
});

// 处理密码重置
router.post('/reset-password', async (req, res) => {
  const { token, username, password, confirmPassword } = req.body;

  if (password !== confirmPassword) {
    return res.render('reset-password', {
      error: '两次输入的密码不一致',
      token,
      username
    });
  }

  const result = await auth.resetPassword(username, token, password);

  if (!result.success) {
    return res.render('reset-password', {
      error: result.error,
      token,
      username
    });
  }

  res.render('reset-success');
});

module.exports = router;