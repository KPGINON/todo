const express = require('express');
const router = express.Router();
const store = require('../lib/store');
const ai = require('../lib/ai');

// 今日清单页
router.get('/', (req, res) => {
  const today = store.today();
  const todos = store.listTodos(today);
  // 按优先级排序辅助
  const order = { high: 0, medium: 1, low: 2 };
  todos.sort((a, b) => {
    if (a.completed !== b.completed) return a.completed ? 1 : -1;
    const pa = order[a.priority] ?? 1, pb = order[b.priority] ?? 1;
    if (pa !== pb) return pa - pb;
    if (a.dueTime && b.dueTime) return a.dueTime.localeCompare(b.dueTime);
    if (a.dueTime) return -1;
    if (b.dueTime) return 1;
    return a.createdAt.localeCompare(b.createdAt);
  });
  res.render('today', { todos, today, msg: req.query.msg || '' });
});

// 新增
router.post('/todos', (req, res) => {
  const { title, priority, dueTime, tags, notes } = req.body;
  if (!title || !title.trim()) return res.redirect('/?msg=标题不能为空');
  const todo = store.createTodo({
    title,
    priority: priority || 'medium',
    dueTime: dueTime || '',
    tags: tags || '',
    notes: notes || ''
  });
  // 带 newId 回首页，前端据此询问 AI 是否需要重排
  res.redirect('/?newTodoId=' + encodeURIComponent(todo.id));
});

// AI 重排建议：传入刚新增的 todo id，AI 评估难度/截止时间给出重排建议（返回 JSON，供前端确认）
router.post('/ai/suggest-reorder', async (req, res) => {
  const newId = (req.body.newTodoId || '').trim();
  if (!newId) return res.json({ ok: false, error: '缺少 newTodoId' });
  try {
    const newTodo = store.getTodo(newId);
    if (!newTodo) return res.json({ ok: false, error: '任务不存在' });
    const all = store.listTodos(store.today()).filter(t => !t.completed);
    // 前置过滤：任务少于 3 条无需重排，避免浪费 AI 调用
    if (all.length < 3) return res.json({ ok: false, error: '任务太少，无需重排' });
    const result = await ai.suggestReorder(newTodo, all);
    // 顺便返回 id→title 映射，便于前端展示
    const idTitle = {};
    all.forEach(t => { idTitle[t.id] = t.title; });
    res.json({ ok: true, ...result, idTitle });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// 切换完成状态
router.post('/todos/:id/toggle', (req, res) => {
  const todo = store.getTodo(req.params.id);
  if (todo) {
    store.updateTodo(req.params.id, { completed: !todo.completed });
  }
  res.redirect('/');
});

// 编辑
router.get('/todos/:id/edit', (req, res) => {
  const todo = store.getTodo(req.params.id);
  if (!todo) return res.redirect('/');
  res.render('edit', { todo });
});

router.post('/todos/:id/edit', (req, res) => {
  const { title, priority, dueTime, tags, notes } = req.body;
  store.updateTodo(req.params.id, {
    title: (title || '').trim(),
    priority: priority || 'medium',
    dueTime: dueTime || '',
    tags: store.parseTags(tags),
    notes: notes || ''
  });
  res.redirect('/');
});

// 删除
router.post('/todos/:id/delete', (req, res) => {
  store.deleteTodo(req.params.id);
  res.redirect('/');
});

// 批量操作
router.post('/todos/batch', (req, res) => {
  const { ids, action, priority, completed, tags } = req.body;
  const idList = Array.isArray(ids) ? ids : (ids ? [ids] : []);
  if (idList.length === 0) return res.redirect('/?msg=未选择任务');

  switch (action) {
    case 'complete':
      store.batchUpdate(idList, { completed: true });
      break;
    case 'uncomplete':
      store.batchUpdate(idList, { completed: false });
      break;
    case 'delete':
      store.batchDelete(idList);
      break;
    case 'priority':
      store.batchUpdate(idList, { priority: priority || 'medium' });
      break;
    case 'addTags':
      store.batchAddTags(idList, tags || '');
      break;
    default:
      return res.redirect('/?msg=未知操作');
  }
  res.redirect('/?msg=' + encodeURIComponent('已批量处理 ' + idList.length + ' 条'));
});

// 拖拽排序
router.post('/todos/reorder', (req, res) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids : (req.body.ids ? [req.body.ids] : []);
  if (ids.length > 0) store.reorderTodos(ids);
  res.redirect('/');
});

// 日清归档
router.post('/daily-clear', (req, res) => {
  const result = store.dailyClear(req.body.date || store.today());
  const m = `已归档 ${result.archived} 条，顺延 ${result.carriedOver} 条`;
  res.redirect('/?msg=' + encodeURIComponent(m));
});

// AI 智能重排
router.post('/ai-reschedule', async (req, res) => {
  const situation = req.body.situation || '';
  const today = store.today();
  const remaining = store.listTodos(today).filter(t => !t.completed);
  if (remaining.length === 0) {
    return res.redirect('/?msg=' + encodeURIComponent('没有未完成任务可重排'));
  }
  try {
    const { order, reasoning } = await ai.reschedule(remaining, situation);
    store.reorderTodos(order);
    const m = reasoning ? `已重排：${reasoning}` : '已重排任务顺序';
    res.redirect('/?msg=' + encodeURIComponent(m));
  } catch (e) {
    res.redirect('/?msg=' + encodeURIComponent('AI 重排失败：' + e.message));
  }
});

// AI 解析自然语言/语音转文字为结构化 todo（返回 JSON，供前端异步确认）
router.post('/ai/parse-todo', async (req, res) => {
  const transcript = (req.body.transcript || '').trim();
  if (!transcript) {
    return res.json({ ok: false, error: '内容为空' });
  }
  try {
    const todo = await ai.parseTodo(transcript);
    res.json({ ok: true, todo });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

module.exports = router;
