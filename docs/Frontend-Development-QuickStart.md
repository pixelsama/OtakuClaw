# 前端开发快速开始指南

**版本**：v1.0
**日期**：2026-05-10
**基于文档**：
- `DeveloperB-Tasks-2026-05-10-v2.1.md`
- `灵山胜境AI数字人导览系统开发任务切片-2026-05-10-v2.1.md`

---

## 🎯 你的核心任务

作为前端开发者，你的**核心攻坚指标**是：
- **延迟 <5秒**（通过实时延迟仪表盘证明）
- 完成游客端和管理端的所有UI组件
- 确保界面美观、响应式适配良好

---

## 📂 Week 1 开发任务（第1周，7天）

### Day 1-2：实时延迟仪表盘 ⭐核心攻坚

#### 1. 创建组件目录

```bash
# 在项目根目录执行
cd front_end/src
mkdir -p components/scenic
mkdir -p hooks/scenic
mkdir -p services/scenic
```

#### 2. 安装必要的依赖

```bash
# 安装图表库（二选一）
npm install recharts
# 或
npm install echarts echarts-for-react

# 如果还没有安装Material-UI
npm install @mui/material @emotion/react @emotion/styled
```

#### 3. 创建LatencyMonitor组件

**文件路径**：`front_end/src/components/scenic/LatencyMonitor.jsx`

**完整代码**：

```jsx
import React, { useState, useEffect } from 'react';
import { Box, Typography, Grid, Paper } from '@mui/material';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer
} from 'recharts';

// 指标卡片组件
const MetricCard = ({ label, value, target, status }) => (
  <Paper
    sx={{
      p: 2,
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: status === 'success' ? '#e8f5e9' : status === 'warning' ? '#fff3e0' : '#f5f5f5',
      border: status === 'success' ? '2px solid #4caf50' : status === 'warning' ? '2px solid #ff9800' : '1px solid #e0e0e0',
      borderRadius: 2
    }}
  >
    <Typography variant="body2" color="textSecondary" gutterBottom>
      {label}
    </Typography>
    <Typography variant="h4" component="div" sx={{ fontWeight: 'bold' }}>
      {value}
    </Typography>
    <Typography variant="caption" color="textSecondary">
      目标: {target}
    </Typography>
  </Paper>
);

const LatencyMonitor = () => {
  const [latencyData, setLatencyData] = useState([]);
  const [avgLatency, setAvgLatency] = useState(0);
  const [firstSentenceLatency, setFirstSentenceLatency] = useState(0);
  const [maxLatency, setMaxLatency] = useState(0);
  const [within5sRate, setWithin5sRate] = useState(0);

  // Mock数据 - 后续��入真实数据
  useEffect(() => {
    const mockData = [
      { time: '10:00:00', asr: 0.6, rag: 0.3, llm: 0.7, tts: 0.4, complete: 2.0 },
      { time: '10:00:05', asr: 0.5, rag: 0.2, llm: 0.6, tts: 0.3, complete: 1.6 },
      { time: '10:00:10', asr: 0.7, rag: 0.3, llm: 0.8, tts: 0.5, complete: 2.3 },
      { time: '10:00:15', asr: 0.6, rag: 0.2, llm: 0.5, tts: 0.4, complete: 1.7 },
      { time: '10:00:20', asr: 0.5, rag: 0.3, llm: 0.7, tts: 0.3, complete: 1.8 },
    ];

    setLatencyData(mockData);
    setAvgLatency(1.8);
    setFirstSentenceLatency(1.2);
    setMaxLatency(2.3);
    setWithin5sRate(100);
  }, []);

  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h6" gutterBottom>
        实时问答延迟监控
      </Typography>

      {/* 延迟折线图 */}
      <Paper sx={{ p: 2, mb: 3, height: 300 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={latencyData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="time" />
            <YAxis />
            <Tooltip />
            <Legend />
            <Line type="monotone" dataKey="asr" stroke="#8884d8" name="ASR" />
            <Line type="monotone" dataKey="rag" stroke="#82ca9d" name="RAG" />
            <Line type="monotone" dataKey="llm" stroke="#ffc658" name="LLM首token" />
            <Line type="monotone" dataKey="tts" stroke="#ff7300" name="TTS首音" />
            <Line type="monotone" dataKey="complete" stroke="#000000" name="完整链路" strokeWidth={2} />
          </LineChart>
        </ResponsiveContainer>
      </Paper>

      {/* 核心指标 */}
      <Grid container spacing={2}>
        <Grid item xs={3}>
          <MetricCard
            label="平均延迟"
            value={`${avgLatency}s`}
            target="<5s"
            status={avgLatency < 5 ? 'success' : 'warning'}
          />
        </Grid>
        <Grid item xs={3}>
          <MetricCard
            label="首句延迟"
            value={`${firstSentenceLatency}s`}
            target="<2s"
            status={firstSentenceLatency < 2 ? 'success' : 'warning'}
          />
        </Grid>
        <Grid item xs={3}>
          <MetricCard
            label="最大延迟"
            value={`${maxLatency}s`}
            target="<5s"
            status={maxLatency < 5 ? 'success' : 'warning'}
          />
        </Grid>
        <Grid item xs={3}>
          <MetricCard
            label="目标达成率"
            value={`${within5sRate}%`}
            target=">95%"
            status={within5sRate >= 95 ? 'success' : 'warning'}
          />
        </Grid>
      </Grid>
    </Box>
  );
};

export default LatencyMonitor;
```

**验收标准**：
- [ ] 组件可以正常渲染
- [ ] 图表数据展示正常
- [ ] 延迟超标时显示红色警示

---

### Day 3-4：路线规划面板

**文件路径**：`front_end/src/components/scenic/RoutePlannerPanel.jsx`

**关键要点**：
- 使用Material-UI组件
- 表单状态管理（使用useState）
- 加载状态展示

**核心代码结构**：

```jsx
import React, { useState } from 'react';
import {
  Box, Typography, FormGroup, FormLabel, FormControlLabel,
  Checkbox, Button, ToggleButtonGroup, ToggleButton, CircularProgress
} from '@mui/material';

const RoutePlannerPanel = ({ onRouteGenerated }) => {
  // 状态管理
  const [interests, setInterests] = useState([]);
  const [duration, setDuration] = useState('2h');
  const [loading, setLoading] = useState(false);

  // 处理生成路线
  const handleGenerate = async () => {
    setLoading(true);
    try {
      // TODO: 调用IPC接口
      await new Promise(resolve => setTimeout(resolve, 1000));
      onRouteGenerated({ interests, duration });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h6" gutterBottom>路线规划</Typography>

      {/* 兴趣偏好 - Checkbox组 */}
      {/* 游览时长 - ToggleButton组 */}
      {/* 生成按钮 */}
      <Button variant="contained" onClick={handleGenerate} disabled={loading}>
        {loading ? <CircularProgress size={24} /> : '生成推荐路线'}
      </Button>
    </Box>
  );
};

export default RoutePlannerPanel;
```

**完整代码请参考任务清单文档**

---

### Day 5：集成到ScenicGuideShell

**文件路径**：`front_end/src/shells/ScenicGuideShell.jsx`

**你需要做的**：
1. 导入RoutePlannerPanel组件
2. 添加新的Tab标签页
3. 根据currentTab显示相应内容

**示例代码**：

```jsx
import RoutePlannerPanel from '../components/scenic/RoutePlannerPanel';

// 在组件中添加
const [currentTab, setCurrentTab] = useState('qa');

<Tabs value={currentTab} onChange={(e, newValue) => setCurrentTab(newValue)}>
  <Tab label="问答" value="qa" />
  <Tab label="路线推荐" value="route" />
  <Tab label="反馈" value="feedback" />
</Tabs>

{currentTab === 'route' && <RoutePlannerPanel />}
```

---

### Day 6-7：缓冲时间

- 样式优化
- 响应式适配（确保在不同屏幕尺寸下正常显示）
- 准备Mock数据

---

## 📂 Week 2 开发任务（第2周，7天）⭐关键周

### Day 8-9：数据分析面板

**文件路径**：`front_end/src/components/scenic/AnalyticsDashboard.jsx`

**关键组件**：
- StatCard（统计卡片）
- BarChart（柱状图 - 热门问题Top10）
- PieChart（饼图 - 游客画像）
- LineChart（折线图 - 满意度趋势）

**依赖安装**：
```bash
npm install recharts
```

---

### Day 10-11：数据大屏 ⭐核心攻坚

**文件路径**：`front_end/src/components/scenic/ScenicBigScreen.jsx`

**关键要求**：
- 1920x1080投影优化布局
- 深色主题
- 实时数据展示
- 官方数据完整度展示

**样式要点**：
```css
.big-screen-panel {
  background: linear-gradient(135deg, #1a237e 0%, #0d47a1 100%);
  color: white;
  height: 100%;
}
```

---

### Day 12-13：评测中心

**文件路径**：`front_end/src/components/scenic/EvalCenter.jsx`

**核心功能**：
- 运行评测按钮
- 进度条展示
- 结果展示（准确率、拒答率、来源完整率）
- 错题列表

---

### Day 14：集成与联调

**文件路径**：`front_end/src/shells/ScenicAdminShell.jsx`

**集成所有面板到管理端**

---

## 📂 Week 3 开发任务（第3周，7天）

### Day 15-16：前端UI联动展示 ⭐体验创新

**文件路径**：`front_end/src/components/scenic/UIMultimodalLinkage.jsx`

**核心功能**：
- 景点图片自动切换
- 地图路径动态绘制
- 延迟实时监控

---

### Day 17-18：数字人情感状态系统 ⭐体验创新

**文件路径**：
- `front_end/src/components/scenic/DigitalHumanState.jsx`
- `front_end/src/hooks/scenic/useDigitalHumanState.js`

**状态机设计**：
```javascript
const DIGITAL_HUMAN_STATES = {
  IDLE: { animation: 'breathing', expression: 'neutral' },
  LISTENING: { animation: 'nodding', expression: 'attentive' },
  THINKING: { animation: 'thinking', expression: 'focused' },
  SPEAKING: { animation: 'speaking', expression: 'dynamic', lipsync: true },
  GUIDING: { animation: 'pointing', expression: 'enthusiastic' },
  // ... 更多状态
};
```

---

### Day 19：满意度反馈

**文件路径**：`front_end/src/components/scenic/AnswerFeedback.jsx`

**核心功能**：
- 点赞/点踩按钮
- 快捷反馈（太长了、没听懂、不准确）

---

### Day 20：数字人状态桥接

**文件路径**：`front_end/src/hooks/scenic/useDigitalHumanState.js`

**核心功能**：
- 监听问答状态变化
- 触发状态切换
- 动画调度

---

## 📂 Week 4 开发任务（第4周，7天）

### Day 22-23：端到端集成测试

- 核心流程测试
- 界面测试（窄屏适配）
- 响应式布局验证

---

### Day 25：演示脚本编写

**文件路径**：`docs/scenic-demo/demo-script.md`

---

### Day 26：文档更新

更新README.md

---

### Day 27：答辩材料准备

- PPT制作
- 演示视频录制

---

### Day 28：最终验收

---

## 🔧 开发工具和技巧

### 1. IPC接口调用（与后端通信）

**创建Bridge服务**：

```javascript
// front_end/src/services/scenic/scenicGuideBridge.js

export const scenicGuideBridge = {
  async planRoute(preferences) {
    if (!window.desktopMode) {
      // Mock数据
      return mockRoutePlanningResult(preferences);
    }

    try {
      const result = await window.electron.ipcRenderer.invoke(
        'scenic-guide:plan-route',
        preferences
      );

      if (result?.ok) {
        return result.data;
      } else {
        throw new Error(result?.error?.message || 'API call failed');
      }
    } catch (error) {
      console.error('scenic-guide:plan-route failed:', error);
      throw error;
    }
  }
};
```

### 2. Mock数据策略

**创建Mock服务**：

```javascript
// front_end/src/services/scenic/scenicGuideMock.js

export const mockRoutePlanningResult = (preferences) => ({
  ok: true,
  routes: [
    {
      routeId: 'official-history-culture-6h',
      name: '历史文化爱好者路线',
      durationMinutes: 360,
      spots: ['LS-001', 'LS-002', 'LS-003'],
      recommendationReason: '✓ 您选择了"历史文化"兴趣偏好\n✓ 官方路线匹配度 92%'
    }
  ]
});
```

### 3. 组件开发最佳实践

**使用React Hooks**：
- useState: 状态管理
- useEffect: 副作用处理
- useCallback: 性能优化
- useMemo: 计算属性缓存

**Material-UI组件**：
- Box: 容器组件
- Grid: 网格布局
- Paper: 卡片容器
- Typography: 文本组件

**响应式设计**：
```jsx
<Grid container spacing={2}>
  <Grid item xs={12} md={6} lg={3}>
    {/* xs: 总宽度12（移动端） */}
    {/* md: 中等屏幕占6 */}
    {/* lg: 大屏幕占3 */}
  </Grid>
</Grid>
```

---

## 📊 每日检查清单

### 每天工作开始前

- [ ] 查看今天的任务（从DeveloperB-Tasks文档）
- [ ] 确认要修改的文件路径
- [ ] 准备必要的依赖包

### 每天工作结束后

- [ ] 提交代码到Git
- [ ] 更新任务进度
- [ ] 记录遇到的问题

### 每周五（Week结束检查点）

- [ ] 本周任务是否完成
- [ ] 组件是否可以正常运行
- [ ] 与开发者A对齐接口定义

---

## 🚨 常见问题和解决方案

### Q1: 组件导入错误

**问题**：`Cannot find module 'xxx'`

**解决**：
```bash
# 确保在front_end目录下
cd front_end
npm install xxx
```

### Q2: 样式不生效

**问题**：Material-UI组件样式不生效

**解决**：
```jsx
import { ThemeProvider, createTheme } from '@mui/material/styles';

const theme = createTheme({
  palette: {
    primary: {
      main: '#1976d2',
    },
  },
});

<ThemeProvider theme={theme}>
  <YourApp />
</ThemeProvider>
```

### Q3: 图表不显示

**问题**：Recharts图表不显示

**解决**：
- 确保传入的数据格式正确
- 检查dataKey是否匹配
- 确保容器有明确的高度

```jsx
<Paper sx={{ height: 300, width: '100%' }}>
  <ResponsiveContainer width="100%" height="100%">
    <LineChart data={data}>
      {/* ... */}
    </LineChart>
  </ResponsiveContainer>
</Paper>
```

---

## 📝 今日开始开发

### 第一步：创建目录并安装依赖

```bash
cd front_end/src
mkdir -p components/scenic
mkdir -p hooks/scenic
mkdir -p services/scenic

# 安装必要依赖
npm install recharts
```

### 第二步：创建第一个组件

创建 `front_end/src/components/scenic/LatencyMonitor.jsx`，使用上面提供的完整代码。

### 第三步：测试组件

在你的主要Shell组件中导入并测试：

```jsx
import LatencyMonitor from '../components/scenic/LatencyMonitor';

// 在适当位置使用
<LatencyMonitor />
```

---

## 🎯 核心提示

1. **只修改front_end目录**：不要修改desktop/electron目录
2. **接口先行**：与开发者A确认IPC接口后再实现
3. **Mock数据**：后端接口未就绪时使用Mock数据
4. **每日站会**：每天10:00-10:15与开发者A同步进度
5. **Git提交**：每天结束前提交代码

---

## 📞 需要帮助？

**遇到问题时**：
1. 查看任务清单文档：`docs/DeveloperB-Tasks-2026-05-10-v2.1.md`
2. 查看任务切片文档：`docs/灵山胜境AI数字人导览系统开发任务切片-2026-05-10-v2.1.md`
3. 在每日站会提出问题

---

**祝开发顺利！💪**
