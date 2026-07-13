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
    dueDate: t.dueDate || '无',
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

  if (!resp.ok) await handleAiError(resp);

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

// 语音/自然语言 → 结构化 todo 数组：从用户口述提取一个或多个任务
// 输入：transcript（用户语音转文字或自然语言描述）
// 输出：[{ title, priority, dueTime, tags, notes }, ...]
async function parseTodo(transcript) {
  const { aiBaseUrl, aiApiKey, aiModel } = store.getSettings();
  if (!aiBaseUrl || !aiApiKey || !aiModel) {
    throw new Error('AI 未配置，请先到设置页填写 base_url、api_key、model');
  }

  const now = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });

  const system = `你是一位资深的 todo 管理专家与 GTD（Getting Things Done）顾问，擅长从用户零散的语音或文字描述中，提炼出清晰、可执行、可追踪的结构化任务。

【专家准则】
1. 可执行性优先：标题必须是"动宾结构"的可执行动作（如"撰写季度报告"而非"季度报告"），让用户看一眼就知道要做什么。
2. 去口语化：语音输入常含"那个""帮我""我要""就是说""嗯"等口语填充词，一律剔除，保留核心动作与对象。
3. 语义理解优先：不只依赖关键词，要理解用户真实意图。例如"老板催了好几次了"→ priority=high；"周五前要交"→ dueTime 需结合当前日期判断。
4. 时间智能：需识别日期和时间两部分。
   - 日期识别：相对日期（"今天""明天""后天""大后天""三天后""下周""下周一"等）需结合"当前时间"换算为 YYYY-MM-DD 格式写入 dueDate。"这周""下周"按 ISO 周计算。未提及日期则 dueDate 为空字符串。
   - 时间识别：相对时间（"下午3点""晚上8点"）转 24 小时制 HH:MM；模糊时间（"上午""下班前""晚上"）转近似值（上午=09:00，下班前=18:00，晚上=20:00）；仅说"3点"默认下午 15:00；未提及时间则 dueTime 为空字符串。
5. 优先级多维判断：综合紧迫性（截止临近、被催促）与重要性（影响他人、涉及承诺）判断 high/medium/low。含"紧急/马上/尽快/务必/老板/领导催"为 high；含"有空/顺便/尽量/不急"为 low；常规为 medium。
6. 标签智能归类：根据任务领域自动归类，如工作（会议/报告/代码/设计）、生活（买菜/取快递/缴费）、健康（运动/体检/吃药）。用 1-3 个简短标签，未明确则为空数组。
7. 备注提取价值：捕捉隐含的约束（"必须用 PPT""别忘了带上笔记本"）、依赖（"等张总确认后"）、背景（"客户上次提到的问题"），写入 notes 供后续参考；无则为空字符串。
8. 标题精炼：不超过 30 字，信息密度高，去掉修饰性废话。
9. 多任务拆分：用户一段话可能包含多件事，需按语义拆分为多个独立任务。常见拆分信号：顿号/逗号列举（"买菜、取快递、交水电费"）、连接词（"然后""接着""还有""另外"）、明显不同领域。每件事一个任务对象，共享的背景（如时间、地点）可分别写入各自 notes。若只描述了一件事，也输出单元素数组。

【输出规则】
- 只输出严格 JSON，不要任何多余文字、不要 markdown 代码块标记。
- 顶层为对象，含 todos 数组字段，每个元素含：title（字符串）、priority（high/medium/low）、dueDate（YYYY-MM-DD 或空字符串）、dueTime（HH:MM 或空字符串）、tags（字符串数组）、notes（字符串）。`;

  const user = `当前时间：${now}

用户描述：
${transcript}

请输出严格 JSON：
{
  "todos": [
    { "title": "任务标题", "priority": "medium", "dueDate": "", "dueTime": "", "tags": [], "notes": "" }
  ]
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

  if (!resp.ok) await handleAiError(resp);

  const data = await resp.json();
  const content = data.choices?.[0]?.message?.content || '';
  const json = extractJson(content);

  // 统一为数组：兼容 AI 偶尔返回单对象 {title,...} 或 {todos:[...]}
  let rawList = [];
  if (Array.isArray(json.todos)) {
    rawList = json.todos;
  } else if (json.title) {
    rawList = [json];
  }
  if (rawList.length === 0) {
    // 兜底：用原描述作为单任务标题
    rawList = [{ title: transcript }];
  }

  // 标准化每个任务字段
  return rawList.map(t => ({
    title: String(t.title || '').trim().slice(0, 100) || transcript,
    priority: ['high', 'medium', 'low'].includes(t.priority) ? t.priority : 'medium',
    dueDate: String(t.dueDate || '').trim(),
    dueTime: String(t.dueTime || '').trim(),
    tags: Array.isArray(t.tags) ? t.tags.map(x => String(x).trim()).filter(Boolean) : [],
    notes: String(t.notes || '').trim()
  }));
}

// 测试 AI 配置是否可用：发一个最便宜的 chat completions 请求
// 成功返回 { ok: true, model }；失败抛错（含状态码与脱敏后的响应文本）
async function testConnection() {
  const { aiBaseUrl, aiApiKey, aiModel } = store.getSettings();
  if (!aiBaseUrl || !aiApiKey || !aiModel) {
    throw new Error('请先填写 Base URL、API Key、模型名称');
  }
  const url = aiBaseUrl.replace(/\/$/, '') + '/chat/completions';
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${aiApiKey}`
    },
    body: JSON.stringify({
      model: aiModel,
      messages: [{ role: 'user', content: 'ping' }],
      max_tokens: 1
    }),
    signal: AbortSignal.timeout(30000)
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`HTTP ${resp.status}: ${sanitizeErrText(text)}`);
  }
  const data = await resp.json();
  return { ok: true, model: data.model || aiModel };
}

// 错误文本脱敏：过滤可能泄露 key 的内容（sk- 前缀、Bearer 头、Authorization 字段、****掩码后缀回显）
// 防止恶意上游在错误响应里回显 key 到前端
function sanitizeErrText(text) {
  const sliced = text.slice(0, 200);
  return sliced
    .replace(/sk-[A-Za-z0-9\-_]+/g, 'sk-***')
    .replace(/[Bb]earer\s+[A-Za-z0-9\-_.]+/g, 'Bearer ***')
    .replace(/"(?:api[_-]?key|authorization|secret)"\s*:\s*"[^"]*"/gi, '"***":"***"')
    .replace(/\*{2,}[A-Za-z0-9]{2,}/g, '***');
}

// 统一处理 AI 接口的非 2xx 响应
// 401/403 认证错误：不回显原始文本（DeepSeek 等会在错误里回显 key 片段如 ****lash），给通用提示
// 其他错误：脱敏后抛出，保留调试信息
async function handleAiError(resp) {
  if (resp.status === 401 || resp.status === 403) {
    // 仍要消费 body，但不再回显
    await resp.text().catch(() => {});
    throw new Error(`AI 接口认证失败（${resp.status}）：API Key 无效或权限不足，请到设置页检查`);
  }
  const text = await resp.text();
  throw new Error(`AI 接口错误 ${resp.status}: ${sanitizeErrText(text)}`);
}

module.exports = { reschedule, parseTodo, suggestReorder, testConnection };

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
    dueDate: t.dueDate || '无',
    dueTime: t.dueTime || '无',
    tags: (t.tags || []),
    notes: t.notes || '',
    isNew: t.id === newTodo.id ? '是' : '否',
    createdAt: t.createdAt || ''
  }));

  const system = `你是一个任务调度助手。用户刚新增了一条任务，请综合评估所有未完成任务，给出建议的处理顺序。
评估维度（按重要性排序）：
1. 截止时间紧迫度：综合 dueDate 和 dueTime 判断；有截止日期/时间且临近当前时间的最优先；已过截止时间的立即排首位。
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

  if (!resp.ok) await handleAiError(resp);

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
