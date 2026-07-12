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
    recognition.continuous = false;
    recognition.interimResults = false;
  }

  // 打开 AI 确认弹窗
  function openAiConfirm() {
    const overlay = document.getElementById('ai-confirm-overlay');
    const status = document.getElementById('ai-confirm-status');
    const form = document.getElementById('ai-confirm-form');
    form.style.display = 'none';
    status.textContent = '正在解析...';
    status.style.color = '';
    overlay.style.display = 'flex';
  }

  // 调用后端 AI 解析接口
  function callAiParse(transcript) {
    const status = document.getElementById('ai-confirm-status');
    const form = document.getElementById('ai-confirm-form');
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
        const todo = data.todo;
        document.getElementById('ai-title').value = todo.title;
        document.getElementById('ai-priority').value = todo.priority;
        document.getElementById('ai-dueTime').value = todo.dueTime || '';
        document.getElementById('ai-tags').value = (todo.tags || []).join(', ');
        document.getElementById('ai-notes').value = todo.notes || '';
        status.textContent = '已从你的描述中提取以下信息，确认无误后添加：';
        form.style.display = 'flex';
      })
      .catch(err => {
        status.textContent = '请求失败：' + err.message;
        status.style.color = '#ff3b30';
      });
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
        recognition.stop();
        return;
      }
      voiceBtn.classList.add('recording');
      voiceBtn.textContent = '⏹';
      isRecording = true;
      openAiConfirm();
      document.getElementById('ai-confirm-status').textContent = '正在聆听...请说话';

      recognition.onresult = function (event) {
        const transcript = event.results[0][0].transcript;
        document.getElementById('ai-confirm-status').textContent = '听到："' + transcript + '"，正在用 AI 整理...';
        callAiParse(transcript);
      };
      recognition.onerror = function (event) {
        document.getElementById('ai-confirm-status').textContent = '语音识别失败：' + event.error;
        document.getElementById('ai-confirm-status').style.color = '#ff3b30';
      };
      recognition.onend = function () {
        voiceBtn.classList.remove('recording');
        voiceBtn.textContent = '🎤';
        isRecording = false;
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
