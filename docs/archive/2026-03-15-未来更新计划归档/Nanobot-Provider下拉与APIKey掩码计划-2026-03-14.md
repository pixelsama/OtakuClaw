# Nanobot Provider 下拉与 API Key 掩码计划（2026-03-14）

## 背景

当前推理后端配置页存在两个可用性问题：

- `Provider` 是自由输入，用户容易填错供应商字符串，导致连接测试失败。
- `API Key` 在粘贴后出现“看起来像空值”的错觉，缺少密码类输入的掩码反馈。

## 目标

- 将 `Provider` 改为下拉框，仅展示 Nanobot 支持的供应商。
- 该下拉策略同时覆盖：
  - 首次引导页（首次使用引导）
  - 软件内配置面板（设置抽屉 / ConfigDrawer）
- `API Key` 粘贴后立即显示密码掩码（黑点），避免“粘贴了但看起来没内容”的误判。

## 设计范围

- 配置页：`front_end/src/components/config/ConfigDrawer.jsx`
- 首次引导后端步骤：`front_end/src/components/onboarding/FirstRunOnboardingDialog.jsx`
- 设置状态与持久化：`front_end/src/hooks/settings/useOpenClawSettings.js`
- 后端校验与错误码：`desktop/electron/services/chat/backends/nanobotBackend.js`（必要时）

## 实施方案

1. Provider 改为下拉框
   - 把当前 `TextField` 自由输入改为 `TextField select`。
   - 实施位置必须包含：
     - 引导页后端配置步骤
     - 配置面板中的 Nanobot 后端配置区
   - 选项来源优先级：
     - 优先：由后端返回“当前 Nanobot Runtime 支持的 provider 列表”。
     - 兜底：内置白名单（至少包含当前默认值 `openrouter` 与 `custom`）。
   - 若历史配置值不在列表内：
     - UI 显示“未识别供应商（旧配置）”提示；
     - 默认不自动清空，用户重新选择后才覆盖。

2. API Key 掩码显示
   - `API Key` 输入框统一为密码输入行为（`type=\"password\"`）。
   - 粘贴后显示系统密码掩码（黑点），不显示明文。
   - 保留“已保存 token”占位文案逻辑，但避免“完全空白”视觉效果。

3. 可用性补充
   - Provider 变更到 `custom` 时，`API Base` 标注必填。
   - 非 `custom` 时，`API Base` 标注可选（或自动回填默认值策略）。
   - 连接测试失败提示增加“provider 不受支持”指向性文案。

## 验收标准

- 用户在设置页和首次引导页都只能从下拉中选择 Provider。
- 粘贴 API Key 后输入框可见密码掩码，且值成功保存（重开应用后仍可用于连接测试）。
- 选择非法/过期 provider 的旧配置时，不会静默失败，界面有明确提示和修复路径。
- 连接测试路径可通过：`provider + model + apiKey` 组合有效时返回成功。

## 测试清单

- 单测
  - Provider 枚举与默认值回退逻辑。
  - API Key 输入与保存状态（含“已保存占位”）。
- GUI 回归
  - 首次引导页：Provider 下拉可选、API Key 掩码可见。
  - 配置侧边栏：Provider 下拉可选、API Key 掩码可见。
  - 连接测试：成功/失败文案是否符合预期。

## 风险与回滚

- 风险：Nanobot Runtime 的 provider 集合在不同版本不一致。
  - 缓解：使用“后端动态列表 + 前端兜底白名单”双轨。
- 风险：掩码显示后用户以为“输入被清空”。
  - 缓解：在输入框下方保留“已输入/已保存”辅助提示。
- 回滚策略：可临时回退为旧的自由输入框（但保留后端校验），避免阻塞发布。
