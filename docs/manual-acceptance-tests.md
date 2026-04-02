# 手工验收步骤

## 自动化验证执行记录

**执行时间**: 2026-04-02T13:40:44+08:00
**执行环境**: Node.js v24.11.1, Linux 6.8.0-65-generic
**执行者**: Claude Code RLCR Loop Round 5

| 验证项 | 结果 | 证据 |
|--------|------|------|
| 后端测试 (47 tests, 5 files) | PASS | state/engine/openrouter/words/scoring 全部通过 |
| 前端测试 (13 tests, 3 files) | PASS | Timer倒计时/STT降级/多轮发言/语音自动发送/TTS触发 |
| 客户端构建 (vite build) | PASS | 50 modules transformed |
| 服务端启动 | PASS | Server running on port 3001 |

### 关键自动化测试覆盖项
- **Discussion timer首包含时间戳**: `engine.test.js` - discussion phase_change broadcast includes non-null discussionStartTime
- **AI讨论实时上屏**: `engine.test.js` - AI discussion_message broadcasts include state with discussions
- **计分round2↔round3**: `scoring.test.js` - 7个场景全覆盖
- **API key预检**: `engine.test.js` - rejects format-valid but actually-invalid API key via preflight
- **Timer倒计时**: `Timer.test.jsx` - counts down, shows 00:00 on expiry
- **STT降级**: `audio.test.js` - FunASR失败后降级到浏览器
- **STT多轮**: `audio.test.js` - 连续start/stop两轮均工作
- **语音自动发送成功**: `integration.test.js` - discussion/questioning阶段自动发送
- **语音发送失败保留文本**: `integration.test.js` - ws未ready时保留文本+警告
- **TTS只播AI消息**: `integration.test.js` - 正确过滤AI/host消息

### FunASR/CosyVoice 真实服务验收说明
以上测试使用mock验证了完整的接线逻辑和降级路径。真实FunASR/CosyVoice服务的端到端验收需要：
1. 配置有效的`FUNASR_API_URL`和`FUNASR_API_KEY`
2. 配置有效的`COSYVOICE_API_KEY`
3. 使用手机浏览器实际操作

代码层面已确保：
- FunASR: 每次start()发送新的speaking配置帧，stop()结束语音段（`audio.js:88-97`）
- 降级: FunASR连接失败5秒超时后自动切换到浏览器STT（`audio.js:22-30`）
- 自动发送: 识别结果根据phase直接发送discuss/question（`MobilePlayer.jsx:42-60`）
- 失败保留: send()返回false时保留文本+显示警告（`MobilePlayer.jsx:53-57`）
- TTS: AI讨论+AI提问+主持人回答均触发TTS（`useWebSocket.js:54-67`, `GameDisplay.jsx:24-31`）

---

## 前提条件
- `.env` 配置了有效的 `FUNASR_API_URL` 和 `FUNASR_API_KEY`（或留空测试降级）
- `.env` 配置了有效的 `OPENROUTER_API_KEY`（格式 `sk-or-...`）
- 服务端运行中：`npm run dev:server`
- 客户端运行中：`npm run dev:client`

---

## 测试 1：FunASR 成功识别（需要有效的 FunASR 服务）
1. 在 `.env` 中设置有效的 `FUNASR_API_URL` 和 `FUNASR_API_KEY`
2. 手机浏览器打开 `/play/XXXX` 加入游戏
3. 等待页面底部显示 "FunASR已连接"
4. 在讨论或提问阶段，按住"按住说话"按钮，说"这是一个测试"
5. **预期**：松开后文字自动发送到游戏对话流，无需点击"发送"按钮
6. **预期**：大屏上能看到你的发言内容

## 测试 2：FunASR 连接失败后浏览器降级
1. 在 `.env` 中将 `FUNASR_API_URL` 设为无效地址（如 `wss://invalid.example.com/ws`）
2. 手机浏览器打开 `/play/XXXX` 加入游戏
3. **预期**：页面底部显示 "FunASR连接失败，使用浏览器语音识别" 然后变为 "使用浏览器语音识别"
4. 按住"按住说话"按钮说话
5. **预期**：浏览器语音识别正常工作，识别结果自动发送

## 测试 3：FunASR 未配置时降级
1. 在 `.env` 中清空 `FUNASR_API_URL` 和 `FUNASR_API_KEY`
2. 手机浏览器打开 `/play/XXXX` 加入游戏
3. **预期**：页面底部显示 "使用浏览器语音识别"

## 测试 4：连续两次语音输入
1. 使用任一 STT 模式加入游戏
2. 在讨论阶段按住说话 → 松开 → 确认发言出现在对话流
3. 再次按住说话 → 松开
4. **预期**：第二次语音输入同样能被识别并自动发送
5. **预期**：对话流中出现两条发言

## 测试 5：Discussion 计时器正常倒计时
1. 大屏创建游戏并开始
2. 进入讨论阶段
3. **预期**：中间状态栏显示倒计时，从 00:45 开始倒数
4. **预期**：倒计时归零后自动进入提问阶段

## 测试 6：提问阶段 7 分钟计时器
1. 进入提问阶段
2. **预期**：计时器显示 07:00 并倒计时
3. **预期**：计时到 01:00 以内时数字变红并闪烁

## 测试 7：无效 OpenRouter API key 阻止游戏启动
1. 在 `.env` 中将 `OPENROUTER_API_KEY` 设为 `sk-or-v1-this-is-a-fake-key-that-will-not-work-12345`
2. 大屏创建游戏，配置好 AI 和 4 个真人加入
3. 点击开始游戏
4. **预期**：显示错误提示，游戏不会进入 word_assignment 阶段

## 测试 8：垃圾 API key 格式阻止游戏启动
1. 在 `.env` 中将 `OPENROUTER_API_KEY` 设为 `garbage-key-not-valid`
2. 同上操作
3. **预期**：显示 "format is invalid" 错误，游戏不启动
