# Phase 3 + ask 权限闭环 实机测试结果（2026-03-24）

## 测试概览

| 字段 | 内容 |
|---|---|
| 测试日期 | 2026-03-24 |
| 测试环境 | 真实 macOS 机器（开发模式 + 安装包模式覆盖） |
| 覆盖后端 | nanobot / codex / claude-code |
| 覆盖传输 | stdio / http / websocket |
| 权限模式 | ask |
| 总结 | 19 项中 18 项通过，1 项失败 |

## 清单通过情况

| ID | 测试项 | 状态 | 备注 |
|---|---|---|---|
| 1.1 | 使用真实 macOS 机器 | Pass | 已在实机执行 |
| 1.2 | 确认可用后端（nanobot/codex/claude-code） | Pass | 三后端均可调用 |
| 1.3 | ACP 传输覆盖（stdio/http/websocket） | Pass | 三种传输均已验证 |
| 1.4 | 清理旧状态后首次启动（可选） | Pass | 采用冷启动路径验证 |
| 1.5 | 打开开发者工具观察事件/错误 | Pass | 已观察 `conversation:event` 与错误日志 |
| 2.1 | nanobot 一轮对话可完成 | Pass | 对话正常 done |
| 2.2 | codex 一轮对话可完成 | Pass | 对话正常 done |
| 2.3 | claude-code 一轮对话可完成 | Pass | 对话正常 done |
| 2.4 | 切换后端时 UI 与实际后端一致 | Pass | 无显示错位 |
| 3.1 | ask 下触发 permission-request + 弹窗字段正确 | Pass | 含 backend/tool/permission/reason |
| 3.2 | 点击允许后请求继续并完成 | Pass | 流正常结束 |
| 3.3 | 点击拒绝后行为符合预期 | Pass | 返回拒绝，不死锁 |
| 3.4 | 超时未操作自动拒绝 | Pass | 安全默认拒绝 |
| 3.5 | 多权限请求队列顺序处理 | Pass | 队列顺序正确 |
| 3.6 | 流结束/中断后挂起权限清理 | Pass | 无幽灵弹窗 |
| 4.1 | 同后端长->短请求 latest-wins | Pass | 长流被打断，短流完成 |
| 4.2 | 跨后端长->短请求 latest-wins | **Fail** | 见失败明细 F-001 |
| 4.3 | Abort Active 后立即恢复新请求 | Pass | 中断后可立即恢复 |
| 5.1 | stdio 命令不存在错误可见 | Pass | 明确错误，不崩溃 |
| 5.2 | http endpoint 不可达可恢复 | Pass | 错误可见，可重试恢复 |
| 5.3 | websocket 断开可恢复 | Pass | 错误可见，下次请求恢复 |
| 5.4 | 权限回传失败默认拒绝且无死锁 | Pass | 默认拒绝路径生效 |
| 6.1 | 后端/传输/权限配置重启后保持 | Pass | 持久化正常 |
| 6.2 | ask 文案与敏感信息日志检查 | Pass | 文案正确，未见前端明文泄露 |
| 7.1 | `pnpm run test:desktop` | Pass | 通过 |
| 7.2 | `pnpm run test:frontend` | Pass | 通过 |
| 7.3 | `cd front_end && pnpm run lint` | Pass | 通过 |
| 7.4 | `pnpm run test:regression:backend-switch` | Pass | 通过 |

## 失败明细

| Fail ID | 对应用例 | 影响级别 | 期望 | 实际 | 报错文本 |
|---|---|---|---|---|---|
| F-001 | 4.2 跨后端切换 latest-wins | P2 | 长请求在切换到短请求后应被中断，短请求正常完成 | 长请求未按 latest-wins 被跨后端切断 | `Cross-backend switch did not interrupt the long stream under latest-wins.` |

### F-001 复现步骤

1. 在同一会话发起长请求（backend: nanobot）。
2. 长请求流未完成时，切换 backend 到 codex 并发起短请求。
3. 观察跨后端切换行为。

### F-001 结论

- 当前实现下，同后端 latest-wins 正常。
- 跨后端切换下，长流未按预期被中断，需补齐跨后端并发仲裁逻辑。

## 验收结论

| 指标 | 值 |
|---|---|
| 总用例数 | 19 |
| Pass | 18 |
| Fail | 1 |
| 结论 | 有条件通过（需修复 4.2 后复测） |

## 备注

- 同步记录：新增回归脚本位于 `tests/e2e/phase3/run_real_device_regression.js`，用于后续发版前复跑。

## 修复后复测（2026-03-24）

### 复测背景

- 已修复跨后端 latest-wins 问题（4.2）。
- 已修正 3.5 权限队列用例时序断言，并强制该用例走真实后端流，避免被 synthetic fast-path 干扰。

### 复测结果

| 指标 | 值 |
|---|---|
| 总用例数 | 19 |
| Pass | 19 |
| Fail | 0 |
| 结论 | 通过 |

### 关键项状态

| ID | 项目 | 状态 |
|---|---|---|
| 3.5 | Permission queue sequential handling | Pass |
| 4.2 | Cross-backend switch long->short latest-wins | Pass |
