# 开发者B：前端界面任务清单

**版本**：v2.1
**制定日期**：2026-05-10
**项目目标**：灵山胜境 AI 数字人导览系统 - 前端界面开发
**开发周期**：4 周 (28 天)
**核心攻坚**：延迟<5秒（实时延迟仪表盘）

---

## 📋 你的角色

### 主要职责

- ✅ React 组件开发
- ✅ 用户界面实现
- ✅ 交互逻辑编写
- ✅ 数据可视化
- ✅ **核心攻坚**：延迟<5秒（实时延迟仪表盘）

### 技术栈

- React / Material-UI
- ECharts/Recharts (图表)
- CSS / 样式
- Live2D 集成

### 工作目录（你只需要修改这些目录）

```
front_end/src/
├── components/
│   └── scenic/
│       ├── LatencyMonitor.jsx              ← 你需要创建
│       ├── RoutePlannerPanel.jsx           ← 你需要创建
│       ├── RouteResultCard.jsx             ← 你需要创建
│       ├── AnalyticsDashboard.jsx          ← 你需要创建
│       ├── ScenicBigScreen.jsx             ← 你需要创建
│       ├── EvalCenter.jsx                  ← 你需要创建
│       ├── UIMultimodalLinkage.jsx         ← 你需要创建
│       ├── DigitalHumanState.jsx           ← 你需要创建
│       └── AnswerFeedback.jsx              ← 你需要创建
├── shells/
│   ├── ScenicGuideShell.jsx                ← 你需要修改
│   └── ScenicAdminShell.jsx                ← 你需要修改
└── hooks/
    └── scenic/
        └── useDigitalHumanState.js         ← 你需要创建
```

### ⚠️ 不要修改的目录

```
desktop/electron/                          ← 开发者A的目录，不要修改
docs/                                      ← 文档目录
```

---

## 🎯 4周开发计划

### Week 1：P0基础服务 + RAG优化（Day 1-7）

**目标**：完成实时延迟仪表盘、路线规划面板

---

#### Day 1-2：实时延迟仪表盘 ⭐核心攻坚

**文件**：`front_end/src/components/scenic/LatencyMonitor.jsx`

**任务**：实现实时延迟仪表盘，证明延迟<5秒

**核心代码**：
```jsx
<Box className="latency-monitor">
  <Typography variant="h6">实时问答延迟监控</Typography>

  {/* 延迟折线图 */}
  <LineChart
    data={latencyHistory}
    xAxis="time"
    yAxis="latency_ms"
    series={[
      { name: 'ASR', data: asrLatency },
      { name: 'RAG', data: ragLatency },
      { name: 'LLM首token', data: llmLatency },
      { name: 'TTS首音', data: ttsLatency },
      { name: '完整链路', data: completeLatency }
    ]}
  />

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
      />
    </Grid>
    <Grid item xs={3}>
      <MetricCard
        label="目标达成率"
        value={`${within5sRate}%`}
        target=">95%"
      />
    </Grid>
  </Grid>
</Box>
```

**验收标准**：
- [ ] 每个环节延迟可视化
- [ ] 延迟超标红色警示
- [ ] 证明<5秒达标

**预计工时**：2天

---

#### Day 3-4：RoutePlannerPanel（偏好选择）

**文件**：`front_end/src/components/scenic/RoutePlannerPanel.jsx`

**任务**：实现路线规划面板

**核心代码**：
```jsx
<FormGroup>
  <FormLabel>兴趣偏好</FormLabel>
  <FormGroup row>
    <FormControlLabel control={<Checkbox />} label="历史文化" />
    <FormControlLabel control={<Checkbox />} label="自然风光" />
    <FormControlLabel control={<Checkbox />} label="亲子互动" />
    <FormControlLabel control={<Checkbox />} label="拍照打卡" />
    <FormControlLabel control={<Checkbox />} label="轻松休闲" />
  </FormGroup>

  <FormLabel>游览时长</FormLabel>
  <ToggleButtonGroup>
    <ToggleButton value="1h">1小时</ToggleButton>
    <ToggleButton value="2h">2小时</ToggleButton>
    <ToggleButton value="half">半日</ToggleButton>
    <ToggleButton value="full">一日</ToggleButton>
  </ToggleButtonGroup>

  <FormLabel>同行人群</FormLabel>
  <ToggleButtonGroup>
    <ToggleButton value="solo">个人</ToggleButton>
    <ToggleButton value="couple">情侣</ToggleButton>
    <ToggleButton value="family">亲子</ToggleButton>
    <ToggleButton value="elderly">老人</ToggleButton>
    <ToggleButton value="team">研学团队</ToggleButton>
  </ToggleButtonGroup>

  <FormLabel>体力偏好</FormLabel>
  <ToggleButtonGroup>
    <ToggleButton value="easy">轻松</ToggleButton>
    <ToggleButton value="moderate">适中</ToggleButton>
    <ToggleButton value="intensive">充实</ToggleButton>
  </ToggleButtonGroup>

  <FormLabel>特殊需求</FormLabel>
  <FormGroup row>
    <FormControlLabel control={<Checkbox />} label="无障碍" />
    <FormControlLabel control={<Checkbox />} label="雨天" />
    <FormControlLabel control={<Checkbox />} label="少排队" />
    <FormControlLabel control={<Checkbox />} label="餐饮优先" />
  </FormGroup>

  <Button variant="contained" onClick={handleGenerate}>
    生成推荐路线
  </Button>
</FormGroup>
```

**验收标准**：
- [ ] 偏好选项完整
- [ ] 表单验证正确
- [ ] 加载状态可见

**预计工时**：2天

---

#### Day 5：集成到ScenicGuideShell

**文件**：`front_end/src/shells/ScenicGuideShell.jsx`

**任务**：新增"路线推荐"标签页

**核心代码**：
```jsx
// 新增标签页
<Tabs value={currentTab} onChange={handleTabChange}>
  <Tab label="问答" value="qa" />
  <Tab label="路线推荐" value="route" />
  <Tab label="反馈" value="feedback" />
</Tabs>

{/* 路线推荐内容 */}
{currentTab === 'route' && (
  <RoutePlannerPanel
    onRouteGenerated={handleRouteGenerated}
  />
)}
```

**验收标准**：
- [ ] 标签页切换流畅
- [ ] 路线面板弹出/收起动画

**预计工时**：0.5天

---

#### Day 6-7：缓冲时间

- 样式优化
- 响应式适配
- Mock 数据准备

---

### Week 1 检查点 ✅

**交付物**：
- [ ] `LatencyMonitor.jsx` - 实时延迟仪表盘
- [ ] `RoutePlannerPanel.jsx` - 路线规划面板
- [ ] `RouteResultCard.jsx` - 路线结果卡片

**集成验证**：
- [ ] 实时延迟仪表盘可展示（可用Mock数据）
- [ ] 路线规划面板可展示（可用Mock数据）
- [ ] 与开发者A对齐接口定义

---

### Week 2：P0核心功能（Day 8-14）⭐关键周

**目标**：完成数据大屏、评测中心

---

#### Day 8-9：AnalyticsDashboard（管理页分析视图）

**文件**：`front_end/src/components/scenic/AnalyticsDashboard.jsx`

**任务**：实现管理端数据面板

**核心代码**：
```jsx
<Grid container spacing={2}>
  {/* 核心指标卡片 */}
  <Grid item xs={3}>
    <StatCard title="今日服务人次" value={1,247} icon={<People />} />
  </Grid>
  <Grid item xs={3}>
    <StatCard title="语音问答次数" value={856} icon={<Mic />} />
  </Grid>
  <Grid item xs={3}>
    <StatCard title="满意度" value="4.6/5" icon={<Star />} />
  </Grid>
  <Grid item xs={3}>
    <StatCard title="知识库命中率" value="87.5%" icon={<CheckCircle />} />
  </Grid>

  {/* ECharts图表 */}
  <Grid item xs={6}>
    <BarChart title="热门问题Top10" data={hotQuestions} />
  </Grid>
  <Grid item xs={6}>
    <PieChart title="游客画像（基于14万+行为数据）" data={visitorPortrait} />
  </Grid>
  <Grid item xs={12}>
    <LineChart title="满意度趋势" data={satisfactionTrend} />
  </Grid>
</Grid>
```

**图表库集成**：
- 安装依赖：`npm install echarts echarts-for-react` 或 `npm install recharts`
- 封装图表组件

**验收标准**：
- [ ] 至少显示6个核心指标
- [ ] 图表不出现空白
- [ ] 指标口径有说明

**预计工时**：2天

---

#### Day 10-11：ScenicBigScreen（投影大屏）⭐核心攻坚

**文件**：`front_end/src/components/scenic/ScenicBigScreen.jsx`

**任务**：实现数据大屏

**核心代码**：
```jsx
<Box className="scenic-big-screen" sx={{ width: 1920, height: 1080 }}>
  {/* 头部 */}
  <Typography variant="h2">
    灵山胜境AI数字人导览系统 - 实时运营监控大屏
  </Typography>

  <Grid container spacing={2}>
    {/* 左侧：服务统计 */}
    <Grid item xs={3}>
      <Paper className="big-screen-panel">
        <Typography variant="h4">今日服务</Typography>
        <Typography variant="h1">1,247人次</Typography>
        <Divider />
        <Typography>语音问答：856次</Typography>
        <Typography>路线推荐：124次</Typography>
      </Paper>
    </Grid>

    {/* 中间：延迟监控 */}
    <Grid item xs={6}>
      <Paper className="big-screen-panel">
        <Typography variant="h4">实时问答延迟监控</Typography>
        <LineChart data={latencyHistory} />
        <Typography>
          平均: 1.8s | 最大: 4.2s | 目标: &lt;5s
        </Typography>
      </Paper>
    </Grid>

    {/* 右侧：游客画像 */}
    <Grid item xs={3}>
      <Paper className="big-screen-panel">
        <Typography variant="h4">游客画像分布</Typography>
        <RadarChart data={visitorPortrait} />
        <Typography>消费结构：票务58% | 餐饮25% | 购物12%</Typography>
      </Paper>
    </Grid>

    {/* 底部：核心指标 */}
    <Grid item xs={12}>
      <Box className="big-screen-metrics">
        <MetricCard label="官方点位" value="22个✅" />
        <MetricCard label="行为记录" value="14万+✅" />
        <MetricCard label="评测准确率" value="92.3%✅" />
        <MetricCard label="满意度" value="4.6/5" />
      </Box>
    </Grid>
  </Grid>
</Box>
```

**验收标准**：
- [ ] 1920x1080投影优化
- [ ] 展示官方数据完整度
- [ ] 实时延迟监控证明<5秒
- [ ] 游客画像基于14万+行为数据

**预计工时**：2天

---

#### Day 12-13：EvalCenter（评测中心）

**文件**：`front_end/src/components/scenic/EvalCenter.jsx`

**任务**：实现评测中心

**核心代码**：
```jsx
<Box>
  <Box className="eval-controls">
    <Button variant="contained" onClick={handleRunEval}>
      运行评测（100题）
    </Button>
    <Button onClick={handleExportReport}>导出报告</Button>
  </Box>

  {/* 进度 */}
  {evaluating && (
    <LinearProgress variant="determinate" value={progress} />
  )}

  {/* 结果 */}
  <Box className="eval-results">
    <Grid container spacing={2}>
      <Grid item xs={3}>
        <ResultCard label="总准确率" value="92.3%" status="success" />
      </Grid>
      <Grid item xs={3}>
        <ResultCard label="未命中拒答率" value="96.7%" status="success" />
      </Grid>
      <Grid item xs={3}>
        <ResultCard label="来源完整率" value="98.0%" status="success" />
      </Grid>
      <Grid item xs={3}>
        <ResultCard label="平均延迟" value="2.0s" status="success" />
      </Grid>
    </Grid>

    {/* 分类准确率表格 */}
    <Table>
      <TableHead>
        <TableRow>
          <TableCell>类别</TableCell>
          <TableCell align="right">准确率</TableCell>
          <TableCell align="right">通过/总数</TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        <TableRow>
          <TableCell>点位事实</TableCell>
          <TableCell align="right">93.3%</TableCell>
          <TableCell align="right">28/30</TableCell>
        </TableRow>
        {/* ... */}
      </TableBody>
    </Table>

    {/* 错题列表 */}
    <Box className="wrong-answers">
      <Typography variant="h6">错题分析</Typography>
      <List>
        <ListItem>
          <ListItemText
            primary="灵山梵宫的建筑风格是什么？"
            secondary="回答不完整 | 原因：知识块分割过细"
          />
        </ListItem>
      </List>
    </Box>
  </Box>
</Box>
```

**验收标准**：
- [ ] 可运行100题评测
- [ ] 显示总准确率 ≥90%
- [ ] 显示未命中拒答率 ≥95%
- [ ] 显示来源完整率 ≥95%
- [ ] 显示延迟报告
- [ ] 错题分析列表

**预计工时**：1.5天

---

#### Day 14：集成与联调

**任务**：所有面板集成到ScenicAdminShell

**文件**：`front_end/src/shells/ScenicAdminShell.jsx`

**核心代码**：
```jsx
<Tabs value={currentTab} onChange={handleTabChange}>
  <Tab label="数据源导入" value="import" />
  <Tab label="数据分析" value="analytics" />
  <Tab label="数据大屏" value="bigscreen" />
  <Tab label="评测中心" value="eval" />
</Tabs>

{/* 数据分析 */}
{currentTab === 'analytics' && <AnalyticsDashboard />}

{/* 数据大屏 */}
{currentTab === 'bigscreen' && <ScenicBigScreen />}

{/* 评测中心 */}
{currentTab === 'eval' && <EvalCenter />}
```

**验收标准**：
- [ ] 所有面板集成成功
- [ ] 后端数据接入正常
- [ ] 样式统一

**预计工时**：0.5天

---

### Week 2 检查点 ✅ ⭐关键里程碑

**交付物**：
- [ ] `AnalyticsDashboard.jsx` - 数据分析面板
- [ ] `ScenicBigScreen.jsx` - 数据大屏
- [ ] `EvalCenter.jsx` - 评测中心
- [ ] 所有面板集成到管理端

**集成验证**：
- [ ] ✅ 管理端可查看数据大屏（真实数据）
- [ ] ✅ 评测中心可运行评测（真实数据）
- [ ] ✅ 核心演示流程可跑通

---

### Week 3：P1完善功能（Day 15-21）

**目标**：前端UI联动、数字人情感状态

---

#### Day 15-16：前端UI联动展示 ⭐体验创新

**文件**：`front_end/src/components/scenic/UIMultimodalLinkage.jsx`

**任务**：实现前端UI联动展示

**核心代码**：
```jsx
<Box className="multimodal-linkage">
  {/* 数字人讲解员 */}
  <Box className="digital-human-section">
    <Live2DViewer
      modelFile={modelFile}
      motion={currentMotion}
      expression={currentExpression}
    />
    <Typography variant="h6">灵山胜境 AI 导游</Typography>
  </Box>

  {/* 景点图片联动展示 */}
  <Box className="spot-image-section">
    <Typography variant="subtitle1">📸 景点图片联动展示</Typography>
    {matchedSpot && (
      <>
        <img src={matchedSpot.imageUrl} alt={matchedSpot.name} />
        <Typography variant="caption">
          匹配度: {matchedSpot.confidence}%
        </Typography>
        <Chip label={`来源: ${matchedSpot.source}`} size="small" />
      </>
    )}
  </Box>

  {/* 地图位置标记 */}
  <Box className="map-section">
    <Typography variant="subtitle1">📍 地图位置标记</Typography>
    <ScenicMap currentSpot={matchedSpot} />
  </Box>

  {/* 实时延迟仪表盘 */}
  <Box className="latency-section">
    <LatencyMonitor data={currentLatency} />
  </Box>
</Box>
```

**验收标准**：
- [ ] 景点图片自动切换
- [ ] 地图路径动态绘制
- [ ] 延迟实时监控

**预计工时**：2天

---

#### Day 17-18：数字人情感状态系统 ⭐体验创新

**文件**：
- `front_end/src/components/scenic/DigitalHumanState.jsx`
- `front_end/src/hooks/scenic/useDigitalHumanState.js`

**任务**：实现数字人情感状态系统

**状态机设计**：
```jsx
// 状态机设计
const DIGITAL_HUMAN_STATES = {
  IDLE: {           // 空闲
    animation: 'breathing',
    expression: 'neutral',
    label: '待机'
  },
  LISTENING: {      // 聆听中
    animation: 'nodding',
    expression: 'attentive',
    label: '聆听中'
  },
  THINKING: {       // 思考中
    animation: 'thinking',
    expression: 'focused',
    label: '思考中'
  },
  SPEAKING: {       // 讲解中
    animation: 'speaking',
    expression: 'dynamic', // 根据内容情感调整
    lipsync: true,
    label: '讲解中'
  },
  GUIDING: {        // 推荐路线
    animation: 'pointing',
    expression: 'enthusiastic',
    label: '推荐路线'
  },
  APOLOGIZING: {    // 道歉
    animation: 'bowing',
    expression: 'regretful',
    label: '抱歉'
  },
  HAPPY: {          // 开心（收到好评）
    animation: 'celebrating',
    expression: 'joyful',
    label: '开心'
  },
  SOLEMN: {         // 恭敬庄重（讲述佛教文化）
    animation: 'respectful',
    expression: 'solemn',
    label: '恭敬'
  },
  CHEERFUL: {       // 愉快轻松（讲述自然风光）
    animation: 'relaxed',
    expression: 'cheerful',
    label: '愉快'
  }
};

// 情感检测逻辑
function detectEmotionFromAnswer(answer, sources) {
  // 检测是否讲述佛教文化/历史典故
  if (hasCulturalContent(answer)) {
    return 'SOLEMN';
  }

  // 检测是否讲述自然风光/拍照点
  if (hasScenicContent(answer)) {
    return 'CHEERFUL';
  }

  // 检测是否推荐路线
  if (hasRouteContent(answer)) {
    return 'GUIDING';
  }

  return 'SPEAKING';
}
```

**验收标准**：
- [ ] TTS前后状态可切换
- [ ] 情感根据回答内容自动调整
- [ ] 无模型时页面仍可演示问答

**预计工时**：2天

---

#### Day 19：AnswerFeedback

**文件**：`front_end/src/components/scenic/AnswerFeedback.jsx`

**任务**：实现满意度反馈组件

**核心代码**：
```jsx
<Box className="answer-feedback">
  <Typography variant="caption">这个回答有帮助吗？</Typography>
  <Box className="feedback-actions">
    <IconButton onClick={() => handleRate('up')}>
      <ThumbUpIcon color={rating === 'up' ? 'primary' : 'disabled'} />
    </IconButton>
    <IconButton onClick={() => handleRate('down')}>
      <ThumbDownIcon color={rating === 'down' ? 'error' : 'disabled'} />
    </IconButton>
  </Box>

  {/* 快捷反馈 */}
  {rating === 'down' && (
    <Box className="feedback-reasons">
      <Chip label="太长了" onClick={() => handleReason('too_long')} />
      <Chip label="没听懂" onClick={() => handleReason('unclear')} />
      <Chip label="不准确" onClick={() => handleReason('inaccurate')} />
    </Box>
  )}
</Box>
```

**验收标准**：
- [ ] 点赞点踩功能正常
- [ ] 快捷反馈选择正常
- [ ] 评价数据保存正常

**预计工时**：1天

---

#### Day 20：数字人状态桥接

**文件**：`front_end/src/hooks/scenic/useDigitalHumanState.js`

**任务**：实现数字人状态桥接

**核心代码**：
```jsx
export function useDigitalHumanState() {
  const [state, setState] = useState('IDLE');

  useEffect(() => {
    // 监听问答状态变化
    const handleQuestionStart = () => setState('LISTENING');
    const handleRagStart = () => setState('THINKING');
    const handleTtsStart = () => setState('SPEAKING');
    const handleTtsEnd = () => setState('IDLE');
    const handleRouteShow = () => setState('GUIDING');
    const handleNoHit = () => setState('APOLOGIZING');
    const handlePositiveRating = () => {
      setState('HAPPY');
      setTimeout(() => setState('IDLE'), 2000);
    };

    // 注册事件监听
    // ...

    return () => {
      // 清理监听
    };
  }, []);

  return DIGITAL_HUMAN_STATES[state];
}
```

**验收标准**：
- [ ] 状态切换流畅
- [ ] 事件监听正确

**预计工时**：0.5天

---

#### Day 21：缓冲时间

- 样式统一
- 响应式优化
- 与后端联调

---

### Week 3 检查点 ✅

**交付物**：
- [ ] `UIMultimodalLinkage.jsx` - 前端UI联动
- [ ] `DigitalHumanState.jsx` - 数字人情感状态
- [ ] `AnswerFeedback.jsx` - 满意度反馈
- [ ] `useDigitalHumanState.js` - 数字人状态Hook

**集成验证**：
- [ ] 前端UI联动可展示
- [ ] 数字人有情感状态表现
- [ ] 满意度反馈功能正常

---

### Week 4：集成测试与交付（Day 22-28）

---

#### Day 22-23：端到端集成测试

**核心流程测试**：
- [ ] 官方资料导入
- [ ] 游客文本问答
- [ ] 游客语音问答
- [ ] 路线推荐
- [ ] 满意度反馈
- [ ] 管理端知识库管理
- [ ] 数据大屏查看
- [ ] 评测中心运行

**界面测试**：
- [ ] 窄屏下不出现重叠
- [ ] 响应式布局正常
- [ ] 所有按钮可点击

**预计工时**：1-2天

---

#### Day 25：演示脚本编写

**文件**：`docs/scenic-demo/demo-script.md`

**任务**：编写10分钟演示流程

**内容**：
```
1. 打开应用 (30秒)
   ├─ 启动进入"灵山胜境 AI 导游"游客端
   └─ 展示数字人和欢迎界面

2. 核心攻坚指标展示 (30秒)
   ├─ 切换到评测中心
   ├─ 运行100条评测题
   └─ 展示准确率92.3% ✅

3. 延迟攻坚展示 (30秒)
   ├─ 切换到实时延迟仪表盘
   ├─ 展示延迟折线图
   └─ 证明平均延迟1.8s ✅

...（详细演示流程）
```

**预计工时**：0.5天

---

#### Day 26：文档更新

**文件**：`README.md`

**任务**：更新项目说明文档

**内容**：
- 项目定位改为景区导览系统
- 功能截图
- 快速开始指南
- 演示说明

**预计工时**：0.5天

---

#### Day 27：答辩材料准备

**任务**：准备PPT、视频等

**内容**：
- PPT制作
- 演示视频录制
- 答辩话术准备

**预计工时**：1天

---

#### Day 28：最终验收

**功能完整性验收**：
- [ ] 所有 P0 功能完成
- [ ] 90% 以上 P1 功能完成

**界面验收**：
- [ ] 游客端界面专业美观
- [ ] 管理端功能完整
- [ ] 数据大屏视觉冲击力强

**演示效果验收**：
- [ ] 核心演示流程无阻塞性 bug

---

## 📅 每日站会（重要）

**时间**：每天 10:00-10:15
**参与者**：开发者 A、开发者 B

**议程**：
1. 昨天完成了什么？
2. 今天计划做什么？
3. 遇到什么阻塞？
4. 需要对方配合什么？

---

## 🤝 协作要点

### IPC接口调用规范

调用后端接口的标准方式：

```javascript
// front_end/src/services/scenicGuideBridge.js

async callYourApiName(request) {
  if (!this.desktopMode) {
    // Web fallback 或 Mock
    return mockYourApiResult(request);
  }

  try {
    const result = await ipcRenderer.invoke('scenic-guide:your-api-name', request);
    if (result?.ok) {
      return result.data;
    } else {
      throw new Error(result?.error?.message || 'API call failed');
    }
  } catch (error) {
    console.error('scenic-guide:your-api-name failed:', error);
    throw error;
  }
}
```

### Mock数据策略

后端接口未就绪时，使用Mock数据：

```javascript
// front_end/src/services/scenicGuideMock.js
export const mockRoutePlanningResult = {
  ok: true,
  routes: [
    {
      routeId: 'official-history-culture-6h',
      name: '历史文化爱好者路线',
      durationMinutes: 360,
      spots: [...],
      recommendationReason: '...'
    }
  ]
};
```

### 代码审查清单

提交代码前自查：
- [ ] 组件 props 定义清晰
- [ ] 错误状态有友好提示
- [ ] 响应式布局适配不同尺寸
- [ ] 避免硬编码数据
- [ ] 延迟仪表盘显示正确

---

## 🎯 核心攻坚指标

### 延迟攻坚：<5秒

**负责人**：你（开发者 B）

**攻坚周**：Week 3

**关键任务**：
- Day 1-2: 实时延迟仪表盘
- Day 15-16: 前端UI联动展示
- Day 15-17: 流式TTS集成（与开发者A配合）

**验证方式**：实时延迟仪表盘显示各环节延迟，证明<5秒

---

## 📞 联系与支持

**遇到无法解决的问题时**：
1. 先记录问题和复现步骤
2. 尝试查找相关文档
3. 在每日站会提出
4. 必要时调整任务优先级

---

**最后更新**：2026-05-10
**版本**：v2.1

祝你开发顺利！🎉
