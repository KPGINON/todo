# AI 接口配置说明

本应用通过 OpenAI 兼容的 `chat/completions` 接口调用大模型，支持智能重排、自然语言建任务、对话、截图排程等功能。本文记录当前已验证可用的配置和填法。

## 设置页字段对照

设置页（`/settings`）有 4 个字段，对应表单 `name`：

| 设置页标签 | 表单 name | 说明 |
|---|---|---|
| Base URL | `aiBaseUrl` | 接口地址，到 `/v1` 为止，代码会自动拼接 `/chat/completions` |
| API Key | `aiApiKey` | Bearer token，存服务端加密存储，不回显 |
| 模型名称 | `aiModel` | **文本对话/重排/解析用的模型**，必填 |
| 图像识别模型 | `visionModel` | **截图排程专用**，需支持 vision（多模态），留空则回退用上面的 `aiModel` |

## 当前已验证配置（hiagent 平台）

以下配置已通过端到端验证（文本 `testConnection` + 视觉 `analyzeScreenshot` 均 HTTP 200），已写入用户 `ee6a0bbf-6f9c-4995-8b6b-f2bbf01f148f` 的 `userSettings`，重启服务即生效：

- **Base URL**：`https://qingtian.dfmc.com.cn:32280/v1`
- **API Key**：`d300bad8e...`（完整值已加密存入 `data.json`，不在文档记录）
- **模型名称**（文本）：`d92sjptf877dcqd84ha0`（底层 `GLM-5.2-INT4`，content 直接返回）
- **图像识别模型**（视觉）：`d25fd35vobmt1ao9pda0`（`Qwen2.5-VL-32B-Instruct`，真多模态，能看图）

> 该 key 下 `/v1/models` 返回的 4 个模型见下表。注意 hiagent 的模型授权**按 key 绑定**——换 key 会换可用模型集合，旧 key（`cfb6f91c...`）下第 4 个是 `d2d941dvobmt1ao9pecg`（custom-llm，弱且非视觉），新 key 下第 4 个是 `d25fd35vobmt1ao9pda0`（Qwen2.5-VL，视觉）。

## 关键填法：用模型 ID，不要用显示名称

hiagent 平台的模型调用**必须用 ID（形如 `d92xxxx`），不能用平台显示名称**。

- 填 `GLM-5.2`（显示名）→ 上游返回 `403 model_access_denied: no access to model GLM-5.2`
- 填 `d92sjptf877dcqd84ha0`（对应 ID）→ 正常 200

显示名和 ID 的对应关系需要去 hiagent 平台查。`/v1/models` 接口只返回 ID 不返回名称，所以不能靠接口反查。

## 当前账号可用模型

通过 `/v1/models` 查到，当前 key（`d300bad8e...`）可访问 4 个模型：

| 模型 ID | 底层模型 | 文本 | 看图 | 备注 |
|---|---|---|---|---|
| `d92t3ra74uha3ls385o0` | GLM-5.2-INT4 | reasoning 模式（content 空，回答在 `reasoning_content`） | 否 | 需改 `ai.js` 读 `reasoning_content` 才能用 |
| `d92sjptf877dcqd84ha0` | GLM-5.2-INT4 | ✓ content 正常 | 否 | **当前文本模型** |
| `d7hgg5quad289du7ej1g` | MiniMax-M2.7-BF16 | reasoning 模式（content 空） | 否 | 需改 `ai.js` 才能用 |
| `d25fd35vobmt1ao9pda0` | Qwen2.5-VL-32B-Instruct | ✓ content 正常 | **✓ 真多模态** | **当前视觉模型** |

探测方式：对每个模型发带 `image_url` 的请求，非多模态模型返回 `xxx is not a multimodal model`（400）；真多模态模型返回 200 并能描述图片内容。

> 注意：`d3ngji1rt3dd9u1q3eo0`（doubao-seed-1-6）在另一个 key 下出现，发图返回 200 但回答"无法查看图片"——它接受 image_url 参数却不真正解析图像，**不能用于截图排程**。判断视觉模型要确认它**真的描述出图片内容**，而不只是不报错。

## 图像识别模型（visionModel）

截图排程功能（`/ai/schedule-screenshot`）需要 vision 模型，调用时用 `image_url` 多模态格式，代码在 `lib/ai.js` 的 `analyzeScreenshot`。

**当前状态：已配置 `d25fd35vobmt1ao9pda0`（Qwen2.5-VL-32B-Instruct），已验证可看图，截图排程可用。**

历史排查记录（供后续换模型参考）：

- hiagent 模型授权**按 key 绑定**：同一个模型 ID 在 A key 下 `no access`、在 B key 下可用。换 key 后必须重新拉 `/v1/models` 确认可用集合。
- 平台显示名（如 `GLM-5.2`、`Qwen2.5-VL-32B-Instruct`）和模型 ID（`d92xxxx`）都能当 `model` 字段传，但**显示名不一定有权限**——优先用 `/v1/models` 返回的 ID。
- `d3ngji1rt3dd9u1q3eo0`（doubao-seed-1-6）发图返回 200 但说"无法查看图片"，是假视觉，不能用。
- `Qwen-Image-2512` 是图像**生成**模型、`doubao-seedance` 系列是视频**生成**模型，方向相反，都不能用于看图。要看图必须选名字带 **VL / Vision** 的视觉**理解**模型。

**换视觉模型后的验证命令**（确认它真看图，不只是不报错）：

```bash
KEY="你的key"
curl -s -X POST "https://qingtian.dfmc.com.cn:32280/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $KEY" \
  -d '{"model":"模型ID","messages":[{"role":"user","content":[{"type":"text","text":"这张图上半部分和下半部分分别什么颜色?"},{"type":"image_url","image_url":{"url":"data:image/png;base64,<一张上红下蓝的PNG base64>"}}]}],"max_tokens":50}'
```

返回能正确说出颜色 = 真视觉模型；返回"无法查看图片"或 `is not a multimodal model` = 不能用。注意图片最小尺寸 14×14 像素，太小会被拒（`Image dimensions are too small`）。

## 配置存储与读取

- 写入：`routes/settings.js` 的 POST `/settings`，调用 `store.setSettings(patch, req.session.userId)`，按用户隔离存储，API Key 用 `sessionSecret` 派生密钥 AES-256-GCM 加密（`lib/store.js` 的 `encryptApiKey`）。
- 读取：`lib/ai.js` 的各 AI 函数调用 `await store.getSettings(userId)` 读取并解密。**必须传 `userId` 且加 `await`**，否则读到空配置（历史 bug，已修复）。
- 日志：所有 AI 请求经 `lib/ai.js` 的 `aiRequest` 统一打印 `[ai] <场景> 请求/成功/失败/异常`，含 URL、model、HTTP 状态码、耗时。失败时错误体经 `sanitizeErrText` 脱敏（过滤 sk-/Bearer/Authorization 等敏感字段）。API Key 绝不进日志。

## 排查指南

配置出错时先看终端 `[ai]` 日志：

- `[ai] xxx 请求 → POST <url> model=... user=...` —— 请求已发出，说明配置读取成功。
- `[ai] xxx 失败 ← HTTP 401/403 ...ms 认证失败` —— API Key 无效或该模型未授权（`model_access_denied`）。
- `[ai] xxx 失败 ← HTTP 404 ...` —— base_url 路径不对，或 model ID 写错。
- `[ai] xxx 失败 ← HTTP 400 ... body=is not a multimodal model` —— 把非 vision 模型填进了"图像识别模型"字段。
- 没有任何 `[ai]` 日志、直接报"AI 未配置" —— 配置没读到，检查 `getSettings(userId)` 是否带了 userId（已修复的 bug 复现）。
- `[ai] xxx 异常 ← ...ms Failed to parse URL` / `ECONNREFUSED` —— base_url 拼写错误或网络不通。

用设置页"测试连接"按钮可快速验证主模型（`aiModel`），它调用 `ai.testConnection`，发一个 `max_tokens=1` 的 ping 请求。
