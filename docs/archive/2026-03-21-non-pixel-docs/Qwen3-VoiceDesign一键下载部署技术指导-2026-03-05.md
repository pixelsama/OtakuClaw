# Qwen3 VoiceDesign 一键下载与部署技术指导（macOS / Electron）

日期：2026-03-05  
适用范围：`Free-Agent-Vtuber-Openclaw` 桌面端语音栈（`voiceModelLibrary` + Python runtime）

## 1. 目标

为后续实现“Qwen3 VoiceDesign 模型 + Python 运行时依赖一键下载安装”提供可直接落地的技术方案，覆盖：

1. 模型下载与断点续传
2. Python 运行时与依赖安装
3. 版本兼容校验与健康检查
4. 失败重试、回滚与错误可观测
5. 与现有 `voiceModelLibrary` 的集成路径

## 2. 本次实测结论（必须固化到方案）

### 2.1 模型可用性

- 模型：`mlx-community/Qwen3-TTS-12Hz-1.7B-VoiceDesign-bf16`
- 在 Apple Silicon macOS 上可成功下载并推理。
- 支持 `instruct`（Voice Design 文本提示词）生成。

### 2.2 关键兼容性结论

- `mlx-audio==0.2.10` 无法加载该模型（配置结构与权重映射不兼容）。
- 升级到 `mlx-audio>=0.3.2` 后可正常运行，CLI 出现 `--instruct` 参数。

建议最低版本约束：

- `mlx-audio >= 0.3.2`
- `mlx-lm >= 0.30.5`
- `huggingface-hub >= 1.5.0`

### 2.3 下载层实测结论

- `model.safetensors` 体积约 `3,833,402,589` bytes（约 3.57GiB）。
- `snapshot_download` 在默认并发/传输通道下可能触发 CAS/Xet 限流错误（`no permits available`）。
- 采用“关闭高并发传输 + 单 worker”后下载稳定。

建议默认下载环境：

- `HF_HUB_DISABLE_XET=1`
- `HF_HUB_ENABLE_HF_TRANSFER=0`
- `snapshot_download(..., max_workers=1)`

### 2.4 推理性能实测（本机）

测试文本：`今天的天气不错，我们一起去公园散步吧。`

- 输出采样率：`24kHz`
- 输出时长：`2.64s ~ 2.88s`
- 推理处理时长：`~5.2s`（模型已就绪）
- CLI 单次总时长（含加载）：`~10s ~ 11s`
- 峰值内存：`~6.3GB`

注：首轮下载后仍会补拉 `snac_24khz` 辅助文件。

## 3. 一键安装总体设计

### 3.1 设计原则

1. 幂等：重复点击安装不得污染状态。
2. 可恢复：中断后可续传，不重复全量下载。
3. 可观测：每个阶段有进度、速率、剩余时间、错误码。
4. 可回滚：失败自动清理临时目录，不污染“已安装”列表。
5. 可验收：安装完成必须跑健康检查（最小推理）再入库。

### 3.2 生命周期状态机

统一使用以下阶段（供 UI、日志、状态存储复用）：

1. `preflight`
2. `download-runtime`
3. `extract-runtime`
4. `install-pip`
5. `download-model`
6. `warmup-check`
7. `register-bundle`
8. `completed`
9. `failed`

## 4. 与现有实现的集成点

当前代码基础（已存在）：

- `desktop/electron/services/voice/voiceModelCatalog.js`
- `desktop/electron/services/voice/voiceModelLibrary.js`
- `desktop/electron/services/voice/providers/python/bootstrap_runtime.py`

建议新增模型目录项（catalog）字段：

1. `runtime.ttsEngine`: `qwen3-mlx`
2. `runtime.mlxAudioVersion`: `>=0.3.2`
3. `runtime.mlxModelId`: `mlx-community/Qwen3-TTS-12Hz-1.7B-VoiceDesign-bf16`
4. `runtime.mlxSnacModelId`: `mlx-community/snac_24khz`
5. `runtime.hfDownloadProfile`: `stable-single-worker`

建议 bundle `runtime` 记录扩展字段：

1. `ttsEngine`
2. `pythonPackagesLock`（安装时实际版本）
3. `modelManifest`（下载文件摘要与大小）
4. `healthCheck`（最后一次健康检查结果）

## 5. 下载与安装实现建议

### 5.1 Preflight（安装前检查）

必须检查：

1. 平台：仅允许 `darwin-arm64`（首版）
2. 可用磁盘：建议最小 `12GiB`（运行时 + 模型 + 缓存 + 余量）
3. 网络可达：`huggingface.co` 基本探活
4. 旧安装冲突：同 ID bundle 是否已存在

失败即返回明确错误码，不进入下载阶段。

### 5.2 Python 运行时安装

沿用 `installPythonRuntimeCatalogBundle` 主流程，但将 pip 安装拆为两组：

1. 基础依赖组（稳定固定版本）
2. 模型依赖组（`mlx-audio` 及其直接依赖）

建议安装策略：

- 优先安装固定版本（避免“今天能装、明天装崩”）
- 安装后执行 `python -m mlx_audio.tts.generate --help` 作为版本校验

### 5.3 模型下载

不建议直接沿用当前 `bootstrap_runtime.py` 的默认 `snapshot_download` 参数。应新增参数：

1. `--hf-disable-xet`（默认 true）
2. `--hf-disable-transfer`（默认 true）
3. `--hf-max-workers`（默认 1）
4. `--allow-patterns`（限制下载文件集合）

并在 `bootstrap_runtime.py` 内设置环境变量后调用 `snapshot_download`。

### 5.4 断点续传与临时文件

必须保留以下行为：

1. 允许 `.incomplete` 续传
2. 安装失败不删除可续传缓存（仅删除坏状态元信息）
3. 用户手动“重置安装”时再全量清理

## 6. 健康检查（安装完成前的准入门槛）

安装完成后必须自动执行一次最小推理验收：

输入：

- `text`: `你好，这是一条模型健康检查语句。`
- `instruct`: `自然、清晰、温和语气`
- `lang_code`: `Chinese`

判定条件：

1. 成功输出 WAV 文件
2. `sampleRate == 24000`
3. 音频时长在 `0.8s ~ 12s`
4. 文件大小 > 0

任一条件失败，标记安装失败并给出错误码，不写入可选模型列表。

## 7. 错误码与重试策略

建议新增错误码（前缀 `voice_model_`）：

1. `voice_model_preflight_disk_insufficient`
2. `voice_model_preflight_platform_unsupported`
3. `voice_model_python_dependency_incompatible`
4. `voice_model_hf_rate_limited`
5. `voice_model_hf_transfer_unstable`
6. `voice_model_mlx_audio_version_mismatch`
7. `voice_model_health_check_failed`

重试策略：

1. 网络类错误：指数退避重试 3 次
2. 限流类错误：自动切换到单 worker 配置后重试
3. 版本不兼容：不自动重试，直接提示升级运行时

## 8. 进度与埋点规范

安装过程建议统一上报以下字段：

1. `phase`
2. `bundleId`
3. `downloadedBytes`
4. `totalBytes`
5. `bytesPerSecond`
6. `estimatedRemainingSeconds`
7. `elapsedSeconds`
8. `attempt`

关键耗时指标：

1. `runtime_download_ms`
2. `pip_install_ms`
3. `model_download_ms`
4. `health_check_ms`
5. `total_install_ms`

## 9. 对现有代码的最小改造清单

### 9.1 `voiceModelCatalog.js`

1. 新增 `builtin-python-qwen3-voicedesign-mlx-v1` 项
2. 固定模型 ID 为 `mlx-community/Qwen3-TTS-12Hz-1.7B-VoiceDesign-bf16`
3. 固定 `ttsMode=voice_design`
4. 增加运行时依赖版本声明

### 9.2 `voiceModelLibrary.js`

1. `installPythonRuntimeCatalogBundle` 增加 preflight 阶段
2. pip 安装支持“固定版本锁”
3. bootstrap 调用增加下载策略参数透传
4. 安装后追加健康检查步骤
5. 仅健康检查通过才 `persistState`

### 9.3 `bootstrap_runtime.py`

1. `snapshot_download` 支持 `max_workers`
2. 支持设置 `HF_HUB_DISABLE_XET/HF_HUB_ENABLE_HF_TRANSFER`
3. 增加结构化 stderr 日志，便于主进程解析
4. 返回 manifest（文件列表、大小、源）

## 10. 推荐依赖锁（首版建议）

建议以 constraints 文件固化核心版本，例如：

1. `mlx-audio==0.3.2`
2. `mlx-lm==0.30.5`
3. `huggingface-hub==1.5.0`
4. `transformers==5.0.0rc3`

说明：后续升级时只改 constraints 并跑回归，不直接放开浮动版本。

## 11. 验收标准（交付“一键安装”功能时）

1. 全新机器从零安装成功率 >= 95%
2. 弱网条件下可恢复下载，不重复全量拉取
3. 安装失败后不污染已安装模型列表
4. UI 可展示阶段进度、网速与可读错误
5. 健康检查通过后可直接进入 TTS 测试并播放

## 12. 附：本次排障经验摘要

1. 最大风险不是推理本身，而是模型下载通道稳定性（CAS/Xet/hf_transfer）。
2. 版本兼容必须前置校验，避免下载完才发现 `mlx-audio` 过旧。
3. 首次推理可能额外下载辅助模型（如 `snac_24khz`），需要计入进度与文案。
4. 仅“下载成功”不等于“可用”，必须有自动健康检查。

