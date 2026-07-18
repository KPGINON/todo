// 日清 Todo 客户端逻辑：快捷键、批量选择、拖拽排序、番茄钟、语音、移动端菜单
(function () {
  'use strict';

  // ============ 移动端侧边栏切换 ============
  const menuToggle = document.getElementById('menu-toggle');
  const sidebar = document.getElementById('sidebar');
  const backdrop = document.getElementById('sidebar-backdrop');
  function closeSidebar() {
    if (sidebar) sidebar.classList.remove('open');
    if (backdrop) backdrop.classList.remove('show');
  }
  if (menuToggle && sidebar && backdrop) {
    menuToggle.addEventListener('click', function () {
      sidebar.classList.toggle('open');
      backdrop.classList.toggle('show');
    });
    backdrop.addEventListener('click', closeSidebar);
    // 点击导航链接后自动关闭
    sidebar.querySelectorAll('.side-nav a').forEach(a => a.addEventListener('click', closeSidebar));
  }

  // ============ 顶部工具按钮联动折叠区 ============
  const toolDailyClear = document.getElementById('tool-daily-clear');
  const toolAddDetail = document.getElementById('tool-add-detail');
  if (toolDailyClear) {
    toolDailyClear.addEventListener('click', function () {
      const form = document.getElementById('daily-clear-form');
      if (form) form.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  }
  if (toolAddDetail) {
    toolAddDetail.addEventListener('click', function () {
      const box = document.getElementById('add-detail-box');
      if (box) { box.open = true; box.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
    });
  }

  // ============ 看板列计数 ============
  function updateBoardCounts() {
    const todoList = document.getElementById('todo-list');
    const doneList = document.getElementById('done-list');
    const todoCount = document.getElementById('todo-count');
    const doneCount = document.getElementById('done-count');
    if (todoList && todoCount) {
      const items = todoList.querySelectorAll('.todo-item[data-id]');
      todoCount.textContent = items.length;
    }
    if (doneList && doneCount) {
      const items = doneList.querySelectorAll('.todo-item[data-id]');
      doneCount.textContent = items.length;
    }
  }
  updateBoardCounts();

  // ============ 批量选择 ============
  window.updateBatchBar = function () {
    const checks = document.querySelectorAll('.batch-check:checked');
    const bar = document.getElementById('batch-bar');
    const countEl = document.getElementById('batch-count');
    const container = document.getElementById('batch-ids-container');
    if (!bar) return;
    if (checks.length > 0) {
      bar.style.display = 'block';
      countEl.textContent = '已选 ' + checks.length + ' 项';
      container.innerHTML = '';
      checks.forEach(c => {
        const input = document.createElement('input');
        input.type = 'hidden';
        input.name = 'ids';
        input.value = c.dataset.id;
        container.appendChild(input);
      });
    } else {
      bar.style.display = 'none';
    }
  };

  window.setBatchAction = function (action) {
    document.getElementById('batch-action').value = action;
    return true;
  };

  // ============ 拖拽排序 ============
  const list = document.getElementById('todo-list');
  if (list) {
    let dragSrc = null;

    list.addEventListener('dragstart', function (e) {
      const li = e.target.closest('.todo-item');
      if (!li) return;
      dragSrc = li;
      li.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });

    list.addEventListener('dragend', function (e) {
      const li = e.target.closest('.todo-item');
      if (li) li.classList.remove('dragging');
    });

    list.addEventListener('dragover', function (e) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const target = e.target.closest('.todo-item');
      if (!target || target === dragSrc) return;
      const rect = target.getBoundingClientRect();
      const after = e.clientY > rect.top + rect.height / 2;
      if (after) target.after(dragSrc); else target.before(dragSrc);
    });

    list.addEventListener('drop', function (e) {
      e.preventDefault();
      if (!dragSrc) return;
      // 收集新顺序的 id，提交到后端
      const items = list.querySelectorAll('.todo-item[data-id]');
      const form = document.createElement('form');
      form.method = 'POST';
      form.action = '/todos/reorder';
      const csrf = document.querySelector('meta[name=csrf-token]');
      // 用页面里已有的 _csrf 值
      const csrfInput = document.createElement('input');
      csrfInput.type = 'hidden';
      csrfInput.name = '_csrf';
      csrfInput.value = document.querySelector('input[name="_csrf"]').value;
      form.appendChild(csrfInput);
      items.forEach(item => {
        const input = document.createElement('input');
        input.type = 'hidden';
        input.name = 'ids';
        input.value = item.dataset.id;
        form.appendChild(input);
      });
      document.body.appendChild(form);
      form.submit();
    });
  }

  // ============ 语音速记 + AI 解析 ============
  const voiceBtn = document.getElementById('voice-btn');
  const aiParseBtn = document.getElementById('ai-parse-btn');
  let recognition = null;
  let isRecording = false;

  // 初始化 Web Speech API（浏览器原生语音识别）
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (SpeechRecognition) {
    recognition = new SpeechRecognition();
    recognition.lang = 'zh-CN';
    // continuous=true：持续识别，不会因说话停顿就自动结束
    recognition.continuous = true;
    // interimResults=true：实时返回中间结果，便于累积完整内容
    recognition.interimResults = true;
  }

  // 累积的识别文本 + 是否由用户主动停止 + 静默自动停止计时器
  let finalTranscript = '';
  let stoppedManually = false;
  let silenceTimer = null;
  let autoStoppedBySilence = false; // 区分"静默自动停止"与"服务端超时断开"
  const SILENCE_MS = 4000; // 静默 4 秒判定说完（覆盖句间/思考停顿，避免话没说完就断）

  // 打开 AI 确认弹窗
  function openAiConfirm() {
    const overlay = document.getElementById('ai-confirm-overlay');
    const status = document.getElementById('ai-confirm-status');
    const listEl = document.getElementById('ai-confirm-list');
    const actionsEl = document.getElementById('ai-confirm-actions');
    // 重置为初始状态：隐藏列表和按钮，清空之前的卡片
    listEl.innerHTML = '';
    listEl.style.display = 'none';
    actionsEl.style.display = 'none';
    status.textContent = '正在解析...';
    status.style.color = '';
    overlay.style.display = 'flex';
  }

  // 调用后端 AI 解析接口
  function callAiParse(transcript) {
    const status = document.getElementById('ai-confirm-status');
    const listEl = document.getElementById('ai-confirm-list');
    const actionsEl = document.getElementById('ai-confirm-actions');
    const csrf = document.querySelector('input[name="_csrf"]').value;

    fetch('/ai/parse-todo', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: '_csrf=' + encodeURIComponent(csrf) + '&transcript=' + encodeURIComponent(transcript)
    })
      .then(r => r.json())
      .then(data => {
        if (!data.ok) {
          status.textContent = '解析失败：' + data.error;
          status.style.color = '#ff3b30';
          return;
        }
        const todos = data.todos || [];
        if (todos.length === 0) {
          status.textContent = '未解析到任务，请重试';
          status.style.color = '#ff3b30';
          return;
        }
        status.textContent = '共识别到 ' + todos.length + ' 个任务，确认无误后点"全部添加"：';
        status.style.color = '';
        renderAiTodoCards(todos, listEl);
        listEl.style.display = 'flex';
        actionsEl.style.display = 'flex';
      })
      .catch(err => {
        status.textContent = '请求失败：' + err.message;
        status.style.color = '#ff3b30';
      });
  }

  // 渲染多个可编辑任务卡片
  function renderAiTodoCards(todos, container) {
    container.innerHTML = '';
    todos.forEach((todo, idx) => {
      const card = document.createElement('div');
      card.className = 'ai-todo-card';
      card.innerHTML =
        '<div class="card-head"><span>任务 ' + (idx + 1) + '</span><button type="button" class="del-btn" title="删除此任务">×</button></div>' +
        '<label>标题<input type="text" class="t-title" value="' + escapeAttr(todo.title) + '" required></label>' +
        '<label>优先级<select class="t-priority">' +
          '<option value="high"' + (todo.priority === 'high' ? ' selected' : '') + '>高</option>' +
          '<option value="medium"' + (todo.priority === 'medium' ? ' selected' : '') + '>中</option>' +
          '<option value="low"' + (todo.priority === 'low' ? ' selected' : '') + '>低</option>' +
        '</select></label>' +
        '<label>截止日期<input type="date" class="t-dueDate" value="' + escapeAttr(todo.dueDate || '') + '"></label>' +
        '<label>预计完成时间<input type="time" class="t-dueTime" value="' + escapeAttr(todo.dueTime || '') + '"></label>' +
        '<label>标签（逗号分隔）<input type="text" class="t-tags" value="' + escapeAttr((todo.tags || []).join(', ')) + '"></label>' +
        '<label>备注<textarea class="t-notes" rows="2">' + escapeHtml(todo.notes || '') + '</textarea></label>';
      // 删除单个任务卡片
      card.querySelector('.del-btn').addEventListener('click', function () {
        card.remove();
        // 重新编号
        container.querySelectorAll('.ai-todo-card').forEach((c, i) => {
          c.querySelector('.card-head span').textContent = '任务 ' + (i + 1);
        });
        // 全删完则隐藏按钮
        if (container.querySelectorAll('.ai-todo-card').length === 0) {
          document.getElementById('ai-confirm-actions').style.display = 'none';
          document.getElementById('ai-confirm-status').textContent = '已删除所有任务，可关闭弹窗或重新输入。';
        }
      });
      container.appendChild(card);
    });
  }

  function escapeAttr(s) {
    return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // 语音按钮
  if (voiceBtn) {
    voiceBtn.addEventListener('click', function () {
      if (!recognition) {
        // 浏览器不支持语音，回退到文本输入 + AI 解析
        const text = prompt('当前浏览器不支持语音识别，请直接输入描述，AI 会帮你整理：');
        if (text && text.trim()) {
          openAiConfirm();
          callAiParse(text.trim());
        }
        return;
      }
      if (isRecording) {
        // 录音中再点：立即停止并解析
        stoppedManually = true;
        if (silenceTimer) { clearTimeout(silenceTimer); silenceTimer = null; }
        recognition.stop();
        return;
      }
      // 开始录音：重置状态
      finalTranscript = '';
      stoppedManually = false;
      autoStoppedBySilence = false;
      voiceBtn.classList.add('recording');
      voiceBtn.textContent = '⏹';
      isRecording = true;
      openAiConfirm();
      document.getElementById('ai-confirm-status').textContent = '正在聆听...说完停顿 4 秒后自动结束，或再点 ⏹ 立即结束';

      recognition.onresult = function (event) {
        // 只处理新增的 result（event.resultIndex 之后的），避免重复累积
        let interim = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const r = event.results[i];
          if (r.isFinal) {
            finalTranscript += r[0].transcript;
          } else {
            interim += r[0].transcript;
          }
        }
        // 实时回显：用 finalTranscript + 当前 interim（不累积 interim，避免重复）
        const display = (finalTranscript + interim).trim();
        if (display) {
          document.getElementById('ai-confirm-status').textContent = '听到："' + display + '"';
        }
        // 重置静默计时器：有新内容就重新计时
        if (silenceTimer) clearTimeout(silenceTimer);
        silenceTimer = setTimeout(() => {
          if (isRecording && finalTranscript.trim()) {
            autoStoppedBySilence = true; // 静默自动停止，走解析流程
            recognition.stop();
          }
        }, SILENCE_MS);
      };
      recognition.onerror = function (event) {
        document.getElementById('ai-confirm-status').textContent = '语音识别失败：' + event.error;
        document.getElementById('ai-confirm-status').style.color = '#ff3b30';
        stoppedManually = false;
        if (silenceTimer) { clearTimeout(silenceTimer); silenceTimer = null; }
      };
      recognition.onend = function () {
        voiceBtn.classList.remove('recording');
        voiceBtn.textContent = '🎤';
        isRecording = false;
        if (silenceTimer) { clearTimeout(silenceTimer); silenceTimer = null; }
        // 仅在用户主动停止或静默自动停止时才解析；
        // 否则是浏览器/服务端超时断开（continuous 也无法避免），提示重试，不误解析半截内容
        if (stoppedManually || autoStoppedBySilence) {
          if (finalTranscript.trim()) {
            document.getElementById('ai-confirm-status').textContent = '听到："' + finalTranscript.trim() + '"，正在用 AI 整理...';
            callAiParse(finalTranscript.trim());
          } else {
            document.getElementById('ai-confirm-status').textContent = '未识别到内容，请重试';
          }
        } else if (finalTranscript.trim()) {
          // 服务端超时断开但已有内容：用户可能还没说完，提示可继续
          document.getElementById('ai-confirm-status').textContent = '录音已断开（超时），已听到："' + finalTranscript.trim() + '"。再点 🎤 可继续录音，或点 ✨ 用当前内容整理。';
          document.getElementById('ai-confirm-status').style.color = '#e08600';
        } else {
          document.getElementById('ai-confirm-status').textContent = '未识别到内容，请重试';
        }
        stoppedManually = false;
        autoStoppedBySilence = false;
      };
      recognition.start();
    });
  }

  // AI 整理按钮（解析输入框已有内容）
  if (aiParseBtn) {
    aiParseBtn.addEventListener('click', function () {
      const input = document.getElementById('quick-add-input');
      const text = input.value.trim();
      if (!text) {
        input.focus();
        return;
      }
      openAiConfirm();
      callAiParse(text);
    });
  }

  // 取消按钮
  const aiCancel = document.getElementById('ai-confirm-cancel');
  if (aiCancel) {
    aiCancel.addEventListener('click', function () {
      document.getElementById('ai-confirm-overlay').style.display = 'none';
    });
  }

  // 全部添加按钮：收集所有卡片数据，逐个 POST 到 /todos，完成后跳转
  const aiAddBtn = document.getElementById('ai-confirm-add');
  if (aiAddBtn) {
    aiAddBtn.addEventListener('click', async function () {
      const cards = document.querySelectorAll('#ai-confirm-list .ai-todo-card');
      if (cards.length === 0) return;
      const status = document.getElementById('ai-confirm-status');
      const actionsEl = document.getElementById('ai-confirm-actions');
      const csrf = document.querySelector('input[name="_csrf"]').value;

      // 收集所有卡片字段
      const todos = [];
      for (const card of cards) {
        const title = card.querySelector('.t-title').value.trim();
        if (!title) continue; // 跳过空标题
        todos.push({
          title,
          priority: card.querySelector('.t-priority').value,
          dueDate: card.querySelector('.t-dueDate').value,
          dueTime: card.querySelector('.t-dueTime').value,
          tags: card.querySelector('.t-tags').value,
          notes: card.querySelector('.t-notes').value
        });
      }
      if (todos.length === 0) {
        status.textContent = '没有有效任务（标题不能为空）';
        status.style.color = '#ff3b30';
        return;
      }

      // 禁用按钮，显示进度
      actionsEl.style.pointerEvents = 'none';
      aiAddBtn.textContent = '添加中...';
      status.style.color = '';
      for (let i = 0; i < todos.length; i++) {
        status.textContent = '正在添加 ' + (i + 1) + '/' + todos.length + '...';
        const params = new URLSearchParams();
        params.append('_csrf', csrf);
        params.append('title', todos[i].title);
        params.append('priority', todos[i].priority);
        if (todos[i].dueDate) params.append('dueDate', todos[i].dueDate);
        if (todos[i].dueTime) params.append('dueTime', todos[i].dueTime);
        if (todos[i].tags) params.append('tags', todos[i].tags);
        if (todos[i].notes) params.append('notes', todos[i].notes);
        try {
          await fetch('/todos', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: params.toString(), redirect: 'manual' });
        } catch (e) {
          // 单个失败不中断，继续添加其余
        }
      }
      // 完成后刷新 today 页（多任务添加不触发单个重排建议）
      window.location.href = '/';
    });
  }

  // ============ 截图排程：粘贴/拖入/上传截图，AI 识别任务并整体排程 ============
  // 常驻页面内嵌区块（.screenshot-panel），不再用浮层
  const shotDrop = document.getElementById('screenshot-drop');
  const shotFile = document.getElementById('screenshot-file');
  const shotPreview = document.getElementById('screenshot-preview');
  const shotHint = document.querySelector('.screenshot-drop-hint');
  const shotStatus = document.getElementById('screenshot-status');
  const shotActions = document.getElementById('screenshot-actions');
  const shotAnalyze = document.getElementById('screenshot-analyze');
  const shotApply = document.getElementById('screenshot-apply');
  let shotImageData = null; // { base64, mimeType }
  // 分析结果：保留 order 与 existing 映射，供"确认并排程"提交
  let shotOrder = [];
  let shotExisting = {};

  function resetScreenshot() {
    shotImageData = null;
    shotOrder = [];
    shotExisting = {};
    shotPreview.style.display = 'none';
    shotPreview.src = '';
    shotHint.style.display = '';
    shotActions.style.display = 'none';
    shotApply.style.display = 'none';
    shotAnalyze.style.display = '';
    const result = document.getElementById('screenshot-result');
    if (result) result.style.display = 'none';
    shotStatus.textContent = '粘贴截图（Ctrl+V）、拖入图片或点击选择文件。AI 会识别其中的任务并结合现有任务排程。';
    shotStatus.style.color = '';
    shotFile.value = '';
  }
  function setScreenshotImage(dataUrl, mimeType) {
    // dataUrl 形如 data:image/png;base64,xxxx
    const comma = dataUrl.indexOf(',');
    const header = dataUrl.slice(0, comma);
    const base64 = dataUrl.slice(comma + 1);
    // 从 header 推断 mimeType，兜底用传入的
    const m = header.match(/data:([^;]+)/);
    shotImageData = { base64, mimeType: (m && m[1]) || mimeType || 'image/png' };
    shotPreview.src = dataUrl;
    shotPreview.style.display = '';
    shotHint.style.display = 'none';
    shotActions.style.display = 'flex';
    shotStatus.textContent = '已选择截图，点"分析"开始识别。';
    shotStatus.style.color = '';
  }

  // 点击 drop 区域触发文件选择
  if (shotDrop) shotDrop.addEventListener('click', () => shotFile && shotFile.click());
  if (shotFile) shotFile.addEventListener('change', () => {
    const file = shotFile.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setScreenshotImage(reader.result, file.type);
    reader.readAsDataURL(file);
  });

  // 拖入图片
  if (shotDrop) {
    shotDrop.addEventListener('dragover', e => { e.preventDefault(); shotDrop.classList.add('dragover'); });
    shotDrop.addEventListener('dragleave', () => shotDrop.classList.remove('dragover'));
    shotDrop.addEventListener('drop', e => {
      e.preventDefault();
      shotDrop.classList.remove('dragover');
      const file = e.dataTransfer.files[0];
      if (file && file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = () => setScreenshotImage(reader.result, file.type);
        reader.readAsDataURL(file);
      }
    });
  }

  // 粘贴（常驻：页面上有截图区就拦截图片粘贴，文本粘贴不受影响）
  document.addEventListener('paste', e => {
    if (!shotDrop) return;
    const items = e.clipboardData && e.clipboardData.items;
    if (!items) return;
    for (const it of items) {
      if (it.type && it.type.startsWith('image/')) {
        const file = it.getAsFile();
        if (!file) continue;
        const reader = new FileReader();
        reader.onload = () => setScreenshotImage(reader.result, file.type);
        reader.readAsDataURL(file);
        e.preventDefault();
        return;
      }
    }
  });

  // 转义工具（卡片渲染用）
  function escAttr(s) { return String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  function escHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  // 渲染可编辑的新任务卡片（复用 AI 解析弹窗的 ai-todo-card 样式）
  // data-orig-idx 记录 AI 返回的原始 new-N 下标，用于提交时正确重建 order 映射
  function renderShotCards(todos, container) {
    container.innerHTML = '';
    todos.forEach((todo, idx) => {
      const card = document.createElement('div');
      card.className = 'ai-todo-card';
      card.dataset.origIdx = idx;
      card.innerHTML =
        '<div class="card-head"><span>任务 ' + (idx + 1) + '</span><button type="button" class="del-btn" title="删除此任务">×</button></div>' +
        '<label>标题<input type="text" class="t-title" value="' + escAttr(todo.title) + '" required></label>' +
        '<label>优先级<select class="t-priority">' +
          '<option value="high"' + (todo.priority === 'high' ? ' selected' : '') + '>高</option>' +
          '<option value="medium"' + (todo.priority === 'medium' ? ' selected' : '') + '>中</option>' +
          '<option value="low"' + (todo.priority === 'low' ? ' selected' : '') + '>低</option>' +
        '</select></label>' +
        '<label>截止日期<input type="date" class="t-dueDate" value="' + escAttr(todo.dueDate || '') + '"></label>' +
        '<label>预计完成时间<input type="time" class="t-dueTime" value="' + escAttr(todo.dueTime || '') + '"></label>' +
        '<label>标签（逗号分隔）<input type="text" class="t-tags" value="' + escAttr((todo.tags || []).join(', ')) + '"></label>' +
        '<label>备注<textarea class="t-notes" rows="2">' + escHtml(todo.notes || '') + '</textarea></label>';
      card.querySelector('.del-btn').addEventListener('click', function () {
        card.remove();
        if (container.querySelectorAll('.ai-todo-card').length === 0) {
          document.getElementById('screenshot-apply').textContent = '确认排程（仅重排现有任务）';
        }
      });
      container.appendChild(card);
    });
  }

  // 渲染排程后的完整顺序列表（新任务高亮）
  function renderShotOrder(order, existing, newCount) {
    const ol = document.getElementById('screenshot-order');
    ol.innerHTML = '';
    order.forEach(id => {
      const li = document.createElement('li');
      let label;
      if (id.startsWith('new-')) {
        const idx = parseInt(id.slice(4), 10);
        label = '🆕 新任务 ' + (idx + 1);
        li.className = 'new-item';
      } else {
        label = existing[id] || id;
      }
      li.textContent = label;
      ol.appendChild(li);
    });
  }

  // 分析：调后端识别，展示可编辑卡片 + 排程顺序，不直接创建
  if (shotAnalyze) shotAnalyze.addEventListener('click', async () => {
    if (!shotImageData) return;
    shotAnalyze.disabled = true;
    shotAnalyze.textContent = '分析中...';
    shotStatus.style.color = '';
    shotStatus.textContent = 'AI 正在识别截图任务并排程，请稍候...';
    const csrf = document.querySelector('input[name="_csrf"]').value;
    try {
      const resp = await fetch('/ai/schedule-screenshot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ _csrf: csrf, image: shotImageData.base64, mimeType: shotImageData.mimeType })
      });
      const data = await resp.json();
      if (!data.ok) {
        shotStatus.textContent = '识别失败：' + (data.error || '未知错误');
        shotStatus.style.color = '#ff3b30';
        return;
      }
      const todos = data.newTodos || [];
      shotOrder = data.order || [];
      shotExisting = data.existing || {};
      const result = document.getElementById('screenshot-result');
      const cards = document.getElementById('screenshot-cards');
      const reason = document.getElementById('screenshot-reason');
      reason.textContent = data.reasoning ? '💡 ' + data.reasoning : '';

      if (todos.length === 0) {
        cards.innerHTML = '<p class="hint">截图中未识别到新任务。</p>';
      } else {
        renderShotCards(todos, cards);
      }
      renderShotOrder(shotOrder, shotExisting, todos.length);
      result.style.display = '';
      shotStatus.textContent = todos.length > 0
        ? '识别到 ' + todos.length + ' 个新任务，可编辑/删除后确认排程。'
        : '未识别到新任务，可确认仅重排现有任务。';
      shotStatus.style.color = '';
      shotApply.style.display = '';
      shotApply.textContent = todos.length > 0 ? '确认并排程' : '确认排程（仅重排现有任务）';
    } catch (err) {
      shotStatus.textContent = '请求异常：' + err.message;
      shotStatus.style.color = '#ff3b30';
    } finally {
      shotAnalyze.disabled = false;
      shotAnalyze.textContent = '分析';
    }
  });

  // 确认并排程：收集卡片数据 + order，调 apply-schedule 创建并重排
  if (shotApply) shotApply.addEventListener('click', async () => {
    const cards = document.querySelectorAll('#screenshot-cards .ai-todo-card');
    const newTodos = [];
    // origIdx → 提交下标 的映射，用于把 AI 原始 order 里的 new-N 重映射到保留卡片的下标
    const origToSubmit = {};
    cards.forEach((card, submitIdx) => {
      const title = card.querySelector('.t-title').value.trim();
      if (!title) return;
      const origIdx = parseInt(card.dataset.origIdx, 10);
      if (!isNaN(origIdx)) origToSubmit[origIdx] = submitIdx;
      newTodos.push({
        title,
        priority: card.querySelector('.t-priority').value,
        dueDate: card.querySelector('.t-dueDate').value,
        dueTime: card.querySelector('.t-dueTime').value,
        tags: card.querySelector('.t-tags').value,
        notes: card.querySelector('.t-notes').value
      });
    });

    // 重映射 order：new-N → 提交下标；指向被删卡片的 new-N 过滤掉
    const filteredOrder = shotOrder.map(id => {
      if (id.startsWith('new-')) {
        const origIdx = parseInt(id.slice(4), 10);
        return origToSubmit.hasOwnProperty(origIdx) ? 'new-' + origToSubmit[origIdx] : null;
      }
      return id;
    }).filter(id => id !== null);

    shotApply.disabled = true;
    shotApply.textContent = '排程中...';
    const csrf = document.querySelector('input[name="_csrf"]').value;
    try {
      const resp = await fetch('/ai/apply-schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ _csrf: csrf, newTodos, order: filteredOrder })
      });
      const data = await resp.json();
      if (!data.ok) {
        shotStatus.textContent = '排程失败：' + (data.error || '未知错误');
        shotStatus.style.color = '#ff3b30';
        return;
      }
      shotStatus.style.color = '';
      const n = data.count || 0;
      shotStatus.textContent = n > 0
        ? '已创建 ' + n + ' 个新任务并完成排程，正在刷新...'
        : '已按现有任务排程，正在刷新...';
      setTimeout(() => { window.location.href = '/'; }, 1200);
    } catch (err) {
      shotStatus.textContent = '请求异常：' + err.message;
      shotStatus.style.color = '#ff3b30';
    } finally {
      shotApply.disabled = false;
      shotApply.textContent = '确认并排程';
    }
  });

  // ============ 新增任务后 AI 自动重排 ============
  // 新增任务跳回首页带 newTodoId 时，自动调用 AI 重排并直接应用，
  // 不再弹窗确认；改用顶部可撤销提示条，用户不满意可一键还原。
  function checkNewTodoAndSuggest() {
    const params = new URLSearchParams(window.location.search);
    const newId = params.get('newTodoId');
    if (!newId) return;
    // 清掉 URL 上的 newTodoId，避免刷新重复触发
    const url = new URL(window.location.href);
    url.searchParams.delete('newTodoId');
    window.history.replaceState({}, document.title, url.toString());

    const toast = document.getElementById('reorder-toast');
    const toastText = document.getElementById('reorder-toast-text');
    if (!toast) return;
    toast.style.display = 'flex';
    toastText.textContent = '正在按 AI 建议重排...';

    const csrf = document.querySelector('input[name="_csrf"]').value;
    fetch('/ai/suggest-reorder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: '_csrf=' + encodeURIComponent(csrf) + '&newTodoId=' + encodeURIComponent(newId)
    })
      .then(r => r.json())
      .then(data => {
        if (!data.ok) {
          // 任务太少或未配置 AI，静默关闭
          toast.style.display = 'none';
          return;
        }
        const newOrder = data.order || [];
        const todoList = document.getElementById('todo-list');
        if (!todoList || newOrder.length === 0) {
          toast.style.display = 'none';
          return;
        }
        // 记录应用前的 DOM 顺序，供撤销使用（只取未完成、且在建议列表中的项）
        const prevIds = Array.from(todoList.querySelectorAll('.todo-item[data-id]'))
          .map(li => li.dataset.id)
          .filter(id => newOrder.includes(id));
        // 直接 POST 应用新顺序
        applyReorder(newOrder, () => {
          toastText.textContent = data.reasoning ? ('已按 AI 建议重排：' + data.reasoning) : '已按 AI 建议重排';
          bindReorderUndo(prevIds);
        });
      })
      .catch(() => { toast.style.display = 'none'; });
  }

  // 提交顺序到 /todos/reorder，成功后回调
  function applyReorder(ids, onSuccess) {
    const csrf = document.querySelector('input[name="_csrf"]').value;
    const params = new URLSearchParams();
    params.append('_csrf', csrf);
    ids.forEach(id => params.append('ids', id));
    fetch('/todos/reorder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString()
    }).then(r => { if (r.ok && onSuccess) onSuccess(); }).catch(() => {});
  }

  // 绑定撤销：恢复 prevIds 顺序，刷新页面
  function bindReorderUndo(prevIds) {
    const toast = document.getElementById('reorder-toast');
    const undoBtn = document.getElementById('reorder-undo');
    const dismissBtn = document.getElementById('reorder-dismiss');
    if (undoBtn) undoBtn.onclick = function () {
      applyReorder(prevIds, () => { window.location.reload(); });
    };
    if (dismissBtn) dismissBtn.onclick = function () { toast.style.display = 'none'; };
  }

  checkNewTodoAndSuggest();

  // ============ 键盘快捷键 ============
  let focusedIndex = -1;

  function getTodoItems() {
    return Array.from(document.querySelectorAll('.todo-item[data-id]'));
  }

  function focusItem(index) {
    const items = getTodoItems();
    if (items.length === 0) return;
    items.forEach(li => li.classList.remove('kbd-focus'));
    if (index < 0) index = items.length - 1;
    if (index >= items.length) index = 0;
    focusedIndex = index;
    items[index].classList.add('kbd-focus');
    items[index].scrollIntoView({ block: 'nearest' });
  }

  document.addEventListener('keydown', function (e) {
    // 在输入框中不触发快捷键
    const tag = (e.target.tagName || '').toLowerCase();
    const inField = tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable;

    // Esc 关闭浮层
    if (e.key === 'Escape') {
      document.querySelectorAll('.shortcuts-overlay, .ai-confirm-overlay').forEach(o => o.style.display = 'none');
      document.title = '日清 Todo';
      return;
    }

    if (inField) {
      // 输入框中只处理 Esc（上面已处理）
      return;
    }

    const key = e.key.toLowerCase();

    if (key === 'n') {
      e.preventDefault();
      const input = document.getElementById('quick-add-input');
      if (input) input.focus();
    } else if (key === '/') {
      e.preventDefault();
      window.location.href = '/search';
    } else if (key === '?') {
      e.preventDefault();
      const o = document.getElementById('shortcuts-overlay');
      o.style.display = o.style.display === 'none' ? 'flex' : 'none';
    } else if (key === 'j') {
      e.preventDefault();
      focusItem(focusedIndex + 1);
    } else if (key === 'k') {
      e.preventDefault();
      focusItem(focusedIndex - 1);
    } else if (key === 'x') {
      e.preventDefault();
      const items = getTodoItems();
      if (focusedIndex >= 0 && items[focusedIndex]) {
        const cb = items[focusedIndex].querySelector('.batch-check');
        if (cb) { cb.checked = !cb.checked; updateBatchBar(); }
      }
    } else if (key === ' ') {
      e.preventDefault();
      const items = getTodoItems();
      if (focusedIndex >= 0 && items[focusedIndex]) {
        items[focusedIndex].querySelector('.toggle-form').submit();
      }
    } else if (key === 'e') {
      e.preventDefault();
      const items = getTodoItems();
      if (focusedIndex >= 0 && items[focusedIndex]) {
        window.location.href = items[focusedIndex].querySelector('.todo-actions a').href;
      }
    }
  });
  // ============ AI 对话：意图识别聊天（日程管理 / 普通问题） ============
  const chatBtn = document.getElementById('tool-chat');
  const chatOverlay = document.getElementById('chat-overlay');
  const chatClose = document.getElementById('chat-close');
  const chatMessages = document.getElementById('chat-messages');
  const chatInput = document.getElementById('chat-input');
  const chatSend = document.getElementById('chat-send');
  const chatVoice = document.getElementById('chat-voice');
  // 对话历史，发给后端做多轮上下文
  let chatHistory = [];
  let chatVoiceRec = null;
  let chatVoiceRecording = false;
  // 发送中锁 + 可中止的请求控制器：发送中再次触发会取消上一个请求并重发
  let chatSending = false;
  let chatAbort = null;

  function getCsrf() {
    const el = document.querySelector('input[name="_csrf"]');
    return el ? el.value : '';
  }

  function escapeChatHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
  }

  function appendBubble(role, text) {
    const div = document.createElement('div');
    div.className = 'chat-bubble ' + (role === 'user' ? 'chat-bubble-user' : 'chat-bubble-ai');
    div.innerHTML = escapeChatHtml(text);
    chatMessages.appendChild(div);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    return div;
  }

  function openChat() {
    chatOverlay.style.display = 'flex';
    setTimeout(() => chatInput && chatInput.focus(), 50);
  }
  if (chatBtn) chatBtn.addEventListener('click', openChat);
  if (chatClose) chatClose.addEventListener('click', () => { chatOverlay.style.display = 'none'; });

  // 把 AI 返回的创建任务预览到现有"AI 整理结果"弹窗，复用确认流程
  function previewCreateTasks(tasks, reply) {
    const overlay = document.getElementById('ai-confirm-overlay');
    const status = document.getElementById('ai-confirm-status');
    const listEl = document.getElementById('ai-confirm-list');
    const actionsEl = document.getElementById('ai-confirm-actions');
    const title = document.getElementById('ai-confirm-title');
    if (title) title.textContent = 'AI 要添加以下任务';
    if (status) {
      status.textContent = (reply ? reply + ' —— ' : '') + '共 ' + tasks.length + ' 个任务，确认无误后点"全部添加"：';
      status.style.color = '';
    }
    if (listEl) {
      renderAiTodoCards(tasks, listEl);
      listEl.style.display = 'flex';
    }
    if (actionsEl) actionsEl.style.display = 'flex';
    if (overlay) overlay.style.display = 'flex';
  }

  async function sendChat() {
    const text = (chatInput.value || '').trim();
    if (!text) return;
    // 发送中再次触发：中止上一个请求，回滚它占位的 history，再重发
    if (chatSending) {
      if (chatAbort) { try { chatAbort.abort(); } catch (e) {} }
      // 移除上一轮未完成的 user 占位（最后一条若是 user 且无对应 assistant，去掉）
      // 简化：直接重发时把当前输入并入，不再尝试清理 pending
    }
    chatInput.value = '';
    appendBubble('user', text);
    chatHistory.push({ role: 'user', content: text });
    const thinking = appendBubble('assistant', '正在思考...');
    chatSending = true;
    chatSend.disabled = true;
    chatSend.textContent = '...';
    chatAbort = new AbortController();
    try {
      const resp = await fetch('/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ _csrf: getCsrf(), message: text, history: chatHistory.slice(0, -1) }),
        signal: chatAbort.signal
      });
      const data = await resp.json();
      thinking.remove();
      if (!data.ok) {
        // 业务错误：回滚刚 push 的 user 消息，方便重发
        chatHistory.pop();
        appendBubble('assistant', '出错了：' + (data.error || '未知错误'));
        return;
      }
      if (data.type === 'todo' && data.action === 'create') {
        chatHistory.push({ role: 'assistant', content: data.reply || ('将创建 ' + data.tasks.length + ' 个任务') });
        appendBubble('assistant', (data.reply || '已识别 ' + data.tasks.length + ' 个任务') + '（请在弹窗中确认）');
        previewCreateTasks(data.tasks, data.reply);
      } else {
        const reply = data.reply || '（无回复）';
        chatHistory.push({ role: 'assistant', content: reply });
        appendBubble('assistant', reply);
      }
    } catch (e) {
      thinking.remove();
      if (e && e.name === 'AbortError') {
        // 被中止（重发或关闭）：回滚 user 占位，不显示错误
        chatHistory.pop();
      } else {
        chatHistory.pop();
        appendBubble('assistant', '网络错误：' + e.message);
      }
    } finally {
      chatSending = false;
      chatAbort = null;
      chatSend.disabled = false;
      chatSend.textContent = '发送';
    }
  }
  if (chatSend) chatSend.addEventListener('click', sendChat);
  if (chatInput) chatInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (!chatSending) sendChat(); }
  });

  // 语音输入：把识别结果填到聊天输入框，不触发解析
  if (chatVoice) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SR) {
      chatVoiceRec = new SR();
      chatVoiceRec.lang = 'zh-CN';
      chatVoiceRec.continuous = false;
      chatVoiceRec.interimResults = true;
      let chatFinal = '';
      chatVoiceRec.onresult = function (event) {
        let interim = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const r = event.results[i];
          if (r.isFinal) chatFinal += r[0].transcript;
          else interim += r[0].transcript;
        }
        chatInput.value = (chatFinal + interim).trim();
      };
      chatVoiceRec.onend = function () {
        chatVoiceRecording = false;
        chatVoice.classList.remove('recording');
        chatVoice.textContent = '🎤';
        chatInput.focus();
      };
      chatVoiceRec.onerror = function () {
        chatVoiceRecording = false;
        chatVoice.classList.remove('recording');
        chatVoice.textContent = '🎤';
      };
      chatVoice.addEventListener('click', function () {
        if (chatVoiceRecording) { chatVoiceRec.stop(); return; }
        chatFinal = '';
        chatInput.value = '';
        chatVoiceRecording = true;
        chatVoice.classList.add('recording');
        chatVoice.textContent = '⏹';
        try { chatVoiceRec.start(); } catch (e) { chatVoiceRecording = false; chatVoice.classList.remove('recording'); chatVoice.textContent = '🎤'; }
      });
    } else {
      chatVoice.addEventListener('click', function () {
        alert('当前浏览器不支持语音识别，请直接打字输入');
      });
    }
  }

})();