const express = require('express');
const router = express.Router();
const store = require('../lib/store');

// 统计仪表盘
router.get('/', (req, res) => {
  const s = store.stats();
  res.render('stats', { stats: s });
});

module.exports = router;
