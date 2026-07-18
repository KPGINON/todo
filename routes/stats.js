const express = require('express');
const router = express.Router();
const store = require('../lib/store');

// 统计仪表盘
router.get('/', async (req, res) => {
  const s = await store.stats(req.session.userId);
  res.render('stats', { stats: s });
});

module.exports = router;
