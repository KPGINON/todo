const express = require('express');
const router = express.Router();
const store = require('../lib/store');

// 搜索页
router.get('/', (req, res) => {
  const q = (req.query.q || '').trim();
  let result = { todos: [], archives: [] };
  if (q) result = store.search(q);
  res.render('search', { q, result });
});

module.exports = router;
