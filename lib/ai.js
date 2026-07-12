const store = require('./store');

// 调用 OpenAI 兼容的 chat completions 接口，根据当日突发情况重排剩余未完成任务
// 输入：todos（未完成的），situation（用户描述的当日情况）
// 输出：{ order: [id...], reasoning: '...' }
async function reschedule(remainingTodos, situation) {
  const { aiBaseUrl, aiApiKey, aiModel } = store.getSettings();
  if (!aiBaseUrl || !aiApiKey || !aiModel) {
    throw new Error('AI 未配置，请先到设置页填写 base_url、api_key、model');
  }

  const tasks = remainingTodos.map((t, i) => ({
    index: i,
    id: t.id,
    title: t.title,
    priority: t.priority,
    dueTime: t.dueTime || '无',
    tags: t.tags || [],
    notes: t.notes || ''
  }));

  const now = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });

  const system = `你是一个高效的任务调度助手。用户有一份"日清"待办清单，现在需要你根据当天的突发情况重新排布剩余未完成任务的处理顺序。
原则：
1. 紧急且重要（高优先级 + 有截止时间临近）优先。
2. 结合用户描述的当日实际情况（如临时会议、精力、突发事件）合理调整。
3. 尽量把有截止时间的任务安排在截止前。
4. 只输出 JSON，不要多余文字。`;

  const user = `当前时间：${now}

剩余未完成任务（共 ${tasks.length} 条）：
${JSON.stringify(tasks, null, 2)}

当日情况描述：
${situation || '无特殊说明'}

请输出严格的 JSON，格式如下：
{
  "order": ["任务id按建议顺序排列"],
  "reasoning": "简短说明重排理由（一句话）"
}
注意：order 数组必须包含上面所有任务的 id，不能多也不能少。`;

  const url = aiBaseUrl.replace(/\/$/, '') + '/chat/completions';
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${aiApiKey}`
    },
    body: JSON.stringify({
      model: aiModel,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ],
      temperature: 0.3
    }),
    signal: AbortSignal.timeout(30000) // 30 秒超时，避免请求无限挂起
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`AI 接口错误 ${resp.status}: ${text}`);
  }

  const data = await resp.json();
  const content = data.choices?.[0]?.message?.content || '';
  const json = extractJson(content);

  // 校验 order 包含所有 id
  const allIds = new Set(tasks.map(t => t.id));
  const order = Array.isArray(json.order) ? json.order : [];
  const valid = order.filter(id => allIds.has(id));
  // 补全遗漏的
  allIds.forEach(id => { if (!valid.includes(id)) valid.push(id); });

  return {
    order: valid,
    reasoning: json.reasoning || ''
  };
}

function extractJson(text) {
  // 去掉 ```json ... ``` 包裹
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1] : text;
  try {
    return JSON.parse(raw.trim());
  } catch (e) {
    // 尝试找第一个 { 到最后一个 }
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return JSON.parse(raw.slice(start, end + 1));
    }
    throw new Error('AI 返回内容无法解析为 JSON: ' + text);
  }
}

// 语音/自然语言 → 结构化 todo：从用户口述提取标题、优先级、时间、标签、备注
// 输入：transcript（用户语音转文字或自然语言描述）
// 输出：{ title, priority, dueTime, tags, notes }
async function parseTodo(transcript) {
  const { aiBaseUrl, aiApiKey, aiModel } = store.getSettings();
  if (!aiBaseUrl || !aiApiKey || !aiModel) {
    throw new Error('AI 未配置，请先到设置页填写 base_url、api_key、model');
  }

  const now = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });

  const system = `你是一个任务提取助手。用户会用自然语言（往往是语音输入）描述要做的事，你需要提取出结构化的待办任务信息。
规则：
1. title：简明扼要的任务标题（不超过 30 字），去除口语化词汇（"那个"、"帮我"、"我要"等）。
2. priority：根据紧迫程度判断 high/medium/low。含"紧急/马上/尽快/务必"为 high，含"有空/顺便/尽量"为 low，其余为 medium。
3. dueTime：如果用户提到具体时间点（如"下午3点"、"3点半"、"15点"），转为 HH:MM 24小时制；未提及则为空字符串。
4. tags：提取关键分类标签数组，如 ["工作","会议"]；未明确则为空数组。
5. notes：用户提到的额外说明或背景，没有则为空字符串。
6. 只输出 JSON，不要多余文字。`;

  const user = `当前时间：${now}

用户描述：
${transcript}

请输出严格 JSON：
{
  "title": "任务标题",
  "priority": "medium",
  "dueTime": "",
  "tags": [],
  "notes": ""
}`;

  const url = aiBaseUrl.replace(/\/$/, '') + '/chat/completions';
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${aiApiKey}`
    },
    body: JSON.stringify({
      model: aiModel,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ],
      temperature: 0.2
    }),
    signal: AbortSignal.timeout(30000)
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`AI 接口错误 ${resp.status}: ${text}`);
  }

  const data = await resp.json();
  const content = data.choices?.[0]?.message?.content || '';
  const json = extractJson(content);

  return {
    title: String(json.title || transcript).trim().slice(0, 100),
    priority: ['high', 'medium', 'low'].includes(json.priority) ? json.priority : 'medium',
    dueTime: String(json.dueTime || '').trim(),
    tags: Array.isArray(json.tags) ? json.tags.map(t => String(t).trim()).filter(Boolean) : [],
    notes: String(json.notes || '').trim()
  };
}

module.exports = { reschedule, parseTodo, suggestReorder };

// 新增任务时，结合任务难度、截止时间等要素，对当前未完成任务给出重排建议
// 输入：newTodo（刚新增的任务），remainingTodos（当前所有未完成任务，含 newTodo）
// 输出：{ order: [id...], reasoning: '...' }
async function suggestReorder(newTodo, remainingTodos) {
  const { aiBaseUrl, aiApiKey, aiModel } = store.getSettings();
  if (!aiBaseUrl || !aiApiKey || !aiModel) {
    throw new Error('AI 未配置，请先到设置页填写 base_url、api_key、model');
  }

  const now = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });

  const tasks = remainingTodos.map(t => ({
    id: t.id,
    title: t.title,
    priority: t.priority,
    dueTime: t.dueTime || '无',
    tags: (t.tags || []),
    notes: t.notes || '',
    isNew: t.id === newTodo.id ? '是' : '否',
    createdAt: t.createdAt || ''
  }));

  const system = `你是一个任务调度助手。用户刚新增了一条任务，请综合评估所有未完成任务，给出建议的处理顺序。
评估维度（按重要性排序）：
1. 截止时间紧迫度：有 dueTime 且临近当前时间的最优先；已过截止时间的立即排首位。
2. 优先级：high > medium > low。
3. 依赖关系：若任务标题/备注暗示依赖（如"写文档"依赖"调研完成"），被依赖任务排前。
4. 难度与精力匹配：高难度任务（开发/设计/写作/方案）安排靠前（高精力时段），低难度任务（回复/确认/整理/打卡）可靠后。
5. 标签聚类：同标签任务尽量相邻，减少上下文切换（如连续处理"会议"类）。
6. 积压时长：createdAt 较早且仍未完成的任务适当提前，避免无限顺延。
7. 新增任务插队判断：仅当新任务满足以下任一条件才插到前面——优先级 ≥ 现有最高、有早于现有最早的截止时间、标题含"紧急/立即/马上"；否则按常规顺序追加。
只输出 JSON，不要多余文字。`;

  const user = `当前时间：${now}

未完成任务（共 ${tasks.length} 条，isNew=是 的是刚新增的）：
${JSON.stringify(tasks, null, 2)}

请输出严格 JSON：
{
  "order": ["任务id按建议顺序排列"],
  "reasoning": "一句话说明重排理由，重点说明新任务是否插队及原因"
}
注意：order 必须包含上面所有任务的 id，不能多不能少。`;

  const url = aiBaseUrl.replace(/\/$/, '') + '/chat/completions';
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${aiApiKey}`
    },
    body: JSON.stringify({
      model: aiModel,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ],
      temperature: 0.3
    }),
    signal: AbortSignal.timeout(30000)
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`AI 接口错误 ${resp.status}: ${text}`);
  }

  const data = await resp.json();
  const content = data.choices?.[0]?.message?.content || '';
  const json = extractJson(content);

  const allIds = new Set(tasks.map(t => t.id));
  const order = Array.isArray(json.order) ? json.order : [];
  const valid = order.filter(id => allIds.has(id));
  allIds.forEach(id => { if (!valid.includes(id)) valid.push(id); });

  return {
    order: valid,
    reasoning: json.reasoning || ''
  };
}
