const express = require('express');
const router = express.Router();
const store = require('../lib/store');
const ai = require('../lib/ai');

// 设置页
router.get('/', async (req, res) => {
  const settings = await store.getSettings(req.session.userId);
  res.render('settings', { settings, msg: req.query.msg || '' });
});

// 保存设置（兼清除 API Key 动作）
router.post('/', async (req, res) => {
  // 清除 Key 动作：通过按钮 name=action value=clear-key 触发
  if (req.body.action === 'clear-key') {
    await store.setSettings({ aiApiKey: '' }, req.session.userId);
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
  await store.setSettings(patch, req.session.userId);
  res.redirect('/settings?msg=' + encodeURIComponent('设置已保存'));
});

// 测试 AI 连接（异步返回 JSON，供前端展示结果）
router.post('/ai/test', async (req, res) => {
  try {
    const result = await ai.testConnection(req.session.userId);
    res.json({ ok: true, model: result.model });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// 导出全部数据为 JSON 文件下载
router.get('/export', async (req, res) => {
  const data = await store.exportData(req.session.userId);
  const filename = `todo-backup-${Date.now()}.json`;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(JSON.stringify(data, null, 2));
});

// 导入数据（从 JSON 文本覆盖当前用户数据）
router.post('/import', async (req, res) => {
  const json = req.body.json || '';
  if (!json.trim()) {
    return res.redirect('/settings?msg=' + encodeURIComponent('未提供数据'));
  }
  try {
    const payload = JSON.parse(json);
    await store.importData(payload, req.session.userId);
    res.redirect('/settings?msg=' + encodeURIComponent('数据导入成功'));
  } catch (e) {
    res.redirect('/settings?msg=' + encodeURIComponent('导入失败：' + e.message));
  }
});

module.exports = router;
