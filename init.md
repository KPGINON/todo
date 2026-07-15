# 日清 Todo — 项目说明（init.md）

> 一个单用户、自托管的任务清单应用。核心理念：**未完成任务自动顺延到今天 + 每日"日清"归档 + AI 智能整理**。
> 技术栈：Node.js + Express + EJS 模板 + 原生 JS/CSS，数据用 `data.json` 文件持久化（无数据库）。

---

## 1. 项目概览

- **定位**：个人日清（daily-clear）待办系统，强调"今天能做完的事今天做完，做不完的顺延，做完的归档"。
- **架构**：单体 Express 服务端渲染（SSR），EJS 视图 + 轻量客户端 JS，无前端框架、无构建步骤。
- **存储**：单一 `data.json` 文件（原子写：先写 `.tmp` 再 rename），包含用户、设置、sessionSecret、todos、archives。
- **部署**：PM2（见 `ecosystem.config.js`，端口 3002，FORCE_HTTPS=1）；开发用 `npm run dev`（`node --watch`），默认端口 3000。
- **入口**：`server.js` → 路由挂载在 `routes/`，业务逻辑在 `lib/`，视图在 `views/`，静态资源在 `public/`。

### 目录结构
```
server.js              # 应用入口：中间件、session、CSRF、路由挂载、启动顺延
ecosystem.config.js     # PM2 生产配置
data.json              # 数据存储（已被 .gitignore，含密码哈希与加密的 API Key）
lib/
  store.js             # 数据层：读写 data.json、CRUD、批量、归档、搜索、统计、加解密
  auth.js              # 鉴权：密码登录、频率限制、CSRF token、session
  ai.js                # AI 调用：智能重排、语音/文本解析为 todo、连接测试
routes/
  auth.js              # 登录/登出/首次设密码
  todos.js             # 今日清单：增删改查、批量、拖拽排序、日清、AI 重排、AI 解析
  archive.js           # 历史归档列表与每日详情
  search.js            # 全局搜索
  stats.js             # 统计仪表盘
  settings.js          # AI 配置、连接测试、数据导出/导入、登出
views/                 # EJS 模板（_head/_foot 为布局）
public/                # app.js（客户端逻辑）、style.css
```

---

## 2. 功能点清单

### 2.1 任务管理（核心 CRUD）
- **快速新建**：首页顶部输入框，回车即添加（默认 medium 优先级）。
- **带详情新建**：可折叠表单，支持标题、优先级（高/中/低）、截止日期、预计完成时间、标签（逗号分隔）、备注。
- **编辑**：独立编辑页 `/todos/:id/edit`。
- **删除**：单条删除带二次确认。
- **完成切换**：点击圆圈切换完成状态，记录 `completedAt`。
- **看板视图**：首页分"待办"/"已完成"双列展示，列头显示计数。
- **自动排序**：未完成在前，再按优先级 → 截止日期 → 截止时间 → 创建时间排序。
- **拖拽排序**：待办列支持原生 HTML5 拖拽，drop 后提交新顺序到 `/todos/reorder` 持久化（写入 `todo.order` 字段，覆盖默认排序）。
- **启动顺延（carryOver）**：服务启动时把所有 `未完成且 date < 今天` 的任务 date 改为今天，确保"昨天没做完的今天还在"。

### 2.2 批量操作
- 勾选多任务后顶部出现批量工具栏：批量完成 / 取消完成 / 改优先级 / 加标签 / 批量删除。
- 实现于 `store.batchUpdate / batchDelete / batchAddTags`。

### 2.3 日清归档
- **日清按钮**：把当天已完成任务移入 `archives`（按日期分组），未完成的顺延到今天。
- **归档列表** `/archive`：按日期倒序列出所有归档日。
- **归档详情** `/archive/:date`：查看某天完成了哪些任务。

### 2.4 搜索
- `/search?q=`：在当前 todos 与所有 archives.items 中按关键词匹配 标题 / 备注 / 标签（不区分大小写）。

### 2.5 统计仪表盘 `/stats`
- 今日完成率（完成/总数 + 进度条）。
- 连续打卡天数（从今天往回数有归档记录的连续天数，含安全上限 365）。
- 累计完成任务数、有归档的天数。
- 近 7 天每日完成数柱状图（纯 CSS）。
- 标签分布（近 30 天归档，取前 8）。

### 2.6 AI 功能（依赖 OpenAI 兼容接口）
配置项：`aiBaseUrl` / `aiApiKey` / `aiModel` / `visionModel`，存于 `data.json`，**API Key 用 AES-256-GCM 加密**（密钥由 sessionSecret 派生）。`visionModel` 为图像识别专用模型（需支持 vision 输入），留空时截图排程回退到 `aiModel`。

- **语音速记 / AI 整理**：首页 🎤 按钮调用浏览器 Web Speech API（zh-CN，continuous + interimResults，静默 1.5s 自动停止）；不支持的浏览器回退为文本输入。识别文本 → `POST /ai/parse-todo` → `ai.parseTodo` 提取多个结构化任务（标题动宾化、智能识别日期/时间/优先级/标签/备注、多任务拆分）→ 弹窗可逐条编辑后"全部添加"。
- **新增后自动重排**：新增任务跳回首页时带 `newTodoId`，前端调用 `/ai/suggest-reorder`，AI 综合难度/截止/依赖/标签聚类/积压时长给出新顺序并**直接应用**，顶部显示可撤销提示条（不满意可一键还原）；任务 < 3 条则跳过。重排写入 `todo.order` 字段，GET `/` 渲染时有 `order` 的按 order 升序在前，无 `order` 的按默认规则（优先级→截止→时间→创建）追加在后。
- **截图排程**：首页 🖼 按钮，浮层支持粘贴（Ctrl+V）、拖入、点击选择图片 → `POST /ai/schedule-screenshot`（JSON，base64 图片，body limit 10mb）→ `ai.analyzeScreenshot` 用 vision 模型识别截图中的任务（日历/会议/待办/聊天等），结合现有未完成任务给出整体排程。**两步流程**：先返回识别出的新任务（可编辑/删除）+ 排程顺序 + reasoning 供用户确认，用户点"确认并排程"后 `POST /ai/apply-schedule` 创建任务并应用 `reorderTodos`。识别为空时仍可仅重排现有任务。重排考量逻辑同新增后重排，叠加截图识别出的截止/优先级信号。
- **AI 智能重排**：`POST /ai-reschedule`，输入当日情况描述，AI 重排剩余未完成任务并直接应用。
- **连接测试**：设置页"测试连接"发一个 `max_tokens:1` 的 ping 请求验证配置。
- **安全处理**：错误文本脱敏（过滤 sk- 前缀、Bearer 头、authorization 字段）；401/403 不回显原始文本；30s 超时（截图排程 60s）。

### 2.7 键盘快捷键
`N` 新建 · `/` 搜索 · `J/K` 上下选择 · `Space` 切换完成 · `E` 编辑 · `X` 勾选加入批量 · `?` 帮助 · `Esc` 关闭浮层。输入框内不触发（除 Esc）。

### 2.8 设置 `/settings`
- AI 接口配置（Base URL / API Key / 文本模型 / 图像识别模型），Key 不回显、留空不覆盖、可清除。
- 数据导出：下载全量 JSON（导出时清空 API Key，避免泄露）。
- 数据导入：粘贴 JSON 覆盖导入（带二次确认）。
- 退出登录。

### 2.9 鉴权与安全
- **单用户密码**：首次访问设置密码，bcrypt（cost=10）哈希存储；之后需登录。
- **登录频率限制**：同一 IP 15 分钟内失败 10 次后临时封禁（内存 Map）。
- **Session**：`express-session`，cookie 7 天、httpOnly、sameSite=lax，secure 跟随 FORCE_HTTPS；secret 持久化到 data.json 避免重启失效。
- **CSRF**：基于 session 的 token，所有 POST 校验 `_csrf`，视图通过 `res.locals.csrfToken` 注入。
- **HTTPS 强制**：`FORCE_HTTPS=1` 时 301 跳转，需配合 `trust proxy` 读取 `x-forwarded-proto`。
- **数据保护**：`/data.json` 直接访问返回 403；API Key 加密存储；导出脱敏。
- **trust proxy**：开启以支持 Nginx 反向代理后的 secure cookie 与正确 `req.ip`。

### 2.10 移动端与交互
- 侧边栏抽屉式菜单（汉堡按钮 + 遮罩），点击导航后自动关闭。
- 响应式 CSS（变量驱动主题色、圆角、阴影）。
- 顶部工具按钮联动折叠区（日清、详情新建滚动定位）。

---

## 3. 数据模型（data.json）

```jsonc
{
  "user": { "passwordHash": "$2a$..." },          // bcrypt 哈希
  "settings": {
    "aiBaseUrl": "",                               // OpenAI 兼容 base url
    "aiApiKey": "",                                // AES-256-GCM 密文（base64(iv+tag+ciphertext)）
    "aiModel": "",                                 // 文本模型（语音解析、重排、智能重排）
    "visionModel": ""                              // 图像识别模型（截图排程），留空回退到 aiModel
  },
  "sessionSecret": "<hex>",                        // 32 字节随机，派生加密密钥 + session 签名
  "todos": [ /* 活跃任务 */ ],
  "archives": [ { "date": "YYYY-MM-DD", "items": [ /* 已完成任务 */ ] } ]
}
```

**Todo 对象**：
```jsonc
{
  "id": "uuid",
  "title": "任务标题",
  "completed": false,
  "priority": "high|medium|low",
  "dueDate": "YYYY-MM-DD | ''",
  "dueTime": "HH:MM | ''",
  "tags": ["工作", "生活"],
  "notes": "备注",
  "createdAt": "ISO",
  "completedAt": "ISO | null",
  "date": "YYYY-MM-DD",         // 任务所属日期（顺延依据）
  "order": number | undefined   // 手动/AI 排序序号；有则按升序排在前，无则按默认规则追加
}
```

---

## 4. 路由总览

| 方法 | 路径 | 说明 | 鉴权 |
|---|---|---|---|
| GET | `/login` | 登录/首次设密页 | 否 |
| POST | `/login` | 登录或设置密码 | 否（CSRF） |
| POST | `/logout` | 退出 | 是 |
| GET | `/` | 今日清单 | 是 |
| POST | `/todos` | 新建任务 | 是 |
| POST | `/ai/suggest-reorder` | 新增后 AI 重排建议（JSON） | 是 |
| POST | `/todos/:id/toggle` | 切换完成 | 是 |
| GET | `/todos/:id/edit` | 编辑页 | 是 |
| POST | `/todos/:id/edit` | 保存编辑 | 是 |
| POST | `/todos/:id/delete` | 删除 | 是 |
| POST | `/todos/batch` | 批量操作 | 是 |
| POST | `/todos/reorder` | 拖拽排序 | 是 |
| POST | `/daily-clear` | 日清归档 | 是 |
| POST | `/ai-reschedule` | AI 智能重排 | 是 |
| POST | `/ai/parse-todo` | AI 解析语音/文本为任务（JSON） | 是 |
| POST | `/ai/schedule-screenshot` | 截图排程第一步：识别截图任务+排程建议（JSON，不创建） | 是 |
| POST | `/ai/apply-schedule` | 截图排程第二步：创建新任务+应用重排（JSON） | 是 |
| GET | `/archive` | 归档列表 | 是 |
| GET | `/archive/:date` | 归档详情 | 是 |
| GET | `/search` | 搜索 | 是 |
| GET | `/stats` | 统计 | 是 |
| GET | `/settings` | 设置页 | 是 |
| POST | `/settings` | 保存设置/清除 Key | 是 |
| POST | `/settings/ai/test` | 测试 AI 连接（JSON） | 是 |
| GET | `/settings/export` | 导出 JSON | 是 |
| POST | `/settings/import` | 导入 JSON | 是 |

> 除 `/login` 的 GET/POST 外，所有路由经 `auth.requireAuth` 中间件保护。所有 POST 经 CSRF 校验。

---

## 5. 运行方式

```bash
npm install        # 安装依赖
npm start          # 生产启动（node server.js，端口 3000 或 PORT 环境变量）
npm run dev        # 开发启动（node --watch，文件改动自动重启）
pm2 start ecosystem.config.js   # PM2 托管（端口 3002，FORCE_HTTPS=1）
```

**环境变量**：
- `PORT`：监听端口（默认 3000）。
- `SESSION_SECRET`：session 密钥（未设则用 data.json 中持久化的 sessionSecret）。
- `FORCE_HTTPS`：设为 `1` 启用 HTTPS 强制重定向 + secure cookie。

**首次使用**：启动后访问站点，设置登录密码即可（单用户）。

---

## 6. 关键实现细节与约定

- **原子写入**：`store.write` 先写 `data.json.tmp` 再 rename，防止写中途崩溃损坏数据。
- **API Key 加解密**：`store.getSettings` 读取时解密、`setSettings` 写入时加密；兼容历史明文（解密失败按明文返回）。加密密钥由 `sessionSecret` 经 SHA-256 派生。
- **AI 输出容错**：`extractJson` 兼容 ```json 代码块包裹与裸 JSON；`reschedule`/`suggestReorder` 对返回的 order 做校验与遗漏补全，确保 id 集合完整。
- **CSRF token 注入**：所有表单含 `<input type="hidden" name="_csrf">`；前端 JS 发 POST 时从页面 `input[name="_csrf"]` 取值并附带。
- **客户端无框架**：`public/app.js` 为原生 IIFE，包含移动端菜单、批量选择、番茄钟、拖拽、语音+AI 解析、重排建议、快捷键等模块。
- **视图布局**：`views/_head.ejs`（含侧边栏导航）+ 各页内容 + `views/_foot.ejs`（引入 app.js）；`login` 页通过 `showNav:false` 隐藏侧栏。

---

## 7. 当前数据状态（data.json 示例）

- 已设置密码（bcrypt）、AI 配置为 DeepSeek（`api.deepseek.com`，模型 `deepseek-v4-flash`）。
- 6 条未完成任务（2026-07-12），均为 medium 优先级，含 dueTime 与标签（健康/运动/工作/生活），archives 为空。
- sessionSecret 已生成并持久化。

> 注：`data.json` 已在 `.gitignore` 中，不应提交到仓库。
