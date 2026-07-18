const express = require('express');
const router = express.Router();
const store = require('../lib/store');

// 历史归档列表
router.get('/', async (req, res) => {
  const archives = await store.listArchives(req.session.userId);
  res.render('archive', { archives });
});

// 查看某一天归档详情
router.get('/:date', async (req, res) => {
  const date = req.params.date;
  const arch = (await store.listArchives(req.session.userId)).find(a => a.date === date);
  res.render('archive-detail', { date, items: arch ? arch.items : [], notFound: !arch });
});

module.exports = router;
