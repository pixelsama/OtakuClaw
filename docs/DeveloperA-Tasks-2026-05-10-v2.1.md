# 开发者A：后端服务任务清单

**版本**：v2.1
**制定日期**：2026-05-10
**项目目标**：灵山胜境 AI 数字人导览系统 - 后端服务开发
**开发周期**：4 周 (28 天)
**核心攻坚**：准确率≥90%（多路召回RAG）

---

## 📋 你的角色

### 主要职责

- ✅ Electron 主进程服务开发
- ✅ 数据存储与检索
- ✅ 业务逻辑实现
- ✅ IPC 接口提供
- ✅ **核心攻坚**：准确率≥90%（多路召回RAG）

### 技术栈

- Node.js / Electron
- 数据存储 (JSON/SQLite)
- 文档解析 (DOCX/XLSX)
- 算法实现 (RAG/推荐)

### 工作目录（你只需要修改这些目录）

```
desktop/electron/
├── services/
│   └── scenicGuide/
│       ├── interactionLogStore.js      ← 你需要创建
│       ├── multiRecallRag.js            ← 你需要创建
│       ├── visitorAnalyticsService.js   ← 你需要创建
│       ├── routePlannerService.js       ← 你需要创建
│       ├── scenicEvalService.js         ← 你需要创建
│       └── scenicGuidePrompt.js         ← 你需要优化
├── ipc/
│   └── scenicGuide.js                   ← 你需要添加接口
└── services/
    └── voice/
        └── streamingTtsService.js       ← 你需要创建
```

### ⚠️ 不要修改的目录

```
front_end/                              ← 开发者B的目录，不要修改
docs/                                   ← 文档目录
```

---

## 🎯 4周开发计划

### Week 1：P0基础服务 + RAG优化（Day 1-7）

**目标**：完成交互日志、行为分析，优化RAG准确率

---

#### Day 1-2：InteractionLogStore

**文件**：`desktop/electron/services/scenicGuide/interactionLogStore.js`

**任务**：实现交互日志存储服务

**数据结构**：
```javascript
class InteractionLogStore {
  // 保存单次问答日志
  saveLog(logData) {
    // logData: {
    //   timestamp, inputType, question, intent,
    //   sources: [{ blockId, title, excerpt, file, spotId }],
    //   answer, latency: {asr, rag, llmFirstToken, llmComplete, ttsFirstAudio, complete},
    //   rating, emotion, unmatched
    // }
  }

  // 查询日志（支持分页和筛选）
  queryLogs(filters) {
    // filters: { startTime, endTime, unmatched, rating, intent }
  }

  // 获取统计数据
  getStatistics(timeRange) {
    return { hotQuestions, hotSpots, satisfaction, hitRate, avgLatency };
  }
}
```

**验收标准**：
- [ ] 可记录完整问答链路
- [ ] 每条回答必须携带`sourceRefs`，禁止幻觉编造
- [ ] 延迟数据可结构化存储（ASR/RAG/LLM/TTS各环节）

**预计工时**：1天

---

#### Day 3-4：多路召回RAG优化 ⭐核心攻坚

**文件**：`desktop/electron/services/scenicGuide/multiRecallRag.js`

**任务**：实现多路召回RAG，确保准确率≥90%

**核心代码**：
```javascript
class MultiRecallRAG {
  // 关键词检索
  async keywordSearch(query) {
    // 基于 ScenicSearchIndex
    // 优先匹配景点名、关键词
  }

  // 语义检索
  async semanticSearch(query) {
    // 基于向量相似度（可选，如有向量数据库）
  }

  // 点位ID精确匹配
  async spotIdMatch(query) {
    // 匹配 LS-001, NH-001 等点位ID
    // 最高优先级
  }

  // 意图识别分流
  async intentClassify(query) {
    // 景点事实类 vs 路线推荐类 vs 实用信息类
    // 不同意图使用不同召回策略
  }

  // 多路召回合并排序
  async search(query) {
    const results = await Promise.all([
      this.keywordSearch(query),
      this.semanticSearch(query),
      this.spotIdMatch(query)
    ]);

    return this.mergeAndRank(results);
  }
}
```

**验收标准**：
- [ ] 关键词检索可命中景点名
- [ ] 点位ID精确匹配优先级最高
- [ ] 意图识别可区分三类问题
- [ ] 来源强制追溯，每个回答携带`sourceRefs`

**预计工时**：2天

---

#### Day 5：IPC 接口暴露

**文件**：`desktop/electron/ipc/scenicGuide.js`

**任务**：将上述服务暴露到IPC

**接口定义**：
```javascript
// 交互日志接口
ipcMain.handle('scenic-guide:get-interaction-logs', async (_event, filters) => {
  try {
    const logs = await interactionLogStore.queryLogs(filters);
    return { ok: true, data: logs };
  } catch (error) {
    return { ok: false, error: { code: 'service_error', message: error.message } };
  }
});

ipcMain.handle('scenic-guide:get-analytics-dashboard', async (_event, timeRange) => {
  try {
    const data = await visitorAnalyticsService.getDashboardData(timeRange);
    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: { code: 'service_error', message: error.message } };
  }
});

// 多路召回RAG接口
ipcMain.handle('scenic-guide:multi-recall-search', async (_event, query) => {
  try {
    const results = await multiRecallRag.search(query);
    return { ok: true, data: results };
  } catch (error) {
    return { ok: false, error: { code: 'service_error', message: error.message } };
  }
});
```

**验收标准**：
- [ ] 所有接口都有参数验证
- [ ] 所有接口都有错误处理
- [ ] 返回值统一格式（{ok, data/error}）

**预计工时**：0.5天

---

#### Day 6-7：缓冲时间

- 代码优化
- 单元测试编写
- 与开发者B对齐接口

---

### Week 1 检查点 ✅

**交付物**：
- [ ] `interactionLogStore.js` - 交互日志存储
- [ ] `multiRecallRag.js` - 多路召回RAG
- [ ] `visitorAnalyticsService.js` - 行为分析服务
- [ ] IPC 接口更新

**集成验证**：
- [ ] 管理端可查看统计数据（可用Mock数据）
- [ ] 与开发者B对齐接口定义

---

### Week 2：P0核心功能（Day 8-14）⭐关键周

**目标**：完成路线推荐、评测中心

---

#### Day 8-9：RoutePlannerService

**文件**：`desktop/electron/services/scenicGuide/routePlannerService.js`

**任务**：实现路线推荐算法

**核心代码**：
```javascript
class RoutePlannerService {
  // 根据偏好生成路线推荐
  async planRoute(preferences) {
    const { interests, duration, crowd, stamina, specialNeeds } = preferences;

    // 1. 匹配官方路线
    const officialRoutes = await this.matchOfficialRoutes(interests);

    // 2. 按人群排序
    const rankedRoutes = this.rankByCrowd(officialRoutes, crowd);

    // 3. 时长裁剪
    const route = duration < this.getOfficialDuration(rankedRoutes[0])
      ? this.trimRoute(rankedRoutes[0], duration)
      : rankedRoutes[0];

    // 4. 生成推荐理由（可解释性）
    route.reason = this.generateReason(route, preferences);

    return route;
  }

  // 匹配官方路线
  async matchOfficialRoutes(interests) {
    const routeMap = {
      '历史文化': '历史文化爱好者路线',
      '自然风光': '自然风光爱好者路线',
      '亲子': '亲子家庭路线'
    };

    return interests
      .map(i => routeMap[i])
      .filter(Boolean)
      .map(name => this.loadOfficialRoute(name));
  }

  // 生成推荐理由（可解释性）
  generateReason(route, preferences) {
    const reasons = [];

    if (preferences.interests.includes('历史文化')) {
      reasons.push(`✓ 您选择了"历史文化"兴趣偏好`);
      reasons.push(`✓ 官方"历史文化爱好者路线"与您偏好匹配度 92%`);
    }

    if (route.duration <= 120) {
      reasons.push(`✓ 适合两小时快速游览`);
    }

    if (preferences.crowd === 'family') {
      reasons.push(`✓ 该路线包含亲子互动点位`);
    }

    reasons.push(`✓ 适合上午9点开始，避开人流高峰`);

    return reasons.join('\n');
  }
}
```

**验收标准**：
- [ ] 历史文化偏好匹配历史文化路线
- [ ] 2小时路线说明裁剪来源
- [ ] 推荐理由可解释（✓格式列表）

**预计工时**：2天

---

#### Day 10-12：ScenicEvalService + 100题编写 ⭐核心攻坚

**文件**：
- `desktop/electron/services/scenicGuide/scenicEvalService.js`
- `docs/scenic-demo/eval/lingshan-questions.json`

**任务**：实现评测服务 + 编写100题

**评测服务**：
```javascript
class ScenicEvalService {
  // 运行评测
  async runEvaluation(questionSet) {
    const results = [];

    for (const q of questionSet) {
      const start = Date.now();
      const answer = await scenicRagService.askQuestion({ question: q.question });
      const end = Date.now();

      results.push({
        id: q.id,
        question: q.question,
        category: q.category,
        expected: q.expected,
        prohibited: q.prohibited,
        actual: answer.answer,
        sources: answer.sources,
        latency: end - start,
        hit: this.checkHit(answer, q.expected),
        noHitAllowed: q.noHitAllowed,
        noHitCorrect: answer.status === 'no_hit',
        hasProhibited: this.checkProhibited(answer, q.prohibited)
      });
    }

    return this.generateReport(results);
  }

  // 生成报告
  generateReport(results) {
    return {
      totalAccuracy: this.calculateAccuracy(results),
      noHitRefusalRate: this.calculateNoHitRefusal(results),
      sourceCompleteness: this.calculateSourceCompleteness(results),
      latency: this.calculateLatency(results),
      categoryAccuracy: this.calculateByCategory(results),
      wrongAnswers: results.filter(r => !r.hit)
    };
  }
}
```

**100题编写**：
```json
{
  "meta": {
    "version": "v1.0",
    "total": 100,
    "targetAccuracy": "≥90%"
  },
  "questions": [
    {
      "id": "LS-001-01",
      "question": "灵山大佛有什么特色？",
      "category": "点位事实",
      "expected": ["88米", "青铜", "佛体", "莲花座"],
      "prohibited": ["99米", "黄金"],
      "source": "LS-001",
      "difficulty": "easy",
      "noHitAllowed": false
    }
    // ... 共100题
  ]
}
```

**题集分布**：
- 灵山胜境点位事实：30题
- 拈花湾点位事实：12题
- 历史文化与景点讲解：23题
- 官方路线推荐：15题
- 门票与贴士：10题
- 未收录和边界问题：10题

**验收标准**：
- [ ] 可运行100题评测
- [ ] 总准确率 ≥90%
- [ ] 未命中拒答率 ≥95%
- [ ] 来源完整率 ≥95%

**预计工时**：3天

---

#### Day 13-14：IPC 暴露与联调

**文件**：`desktop/electron/ipc/scenicGuide.js`

**新增接口**：
```javascript
ipcMain.handle('scenic-guide:plan-route', async (_event, preferences) => {
  try {
    const routes = await routePlannerService.planRoute(preferences);
    return { ok: true, data: routes };
  } catch (error) {
    return { ok: false, error: { code: 'service_error', message: error.message } };
  }
});

ipcMain.handle('scenic-guide:run-evaluation', async (_event, questionSet) => {
  try {
    const report = await scenicEvalService.runEvaluation(questionSet);
    return { ok: true, data: report };
  } catch (error) {
    return { ok: false, error: { code: 'service_error', message: error.message } };
  }
});

ipcMain.handle('scenic-guide:get-evaluation-report', async (_event, evalId) => {
  try {
    const report = await scenicEvalService.getReport(evalId);
    return { ok: true, data: report };
  } catch (error) {
    return { ok: false, error: { code: 'service_error', message: error.message } };
  }
});
```

**验收标准**：
- [ ] 所有接口都有参数验证
- [ ] 所有接口都有错误处理
- [ ] 与前端联调成功

**预计工时**：1天

---

### Week 2 检查点 ✅ ⭐关键里程碑

**交付物**：
- [ ] `routePlannerService.js` - 路线规划服务
- [ ] `scenicEvalService.js` - 评测服务
- [ ] 100题评测集 JSON 文件
- [ ] IPC 接口更新

**集成验证**：
- [ ] ✅ 游客端可进行路线推荐（真实数据）
- [ ] ✅ 评测中心可运行评测（真实数据）
- [ ] ✅ 评测准确率 ≥90%（评测中心证明）
- [ ] ✅ 核心演示流程可跑通

---

### Week 3：P1完善功能（Day 15-21）

**目标**：流式TTS集成、Prompt优化

---

#### Day 15-17：流式TTS集成 ⭐核心攻坚

**文件**：`desktop/electron/services/voice/streamingTtsService.js`

**任务**：实现流式TTS，确保延迟<5秒

**核心代码**：
```javascript
class StreamingTTSService {
  constructor() {
    this.audioQueue = [];
    this.isPlaying = false;
  }

  // 处理流式回答
  async processStreamingAnswer(llmStream, onAudioReady) {
    let sentenceBuffer = '';

    for await (const chunk of llmStream) {
      sentenceBuffer += chunk.text;

      // 断句检测
      const sentences = this.extractCompleteSentences(sentenceBuffer);

      for (const sentence of sentences) {
        // 立即触发TTS合成
        const audio = await this.tts.synthesize(sentence);
        this.audioQueue.push(audio);

        // 立即播放第一段音频
        if (!this.isPlaying) {
          this.isPlaying = true;
          onAudioReady(audio); // 通知前端播放
        }
      }

      sentenceBuffer = sentences[sentences.length - 1]?.remainder || '';
    }
  }

  // 断句检测
  extractCompleteSentences(text) {
    // 按句号/问号/感叹号切分
    const sentences = [];
    const regex = /[^。！？.!?]*[。！？.!?]/g;
    let match;

    while ((match = regex.exec(text)) !== null) {
      sentences.push(match[0]);
    }

    return sentences;
  }
}
```

**验收标准**：
- [ ] LLM吐出首句立即触发TTS
- [ ] TTS合成出第一段音频立即播放
- [ ] 数字人口型同步
- [ ] 完整链路<5秒

**预计工时**：3天

---

#### Day 18：导游 Prompt 优化

**文件**：`desktop/electron/services/scenicGuide/scenicGuidePrompt.js`

**任务**：优化导游回答质量

**Prompt模板**：
```javascript
const SCENIC_GUIDE_PROMPT = `
你是灵山胜境的AI导游，负责为游客提供专业、准确的景区讲解。

## 核心原则
1. 所有回答必须基于官方提供的资料，严禁编造
2. 未收录的信息应明确告知，不可猜测
3. 回答简洁明了，适合语音播报
4. 对佛教文化保持尊重、庄重的语气

## 回答策略
### 景点讲解
- 先介绍核心特色（1-2句）
- 再补充背景信息
- 最后给出游览建议

### 路线推荐
- 说明推荐理由（✓格式列表）
- 列出游览顺序
- 标注每个点位的预计时间
- 说明来源（官方路线名称）

### 未命中处理
- 标准回复："官方资料中暂未收录此信息，建议以景区当日公告或游客中心答复为准。"
- 记录问题供后续补充

## 情感表达
- 讲述佛教文化：使用恭敬、庄重的语气
- 讲述自然风光：使用轻松、愉快的语气
- 讲述建筑艺术：使用专业、严谨的语气
- 未命中/道歉：使用歉意、诚恳的语气
`;
```

**验收标准**：
- [ ] 回答更简洁
- [ ] 来源说明更清晰
- [ ] 情感表达更准确

**预计工时**：1天

---

#### Day 19：性能优化

**任务**：优化检索延迟

- [ ] RAG检索缓存
- [ ] 索引预热
- [ ] 延迟监控完善

**预计工时**：1天

---

#### Day 20-21：缓冲时间

- 代码重构
- Bug 修复
- 与前端联调

---

### Week 3 检查点 ✅

**交付物**：
- [ ] `streamingTtsService.js` - 流式TTS服务
- [ ] 优化的导游 Prompt
- [ ] 性能优化完成

**集成验证**：
- [ ] 流式TTS首句延迟 <2秒
- [ ] 完整链路延迟 <5秒

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

**性能测试**：
- [ ] 连续 20 轮文本问答
- [ ] 连续 10 轮语音问答
- [ ] 首句延迟 < 2秒
- [ ] 完整问答 < 5秒

**准确率测试**：
- [ ] 评测准确率 > 90%
- [ ] 未命中拒答率 > 95%
- [ ] 来源完整率 > 95%

**Bug 修复**：
- [ ] 记录并修复所有阻塞问题

**预计工时**：1-2天

---

#### Day 24：演示数据准备

- [ ] 准备官方资料包
- [ ] 准备演示问答脚本
- [ ] 准备演示路线数据
- [ ] 清理演示日志

**预计工时**：0.5天

---

#### Day 25-27：打包与部署

- [ ] 单元测试补充：为新增服务编写测试
- [ ] Electron 打包配置优化
- [ ] 安装包制作
- [ ] 演示机器部署测试

**预计工时**：1.5天

---

#### Day 28：最终验收

**功能完整性验收**：
- [ ] 所有 P0 功能完成
- [ ] 90% 以上 P1 功能完成

**性能指标验收**：
- [ ] 准确率 ≥90%（评测中心证明）
- [ ] 延迟 <5秒（仪表盘证明）

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

### 接口定义规范

在实现服务之前，先与开发者B确认IPC接口定义：

```javascript
// 接口模板
ipcMain.handle('scenic-guide:your-api-name', async (_event, request = {}) => {
  try {
    // 1. 参数验证
    if (!request.requiredParam) {
      return {
        ok: false,
        error: {
          code: 'invalid_params',
          message: 'Missing required parameter: requiredParam'
        }
      };
    }

    // 2. 调用服务
    const result = await yourService.yourMethod(request);

    // 3. 返回结果
    return {
      ok: true,
      data: result
    };
  } catch (error) {
    // 4. 错误处理
    return {
      ok: false,
      error: {
        code: error.code || 'service_error',
        message: error.message || 'Operation failed'
      }
    };
  }
});
```

### 代码审查清单

提交代码前自查：
- [ ] IPC 接口参数验证完整
- [ ] 错误处理覆盖所有分支
- [ ] 数据存储考虑并发安全
- [ ] 服务代码有单元测试
- [ ] 准确率验证（评测中心）

---

## 🎯 核心攻坚指标

### 准确率攻坚：≥90%

**负责人**：你（开发者 A）

**攻坚周**：Week 1-2

**关键任务**：
- Day 3-4: 多路召回RAG优化
- Day 10-12: ScenicEvalService + 100题编写

**验证方式**：评测中心运行100题，显示准确率报告

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
