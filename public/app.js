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

  // ============ 番茄钟 ============
  let pomoTimer = null;
  let pomoSeconds = 25 * 60;
  let pomoRunning = false;
  let pomoMode = 'work'; // work | break

  function openPomodoro(title) {
    const overlay = document.getElementById('pomodoro-overlay');
    const titleEl = document.getElementById('pomodoro-task-title');
    titleEl.textContent = title;
    overlay.style.display = 'flex';
    resetPomodoro();
  }

  function resetPomodoro() {
    clearInterval(pomoTimer);
    pomoRunning = false;
    pomoMode = 'work';
    pomoSeconds = 25 * 60;
    updatePomodoroDisplay();
    document.getElementById('pomodoro-toggle').textContent = '开始';
  }

  function updatePomodoroDisplay() {
    const m = Math.floor(pomoSeconds / 60);
    const s = pomoSeconds % 60;
    const el = document.getElementById('pomodoro-timer');
    if (el) el.textContent = String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
    document.title = (pomoRunning ? (pomoMode === 'work' ? '🍅 ' : '☕ ') : '') + el.textContent + ' — 日清 Todo';
  }

  function togglePomodoro() {
    if (pomoRunning) {
      clearInterval(pomoTimer);
      pomoRunning = false;
      document.getElementById('pomodoro-toggle').textContent = '继续';
    } else {
      pomoRunning = true;
      document.getElementById('pomodoro-toggle').textContent = '暂停';
      pomoTimer = setInterval(function () {
        pomoSeconds--;
        if (pomoSeconds <= 0) {
          clearInterval(pomoTimer);
          pomoRunning = false;
          if (pomoMode === 'work') {
            alert('专注完成！休息 5 分钟。');
            pomoMode = 'break';
            pomoSeconds = 5 * 60;
            document.getElementById('pomodoro-toggle').textContent = '开始休息';
          } else {
            alert('休息结束，开始下一轮专注！');
            pomoMode = 'work';
            pomoSeconds = 25 * 60;
            document.getElementById('pomodoro-toggle').textContent = '开始';
          }
        }
        updatePomodoroDisplay();
      }, 1000);
    }
  }

  // 绑定番茄钟按钮
  document.addEventListener('click', function (e) {
    if (e.target.classList.contains('focus-btn')) {
      openPomodoro(e.target.dataset.title);
    }
  });

  const pomoToggle = document.getElementById('pomodoro-toggle');
  const pomoReset = document.getElementById('pomodoro-reset');
  const pomoClose = document.getElementById('pomodoro-close');
  if (pomoToggle) pomoToggle.addEventListener('click', togglePomodoro);
  if (pomoReset) pomoReset.addEventListener('click', resetPomodoro);
  if (pomoClose) pomoClose.addEventListener('click', function () {
    clearInterval(pomoTimer);
    pomoRunning = false;
    document.getElementById('pomodoro-overlay').style.display = 'none';
    document.title = '日清 Todo';
  });

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
  const SILENCE_MS = 1500; // 静默 1.5 秒判定说完

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
        console.log('[AI parse] response:', JSON.stringify(data));
        if (!data.ok) {
          status.textContent = '解析失败：' + data.error;
          status.style.color = '#ff3b30';
          return;
        }
        const todos = data.todos || [];
        console.log('[AI parse] todos count:', todos.length, 'todos:', JSON.stringify(todos));
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
      voiceBtn.classList.add('recording');
      voiceBtn.textContent = '⏹';
      isRecording = true;
      openAiConfirm();
      document.getElementById('ai-confirm-status').textContent = '正在聆听...说完会自动结束';

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
            stoppedManually = true; // 自动停止也走解析流程
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
        // 有内容就触发 AI 解析（无论主动停止还是静默自动停止）
        if (finalTranscript.trim()) {
          document.getElementById('ai-confirm-status').textContent = '听到："' + finalTranscript.trim() + '"，正在用 AI 整理...';
          callAiParse(finalTranscript.trim());
        } else {
          document.getElementById('ai-confirm-status').textContent = '未识别到内容，请重试';
        }
        stoppedManually = false;
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

  // ============ 新增任务后 AI 重排建议 ============
  function checkNewTodoAndSuggest() {
    const params = new URLSearchParams(window.location.search);
    const newId = params.get('newTodoId');
    if (!newId) return;
    // 清掉 URL 上的 newTodoId，避免刷新重复触发
    const url = new URL(window.location.href);
    url.searchParams.delete('newTodoId');
    window.history.replaceState({}, document.title, url.toString());

    const overlay = document.getElementById('reorder-overlay');
    const status = document.getElementById('reorder-status');
    const content = document.getElementById('reorder-content');
    status.textContent = '正在评估任务难度与截止时间...';
    status.style.color = '';
    content.style.display = 'none';
    overlay.style.display = 'flex';

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
          overlay.style.display = 'none';
          return;
        }
        document.getElementById('reorder-reason').textContent = data.reasoning ? '💡 ' + data.reasoning : '';
        const list = document.getElementById('reorder-list');
        const container = document.getElementById('reorder-ids-container');
        list.innerHTML = '';
        container.innerHTML = '';
        (data.order || []).forEach((id, i) => {
          const li = document.createElement('li');
          li.textContent = data.idTitle[id] || id;
          list.appendChild(li);
          const input = document.createElement('input');
          input.type = 'hidden';
          input.name = 'ids';
          input.value = id;
          container.appendChild(input);
        });
        content.style.display = 'block';
      })
      .catch(() => { overlay.style.display = 'none'; });
  }
  checkNewTodoAndSuggest();

  const reorderCancel = document.getElementById('reorder-cancel');
  if (reorderCancel) {
    reorderCancel.addEventListener('click', function () {
      document.getElementById('reorder-overlay').style.display = 'none';
    });
  }

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
      document.querySelectorAll('.shortcuts-overlay, .pomodoro-overlay').forEach(o => o.style.display = 'none');
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
    } else if (key === 'f') {
      e.preventDefault();
      const items = getTodoItems();
      if (focusedIndex >= 0 && items[focusedIndex]) {
        const btn = items[focusedIndex].querySelector('.focus-btn');
        if (btn) openPomodoro(btn.dataset.title);
      }
    }
  });
})();
