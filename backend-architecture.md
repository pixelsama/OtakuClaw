# Free-Agent-Vtuber 后端架构图

## 整体架构概览

```mermaid
graph TB
    %% 外部接口层
    subgraph "外部接口"
        WebClient[Web 客户端]
        API[API 调用]
    end

    %% 网关层
    subgraph "API 网关层"
        Gateway[Gateway Service<br/>FastAPI + Flask<br/>:8000]
    end

    %% 输入输出处理层
    subgraph "输入输出处理层"
        InputHandler[Input Handler<br/>WebSocket Server<br/>:8001]
        OutputHandler[Output Handler<br/>WebSocket Server<br/>:8002]
    end

    %% 核心服务层
    subgraph "核心处理服务"
        ASR[ASR Service<br/>语音识别<br/>OpenAI Whisper]
        Memory[Memory Service<br/>短期记忆管理<br/>对话上下文]
        ChatAI[Chat AI Service<br/>AI 对话生成<br/>OpenAI GPT]
        TTS[TTS Service<br/>语音合成<br/>Edge-TTS]
        LTM[Long Term Memory<br/>长期记忆<br/>向量搜索]
    end

    %% 消息总线
    subgraph "消息总线"
        Redis[(Redis<br/>事件驱动消息总线<br/>:6379)]
    end

    %% 数据存储层
    subgraph "数据存储"
        PostgreSQL[(PostgreSQL<br/>pgvector<br/>:5432)]
        MemoryData[(Memory Data<br/>对话历史)]
        TempFiles[(Temp Files<br/>音频文件)]
    end

    %% 管理层
    subgraph "管理与监控"
        Manager[Manager Service<br/>Flask Web UI<br/>:5000]
    end

    %% 连接关系
    WebClient --> Gateway
    API --> Gateway

    Gateway --> InputHandler
    Gateway --> OutputHandler
    Gateway --> Redis

    InputHandler --> Redis
    OutputHandler --> Redis

    ASR --> Redis
    Memory --> Redis
    ChatAI --> Redis
    TTS --> Redis
    LTM --> Redis

    Memory --> MemoryData
    LTM --> PostgreSQL
    TTS --> TempFiles
    ASR --> TempFiles

    Manager --> Redis
    Manager -.-> ASR
    Manager -.-> Memory
    Manager -.-> ChatAI
    Manager -.-> TTS
    Manager -.-> LTM

    %% 样式
    classDef service fill:#e1f5fe,stroke:#0277bd,stroke-width:2px
    classDef storage fill:#f3e5f5,stroke:#7b1fa2,stroke-width:2px
    classDef message fill:#fff3e0,stroke:#ef6c00,stroke-width:2px
    classDef external fill:#e8f5e8,stroke:#2e7d32,stroke-width:2px

    class Gateway,InputHandler,OutputHandler,ASR,Memory,ChatAI,TTS,LTM,Manager service
    class PostgreSQL,MemoryData,TempFiles storage
    class Redis message
    class WebClient,API external
```

## 消息流架构详图

```mermaid
sequenceDiagram
    participant Client as 客户端
    participant GW as Gateway
    participant IH as Input Handler
    participant ASR as ASR Service
    participant MEM as Memory Service
    participant AI as Chat AI Service
    participant LTM as Long Term Memory
    participant TTS as TTS Service
    participant OH as Output Handler
    participant Redis as Redis Bus

    Note over Client,Redis: 完整的语音交互流程

    %% 1. 语音输入阶段
    Client->>GW: POST /api/asr (音频文件)
    GW->>Redis: LPUSH asr_tasks
    Redis->>ASR: 消费 asr_tasks
    ASR-->>Redis: PUBLISH asr_results

    %% 2. 输入处理阶段
    Redis->>IH: 订阅 asr_results
    IH->>Redis: LPUSH user_input_queue

    %% 3. 记忆处理阶段
    Redis->>MEM: 消费 user_input_queue
    MEM-->>Redis: PUBLISH memory_updates

    %% 4. AI对话阶段
    Redis->>AI: 订阅 memory_updates

    %% 5. 长期记忆查询（可选）
    alt 启用长期记忆
        AI->>Redis: LPUSH ltm_requests
        Redis->>LTM: 消费 ltm_requests
        LTM-->>Redis: PUBLISH ltm_responses
        Redis->>AI: 订阅 ltm_responses
    end

    %% 6. AI响应生成
    AI-->>Redis: PUBLISH ai_responses
    AI->>Redis: LPUSH tts_requests

    %% 7. 语音合成阶段
    Redis->>TTS: 消费 tts_requests
    TTS-->>Redis: PUBLISH task_response:task_id

    %% 8. 输出处理阶段
    Redis->>OH: 订阅 task_response:*
    OH->>GW: WebSocket 推送
    GW->>Client: 返回合成语音
```

## 核心服务详细说明

### 1. Gateway Service (网关服务)
- **技术栈**: FastAPI + Flask Blueprint
- **端口**: 8000
- **职责**:
  - 提供统一的API入口
  - 处理HTTP请求和WebSocket连接
  - 路由ASR请求到消息队列
  - 管理客户端连接状态

### 2. Input Handler (输入处理服务)
- **技术栈**: Python + WebSocket
- **端口**: 8001
- **职责**:
  - 订阅ASR识别结果
  - 标准化用户输入格式
  - 将处理后的输入推送到用户输入队列

### 3. ASR Service (语音识别服务)
- **技术栈**: Python + OpenAI Whisper
- **职责**:
  - 消费语音识别任务队列
  - 将音频文件转换为文本
  - 发布识别结果到消息总线

### 4. Memory Service (记忆管理服务)
- **技术栈**: Python
- **职责**:
  - 管理对话上下文和短期记忆
  - 维护用户会话状态
  - 为AI服务提供对话历史

### 5. Chat AI Service (AI对话服务)
- **技术栈**: Python + OpenAI GPT
- **职责**:
  - 生成AI回复
  - 整合长期记忆内容（如果启用）
  - 触发语音合成请求

### 6. Long Term Memory Service (长期记忆服务)
- **技术栈**: Python + pgvector + mem0
- **职责**:
  - 存储和检索长期记忆
  - 向量相似度搜索
  - 为对话提供相关历史信息

### 7. TTS Service (语音合成服务)
- **技术栈**: Python + Edge-TTS
- **职责**:
  - 将文本转换为语音
  - 生成音频文件
  - 发布合成结果

### 8. Output Handler (输出处理服务)
- **技术栈**: Python + WebSocket
- **端口**: 8002
- **职责**:
  - 处理服务输出
  - 通过WebSocket推送结果到客户端

## 数据存储架构

### Redis 消息总线
- **队列 (List)**:
  - `asr_tasks`: ASR识别任务
  - `user_input_queue`: 用户输入队列
  - `tts_requests`: TTS合成请求
  - `ltm_requests`: 长期记忆查询请求

- **发布/订阅 (Pub/Sub)**:
  - `asr_results`: ASR识别结果
  - `memory_updates`: 记忆更新通知
  - `ai_responses`: AI回复
  - `ltm_responses`: 长期记忆查询结果
  - `task_response:{task_id}`: 任务响应

### PostgreSQL + pgvector
- 存储长期记忆向量数据
- 支持语义相似度搜索
- 维护用户历史对话记录

### 文件存储
- 临时音频文件存储 (`/tmp/aivtuber_tasks`)
- 内存数据持久化 (`memory_data`)
- 长期记忆数据 (`ltm_data`)

## 架构特点

1. **事件驱动**: 基于Redis的消息总线实现松耦合
2. **微服务**: 每个功能模块独立部署和扩展
3. **异步处理**: 支持并发处理多个用户请求
4. **可插拔**: 支持不同的AI、TTS、ASR提供商
5. **容器化**: 所有服务均支持Docker部署
6. **可观测**: 完整的日志和监控体系

## 部署架构

```mermaid
graph TB
    subgraph "Docker Network: aivtuber-network"
        subgraph "计算服务"
            GW[gateway:8000]
            IH[input-handler:8001]
            OH[output-handler:8002]
            ASR[asr]
            MEM[memory]
            AI[chat-ai]
            TTS[tts]
            LTM[long-term-memory]
        end

        subgraph "基础设施"
            Redis[redis:6379]
            PG[postgres:5432]
        end

        subgraph "存储卷"
            RedisData[redis_data]
            PostgresData[postgres_data]
            MemoryData[memory_data]
            LTMData[ltm_data]
            TempFiles[temp_files]
        end
    end

    subgraph "外部"
        Client[客户端]
        Manager[Manager:5000<br/>可选管理界面]
    end

    Client --> GW
    Manager -.-> GW

    Redis --- RedisData
    PG --- PostgresData
    MEM --- MemoryData
    LTM --- LTMData
    TTS --- TempFiles
    ASR --- TempFiles
    OH --- TempFiles
```

这个架构设计实现了高度模块化、可扩展的AI虚拟主播系统，通过事件驱动的方式确保了系统的松耦合和高可用性。