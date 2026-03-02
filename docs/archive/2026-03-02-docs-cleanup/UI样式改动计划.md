# UI样式改动计划

## 前端 UI 改造计划 – Free‑Agent‑Vtuber

> 说明：为贴近原始内容，我仅做了最小清理：去除 PDF 页码/噪点、修复断行导致的代码块破损、去重重复链接；正文措辞未做改写。

### 背景与目标

**现状：** Free‑Agent‑Vtuber 项目的前端使用 Vue + Vuetify。`App.vue` 文件将页面拆成左右两栏：左侧是一套聊天界面（由 `ChatInterface.vue` 实现）和输入控件，右侧为 Live2D 模型展示。聊天界面使用 `v‑list` 显示消息并提供录音/文字输入；Live2D 区域通过 `Live2DViewer.vue` 渲染模型并播放音频。用户的需求是去掉左侧的聊天界面和输入框，让 Live2D 模型全屏显示，并把后端返回的文本作为字幕显示在页面底部。现有前端通过 WebSocket 与 `output‑handler` 通信，只能在 `receivedText` 中接收完整回复，并没有直接对接后端流式输出，因而缺乏原生字幕流式显示功能。

**目标：** 重新布局前端，使 Live2D 模型占满页面，所有 AI 回复以字幕形式在底部滚动显示。字幕需要利用后端原生的流式输出（基于 SSE 的 `text‑delta` 事件）实时呈现，而不是在拿到完整文本后再人工拆分字符。

### 当前架构分析

**布局：** `App.vue` 使用 `<v‑row>` 将页面分为 `md‑4`（左侧）和 `md‑8`（右侧）两列。左侧包含工具栏、聊天区域和可切换的配置面板；右侧包含 Live2D 模型展示容器。聊天室消息由 `ChatInterface.vue` 渲染，输入框使用 `v‑text‑field` 和麦克风按钮等。该布局不适合全屏 Live2D。

**数据流：** `useApi.js` 负责通过 WebSocket 与后端通信，`receivedText` 存储 AI 返回的文本。`ChatInterface.vue` 通过 `watch` 监听 `receivedText` 并将整个字符串添加到消息列表。没有逐字符流式处理逻辑。

**后端流式输出支持：** 后端 `dialog‑engine` 提供基于 FastAPI `StreamingResponse` 的流式接口 `/chat/stream` 和 `/chat/audio/stream`。`stream_reply` 会分多次产生回复片段，SSE 每次发送事件 `text‑delta`，包含 `{"content": delta, "eos": False}`，客户端可在收到每个片段时实时处理。最终以 `done` 事件结束，携带统计信息。现在 API Gateway 已经在自身域下代理了这两个接口（`POST /chat/stream`、`POST /chat/audio/stream`），前端可以在同源下直接请求，无需再手动绕过中间层或与 `dialog‑engine` 域通信。`input‑handler` 仍然可以使用完整文本接口，而前端字幕则基于 Gateway 暴露的流式端点实时获取片段。

**Live2D 模型：** `Live2DViewer.vue` 提供 `playAudioWithLipSync` 方法，将文本语音与模型口型匹配播放；`App.vue` 在 `watch(receivedAudioUrl)` 时调用该方法。该部分可以保留。

---

## 改造方案

### 1. 布局调整

**删除 ChatInterface：**  
在 `App.vue` 的模板中移除 `<ChatInterface>` 的导入和使用；删除左侧 `v‑col`（`md‑4`）布局，将页面改为单列。移除与 `drawer` 相关的导航栏和聊天区域，只保留顶部工具栏或根据需求精简；或者把工具栏集成到 Live2D 全屏布局内。

**全屏 Live2D：**  
在模板中仅保留 `<Live2DViewer>` 容器，设置容器 `width: 100%`、`height: 100vh`（通过 CSS 确保占满可视区域）；考虑使用 `position: relative` 以便在底部放置字幕层。删除左右两列的 `<v‑col>` 布局；改为 `<v‑container fluid class="pa‑0 fill‑height">` 包含一个 `<div class="live2d‑wrapper">` 用来渲染模型。

**示例调整（伪代码）**

```html
<!-- App.vue 模板片段 (仅示意) -->
<v-app>
  <v-main class="fill-height">
    <div class="live2d-wrapper">
      <Live2DViewer ref="live2dViewer" class="full-screen" />
    </div>
    <SubtitleBar :text="subtitleText" />
  </v-main>
</v-app>
```

```css
/* CSS 修改 */
.fill-height { height: 100vh; }
.live2d-wrapper { position: relative; width: 100%; height: 100%; overflow: hidden; }
.full-screen { width: 100%; height: 100%; }
```

### 2. 新增字幕组件

为了在底部显示 AI 文本并实时展示流式片段，需要创建一个单独的 `SubtitleBar.vue` 组件。由于后端已提供 SSE 流式回复，我们不再使用 `setInterval` 人工拆分文本，而是让父组件在接收到每个 `text‑delta` 事件时直接追加字幕内容。`SubtitleBar` 只负责展示当前累积文本和控制显示/隐藏。

#### 2.1 组件结构

```vue
<template>
  <div class="subtitle-container" v-show="visible">
    <span class="subtitle-text">{{ text }}</span>
  </div>
</template>

<script setup>
import { ref, watch } from 'vue';

// 接收父组件传入的累积字幕文本。
const props = defineProps({ text: { type: String, default: '' } });

const visible = ref(false);

// 在字幕变化时显示字幕，并在结束后隐藏。
let hideTimer: ReturnType<typeof setTimeout> | null = null;
watch(() => props.text, (newVal) => {
  if (newVal) {
    visible.value = true;
    // 重新计时隐藏，防止字幕瞬间消失
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(() => { visible.value = false; }, 5000);
  }
});
</script>

<style scoped>
.subtitle-container {
  position: absolute;
  bottom: 0;
  width: 100%;
  padding: 12px 24px;
  background: rgba(0,0,0,0.5);
  color: white;
  font-size: 1.2rem;
  text-align: center;
  pointer-events: none; /* 避免拦截鼠标事件 */
}
.subtitle-text {
  word-break: break-word;
}
</style>
```

> `SubtitleBar` 不再内部控制流式输出，而是接收父组件累积的 `text`。父组件在每个 `text‑delta` 事件到来时更新文本；该组件负责显示，并在 **5 秒** 无更新后自动隐藏字幕。

### 3. `App.vue` 修改

- **引入与注册组件：** 在 `<script setup>` 中导入 `SubtitleBar` 和新的流式聊天逻辑：

  ```ts
  import SubtitleBar from './components/SubtitleBar.vue';
  import { useStreamingChat } from './composables/useStreamingChat';
  ```

- **定义字幕内容与流式连接：** 创建响应式变量 `subtitleText`，并使用自定义组合函数 `useStreamingChat` 管理 SSE 连接。当用户发送文本时，调用 `startStreaming(sessionId, content)` 发起流式聊天；在每个 `text‑delta` 事件到来时，组合函数更新 `subtitleText`。

  ```ts
  const subtitleText = ref('');

  const { startStreaming, onDelta, onDone } = useStreamingChat();

  // 在组件初始化时注册事件处理器
  onDelta((delta) => {
    // 每个文本增量到来时追加到字幕
    subtitleText.value += delta;
  });
  onDone(() => {
    // 可以在结束时执行额外逻辑，如记录日志
  });

  // 发送用户文本并启动流
  function sendUserText(content: string) {
    subtitleText.value = '';
    startStreaming('default', content); // sessionId 可按实际情况传递
  }
  ```

- **组合函数 `useStreamingChat`：** 内部使用 `EventSource` 或 `fetch` + `ReadableStream` 连接 Gateway 暴露的 `/chat/stream`（必要时切换到 `/chat/audio/stream`），解析 `text‑delta` 和 `done` 事件，并暴露注册回调的方法。这样前端就可以直接利用后端原生流式输出，同时保持与 Gateway 的同源部署。

- **布局中添加字幕组件：** 在模板中添加 `<SubtitleBar :text="subtitleText" />`，并在发送消息按钮或其他触发点调用 `sendUserText`。

- **删除聊天相关逻辑：** 去掉 `ChatInterface` 引用与导入；移除左侧布局。删除与用户输入相关的方法（如 `sendTextInput`）的绑定；流式聊天函数负责向后端发送请求。

- **保留设置面板（可选）：** 如果仍需在全屏模式下调整 Live2D 模型参数，可以在工具栏添加一个按钮，在点击后以弹窗方式打开 `Live2DControls.vue`，避免占用页面面积。

### 4. 其他前端逻辑调整

- **音频播放：** 保持现有 `watch(receivedAudioUrl)` 逻辑，检测到新音频 URL 时调用 `playAudioWithLipSync(null, newUrl)`。当使用流式 SSE 连接时，可根据需要延迟播放音频直到 `done` 事件；也可以在 `text‑delta` 过程中边生成语音边播放，需要配合后端开启 TTS 流式功能。

- **响应式高度：** 为了避免不同分辨率下字幕覆盖模型，可以在 CSS 中给 `subtitle‑container` 设置 `max‑height` 并允许文本自动换行。注意使用 `pointer‑events: none` 保证用户可以拖动模型或打开控制面板。

- **国际化或多行字幕：** 如未来需要支持多语言或分段文本，可以将字幕文本拆分为句子依次播放；也可以在 `SubtitleBar` 内添加逻辑控制多行滚动。通过流式 SSE 接收事件，可实时传入不同语种的文本片段。

- **兼容性：** 确保新增 CSS 使用前缀适配 Safari/移动端；测试在 Chromium、Firefox 和移动浏览器中显示正常。

### 5. 实施步骤与任务拆分

- **需求澄清与设计评审（1 天）：**
  - 与产品/设计沟通确认字幕样式、文字大小、出现速度、隐藏时机等细节。
  - 评审 UI 样式图并确认是否需要保留配置面板。

- **前端开发（2 天）：**
  - 删除 `ChatInterface` 相关引用和布局。
  - 新建 `SubtitleBar.vue` 组件，实现简单的显示/隐藏逻辑。
  - 新建 `useStreamingChat.js`（或 `useStreamingChat.ts`）组合函数，封装 `EventSource` 连接 `/chat/stream`，支持注册 `onDelta`、`onDone` 回调。
  - 修改 `App.vue` 布局，使 Live2D 全屏，并集成字幕组件；添加发送用户文本并调用 `startStreaming` 的逻辑。
  - 调整样式，使字幕在不同屏幕大小下可读且不遮挡模型。

- **联调测试（1 天）：**
  - 配合后端，使用 `dialog‑engine` 原生流式接口验证字幕实时更新效果；测试长文本、短文本及连续多条消息的处理。
  - 检查 Live2D 互动、音频播放与字幕显示的同步性。

- **代码审查与合并（0.5 天）：**
  - 提交 MR/PR，代码风格遵循项目规范。
  - 通过 CI 构建、Lint 与单元测试。

- **UAT 与上线（0.5 天）：**
  - 在开发环境或预发布环境进行用户验收测试；收集反馈后微调字幕样式。
  - 上线后监控异常与性能。

---

## 总结

通过以上改造，Free‑Agent‑Vtuber 的前端界面将从左右分栏布局转为以 Live2D 模型为主体的全屏展示，并在底部显示 AI 回复的字幕。新建的 `SubtitleBar` 组件负责将文本流式呈现，替代传统的聊天列表，提供更加沉浸的直播观看体验。

