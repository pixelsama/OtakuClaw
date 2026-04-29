# OtakuClaw

<p align="center">
  <img src="./Logo.jpg" alt="OtakuClaw Logo" width="180" />
</p>

OtakuClaw 是一个可直接安装使用的跨平台桌面应用（Electron），当前支持 macOS 与 Windows 构建。

## 下载

- 最新版本（macOS / Windows）：  
  https://github.com/pixelsama/OtakuClaw/releases/latest

## 当前版本状态

- 已提供稳定可安装的 macOS App（DMG）。
- Windows 支持 NSIS 安装包，可通过 `pnpm run desktop:build:win` 生成。
- 当前公开版本仅开放 `Nanobot` 后端。
- `OpenClaw` 后端已在现版本中临时禁用，后续版本再重新开放。

## 本地构建

- 安装依赖：`pnpm install`
- 开发模式：`pnpm run desktop:dev`
- macOS 安装包：`pnpm run desktop:build:mac`
- Windows 安装包：`pnpm run desktop:build:win`

## 主要能力

- 首次引导安装 Nanobot 运行时
- 一键下载并启用本地 ASR / TTS 模型
- 聊天、语音链路与截图提问能力
- 配置持久化与系统密钥链存储（桌面端）

## 项目结构

- `desktop/electron/`：主进程、IPC、运行时与模型管理
- `front_end/`：React UI
- `docs/`：文档与设计记录

## 许可证

Creative Commons Attribution-NonCommercial 4.0 International（CC BY-NC 4.0，见 `LICENSE`）

## 第三方许可证说明

- 本项目包含对 `bitifirefly/reflect-glass-button` 的改造与资源引用（MIT License）。
- 具体引用信息与 MIT 许可证全文见 `THIRD_PARTY_NOTICES.md`。
