# Free-Agent-Vtuber-openclaw React 等价迁移技术指导

## 1. 文档目标

本文给出将当前 `front_end`（Vue 3 + Vuetify）迁移到 React 生态的可执行方案，目标是：

- 保持现有对外协议不变（仍通过 gateway 调用 `POST /chat/stream`，消费 `text-delta/done`）。
- 保持现有核心体验等价（Live2D 渲染、控制面板、字幕流、预设与本地缓存）。
- 保持 OpenClaw-only 架构，不恢复 legacy 语音链路。

---

## 2. 当前系统基线（迁移输入）

### 2.1 当前前端技术栈

- 框架：Vue 3（Composition API）
- UI：Vuetify 3 + MDI
- 构建：Vite 5
- 测试：Vitest（当前用例较少）
- Live2D：本地集成 `src/live2d/*` + `Live2DManager.js`

关键文件规模（用于评估工作量）：

- `src/components/Live2DControls.vue`：2654 行
- `src/live2d/utils/Live2DManager.js`：1817 行
- `src/components/Live2DViewer.vue`：809 行
- `src/composables/useApi.js`：805 行（旧语音链路遗留）
- 前端总计核心代码约 6717 行

### 2.2 当前后端接口基线（迁移时保持不变）

- `POST /chat/stream`（SSE，`text-delta`/`done`）
- 旧语音与控制接口已返回 `410 not_supported`
- 诊断接口：`/health`、`/connections`

结论：React 迁移主要是前端重写，不要求后端协议调整。

---

## 3. 迁移范围与等价定义

### 3.1 必须等价（P0）

- `App.vue` 主舞台布局与交互入口（配置按钮、文本发送弹窗、字幕条）。
- `Live2DViewer` 能力：
  - 模型加载/切换
  - 鼠标与触摸交互
  - WebAudio 上下文初始化与口型驱动
  - 对外暴露的控制方法（供控制面板调用）
- `Live2DControls` 能力：
  - 动作/表情管理
  - 点击区域关联
  - 模型配置（眨眼、呼吸、眼神、缩放）
  - 背景上传与缓存
  - 预设保存、加载、导入、导出
- `useStreamingChat` + `useSubtitleFeed` 对应功能在 React 中等价。
- localStorage 数据兼容（原 key 与数据结构尽量不变）。

### 3.2 可延期等价（P1）

- `ChatInterface.vue`（当前主流程未实际依赖，可后置）。
- `useApi.js` 的 legacy 语音双 WS逻辑（建议隔离到 compatibility 包，默认不接入主流程）。

---

## 4. React 目标栈建议

推荐采用以下组合（兼顾迁移速度和长期维护）：

- React 18 + TypeScript
- Vite + `@vitejs/plugin-react`
- UI 组件：MUI（与 Vuetify 功能覆盖接近，迁移成本低于完全自建）
- 状态：优先 React hooks + Context，必要时补 Zustand
- 表单：React Hook Form（用于复杂配置表单，可选）
- 测试：Vitest + Testing Library + Playwright（补端到端）

不建议首轮迁移直接上 Next.js（SSR 对当前 Live2D/WebAudio 价值有限，反而增加复杂度）。

---

## 5. 架构迁移设计

### 5.1 目录建议

建议新增并行目录，避免一次性替换：

```text
front_end_react/
  src/
    app/
    components/
      live2d/
      subtitle/
      controls/
    hooks/
      useStreamingChat.ts
      useSubtitleFeed.ts
    services/
      streamClient.ts
    stores/
    types/
    utils/
```

通过并行目录迁移，确保 Vue 版本可随时对照回归。

### 5.2 核心映射关系

- `App.vue` -> `App.tsx`
- `composables/useStreamingChat.js` -> `hooks/useStreamingChat.ts`
- `composables/useSubtitleFeed.js` -> `hooks/useSubtitleFeed.ts`
- `components/SubtitleBar.vue` -> `components/subtitle/SubtitleBar.tsx`
- `components/Live2DViewer.vue` -> `components/live2d/Live2DViewer.tsx`
- `components/Live2DControls.vue` -> 拆分为多个 React 组件（见下节）

### 5.3 Live2DControls 拆分策略（必须拆分）

`Live2DControls.vue` 过大，不建议 1:1 翻译。建议至少拆为：

- `ModelSettingsPanel`（模型选择、缩放、眨眼、呼吸、眼神）
- `MotionPanel`（动作列表、文件关联、点击区域）
- `ExpressionPanel`（表情列表、文件关联、点击区域）
- `BackgroundPanel`（背景上传、缓存、透明度）
- `PresetPanel`（预设保存/加载/导入导出）
- `DebugPanel`（调试日志与测试入口）

并抽取独立 hooks：

- `useModelConfigStorage`
- `useMotionExpressionStorage`
- `useBackgroundCacheStorage`
- `usePresetStorage`

### 5.4 与 Live2DManager 的集成方式

保留 `src/live2d/utils/Live2DManager.js` 不动，先做 React 包装层：

- 使用 `useRef` 持有 canvas 与 manager 实例
- 使用 `useEffect` 处理初始化与销毁
- 通过 `forwardRef + useImperativeHandle` 暴露控制方法（等价 Vue 的 `defineExpose`）
- 在卸载时统一释放：
  - `requestAnimationFrame`
  - `AudioContext`
  - `blob:` URL
  - manager 内部资源

---

## 6. 迁移实施计划（建议 4 阶段）

## Phase 0：冻结契约与基线（1-2 天）

- 冻结后端契约：`/chat/stream`、SSE 事件格式、410 接口行为。
- 记录 Vue 基线手工验收清单（见第 10 节）。
- 补最小自动化冒烟（stream 成功/失败、模型加载）。

产出：
- 基线检查清单
- React 迁移分支初始化

## Phase 1：文本链路与舞台壳迁移（3-5 天）

- 完成 `App.tsx`、`useStreamingChat`、`useSubtitleFeed`、`SubtitleBar`。
- 打通文本输入 -> SSE -> 字幕展示。
- 先放入最小 Live2D viewer 壳，验证 canvas 可渲染。

验收：
- 可连续多轮文本流式对话
- 与现有网关联调通过

## Phase 2：Live2D 等价迁移（7-12 天）

- 完成 `Live2DViewer` React 版（含交互、音频上下文、口型测试）。
- 完成 `Live2DControls` 拆分迁移。
- 保留 localStorage key 与预设 JSON 结构兼容。

验收：
- 模型切换、动作/表情/点击区域、背景缓存、预设导入导出均可用

## Phase 3：回归、优化、切换（3-5 天）

- 补测试（组件、hook、e2e）
- 性能与内存巡检（重点: AudioContext 与 blob URL）
- 切换默认前端到 React，Vue 分支归档

验收：
- 功能等价签收
- 线上可观测指标无明显退化

---

## 7. 工作量评估

以“现有功能等价迁移”为目标，单人估算：

- 保守：15-24 个工作日
- 常见：18-28 个工作日（含联调与回归）

影响工时的关键变量：

- 是否拆分 `Live2DControls` 并补测试
- 是否要求 localStorage 历史数据 100% 兼容
- 是否并行处理 UI 样式重构

如果只做“文本 MVP + 简化 Live2D 展示”，可降到 5-10 个工作日。

---

## 8. 风险清单与规避策略

### 风险 1：Live2D 生命周期错配

表现：重复初始化、资源泄漏、渲染中断。  
规避：集中封装 `useLive2DManager`，统一 init/dispose；严格在 effect cleanup 释放资源。

### 风险 2：WebAudio 与浏览器交互策略差异

表现：未触发用户手势时无法播放音频/口型。  
规避：保留“首次交互解锁 audio context”流程，与 Vue 当前行为一致。

### 风险 3：配置数据不兼容

表现：旧用户本地预设加载失败。  
规避：保留 localStorage key；新增版本字段并做向后兼容迁移函数。

### 风险 4：大组件迁移导致缺陷密集

表现：`Live2DControls` 一次性迁移后难排错。  
规避：按子面板拆分，逐块替换并回归。

---

## 9. 建议的代码落地顺序

1. `hooks/useStreamingChat.ts` 与 `hooks/useSubtitleFeed.ts`
2. `App.tsx` + `SubtitleBar.tsx`
3. `Live2DViewer.tsx`（最小可渲染）
4. `Live2DControls` 子模块逐个迁移
5. localStorage 兼容层
6. e2e 冒烟与回归

---

## 10. 功能等价验收清单

## 10.1 文本链路

- 输入文本后 1 秒内开始收到 `text-delta`
- 流结束收到 `done`
- 上游错误时前端有可识别提示

## 10.2 Live2D 舞台

- 模型可加载、切换、重置
- 鼠标/触摸驱动视线或交互动作
- 口型测试可运行并可停止

## 10.3 控制面板

- 动作与表情可新增/删除/关联文件
- 点击区域关联可保存并生效
- 背景上传、透明度、缓存恢复正常
- 预设可保存、加载、导入、导出

## 10.4 兼容与稳定性

- 旧 localStorage 配置可读
- 页面反复进入退出无明显内存增长
- React 版本与 Vue 基线行为一致

---

## 11. 建议的迁移边界（避免范围失控）

本次迁移建议只更换前端框架，不在同一迭代中做以下事项：

- 后端协议重构
- 新语音链路设计
- Live2D 引擎重写
- 大规模视觉改版

这样可以把风险聚焦在“框架替换 + 功能等价”。

---

## 12. 里程碑建议（可直接用于排期）

- M1（第 1 周）：文本链路 React 版可用
- M2（第 2-3 周）：Live2D viewer 与控制面板主功能迁移完成
- M3（第 4 周）：回归完成，React 版可替换 Vue 版

如需压缩周期，可采用双人并行：一人负责 `Live2DViewer + manager wrapper`，一人负责 `Controls + storage + streaming`。
