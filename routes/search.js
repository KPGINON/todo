const express = require('express');
const router = express.Router();
const store = require('../lib/store');

// 搜索页
router.get('/', async (req, res) => {
  const q = (req.query.q || '').trim();
  let result = { todos: [], archives: [] };
  if (q) result = await store.search(q, req.session.userId);
  res.render('search', { q, result });
});

module.exports = router;
