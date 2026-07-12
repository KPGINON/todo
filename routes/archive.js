const express = require('express');
const router = express.Router();
const store = require('../lib/store');

// 历史归档列表
router.get('/', (req, res) => {
  const archives = store.listArchives();
  res.render('archive', { archives });
});

// 查看某一天归档详情
router.get('/:date', (req, res) => {
  const date = req.params.date;
  const arch = store.listArchives().find(a => a.date === date);
  res.render('archive-detail', { date, items: arch ? arch.items : [], notFound: !arch });
});

module.exports = router;
