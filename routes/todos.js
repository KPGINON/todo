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
  // 默认排序规则：优先级 → 截止日期 → 截止时间 → 创建时间
  const byDefault = (a, b) => {
    const pa = order[a.priority] ?? 1, pb = order[b.priority] ?? 1;
    if (pa !== pb) return pa - pb;
    if (a.dueDate && b.dueDate) {
      if (a.dueDate !== b.dueDate) return a.dueDate.localeCompare(b.dueDate);
    } else if (a.dueDate) {
      return -1;
    } else if (b.dueDate) {
      return 1;
    }
    if (a.dueTime && b.dueTime) return a.dueTime.localeCompare(b.dueTime);
    if (a.dueTime) return -1;
    if (b.dueTime) return 1;
    return a.createdAt.localeCompare(b.createdAt);
  };
  // 手动/AI 排过序的任务（有 order 字段）按 order 升序在前，其余按默认规则追加在后；
  // 已完成统一沉底，组内保持上述顺序。
  const withOrder = todos.filter(t => typeof t.order === 'number').sort((a, b) => a.order - b.order);
  const noOrder = todos.filter(t => typeof t.order !== 'number').sort(byDefault);
  const sorted = [...withOrder, ...noOrder].sort((a, b) => {
    if (a.completed !== b.completed) return a.completed ? 1 : -1;
    return 0;
  });
  res.render('today', { todos: sorted, today, msg: req.query.msg || '' });
});

// 新增
router.post('/todos', (req, res) => {
  const { title, priority, dueDate, dueTime, tags, notes } = req.body;
  if (!title || !title.trim()) return res.redirect('/?msg=标题不能为空');
  const todo = store.createTodo({
    title,
    priority: priority || 'medium',
    dueDate: dueDate || '',
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
  const { title, priority, dueDate, dueTime, tags, notes } = req.body;
  store.updateTodo(req.params.id, {
    title: (title || '').trim(),
    priority: priority || 'medium',
    dueDate: dueDate || '',
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
    const todos = await ai.parseTodo(transcript);
    res.json({ ok: true, todos });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// 截图排程 - 第一步：分析截图，返回识别出的新任务与整体排程建议（不创建任何任务）
// 请求体：{ image: base64（无 data URL 前缀）, mimeType: 'image/png' }
// 返回：{ ok, newTodos, order, existing, reasoning }
//   - order 含 "new-N" 临时引用（对应 newTodos 下标）与已有任务 id
//   - existing 为 { id: title } 映射，供前端展示完整排程
router.post('/ai/schedule-screenshot', async (req, res) => {
  const image = req.body.image;
  const mimeType = req.body.mimeType || 'image/png';
  if (!image || typeof image !== 'string' || image.length < 100) {
    return res.json({ ok: false, error: '未提供有效的截图' });
  }
  try {
    const today = store.today();
    const existing = store.listTodos(today).filter(t => !t.completed);
    const result = await ai.analyzeScreenshot(image, mimeType, existing);
    const existingMap = {};
    existing.forEach(t => { existingMap[t.id] = t.title; });
    res.json({
      ok: true,
      newTodos: result.newTodos,
      order: result.order,
      existing: existingMap,
      reasoning: result.reasoning || ''
    });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// 截图排程 - 第二步：应用用户确认后的排程（创建新任务 + 整体重排）
// 请求体：{ newTodos: [{title,priority,dueDate,dueTime,tags,notes}], order: [id 或 "new-N"] }
// 返回：{ ok, created: [{id,title,...}], reasoning } —— 已创建并应用 reorder
router.post('/ai/apply-schedule', async (req, res) => {
  const newTodos = Array.isArray(req.body.newTodos) ? req.body.newTodos : [];
  const order = Array.isArray(req.body.order) ? req.body.order : [];
  try {
    const today = store.today();
    const existingIds = new Set(store.listTodos(today).filter(t => !t.completed).map(t => t.id));

    // 创建新任务，建立 new-N → 真实 id 映射
    const idMap = {};
    const created = [];
    newTodos.forEach((t, i) => {
      const title = String(t.title || '').trim();
      if (!title) return; // 跳过空标题
      const todo = store.createTodo({
        title,
        priority: t.priority || 'medium',
        dueDate: t.dueDate || '',
        dueTime: t.dueTime || '',
        tags: t.tags || [],
        notes: t.notes || ''
      });
      idMap['new-' + i] = todo.id;
      created.push({ id: todo.id, title: todo.title, priority: todo.priority, dueDate: todo.dueDate, dueTime: todo.dueTime });
    });

    // order 中的 new-N 替换为真实 id，已有 id 校验后保留；去重
    const seen = new Set();
    const realOrder = [];
    for (const id of order) {
      const real = idMap[id] || id;
      if (existingIds.has(real) && !seen.has(real)) {
        seen.add(real); realOrder.push(real);
      } else if (idMap[id] && !seen.has(real)) {
        seen.add(real); realOrder.push(real);
      }
    }
    if (realOrder.length > 0) store.reorderTodos(realOrder);

    res.json({ ok: true, created, count: created.length });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

module.exports = router;
