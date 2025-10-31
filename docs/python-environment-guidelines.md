# Python 环境与依赖指引

## 推荐 Python 版本
- **Python 3.11.x**：目前项目在本地与 CI/测试中均使用 Python 3.11.14，通过 `uv python install 3.11` 可以快速获取该版本。
- 历史上部分开发机可能仍是系统 Python 3.9；建议迁移到 3.11，避免类型提示（PEP 604 等）和依赖冲突问题。

## 工具链建议
- **uv**（https://github.com/astral-sh/uv）作为默认包管理与虚拟环境工具：
  - 创建虚拟环境：`uv venv --python 3.11 .venv`
  - 安装依赖（示例）：`uv pip install --python .venv/bin/python -r services/gateway-python/requirements.txt`
  - 查看已装包：`uv pip list --python .venv/bin/python`
- 如需传统 `pip`，可在 `.venv/bin/python -m pip install ...` 中使用，但 uv 已封装常用场景。

## 依赖分层
- **根目录**：
  - `requirements-dev.txt`：通用开发工具（lint、format、测试等）。
  - 运行全局脚本或多服务开发时，请在 `.venv` 中一次性安装：`uv pip install --python .venv/bin/python -r requirements-dev.txt`
- **各微服务**：
  - `services/<service>/requirements.txt`：服务运行时依赖。
  - `services/<service>/requirements-test.txt`：该服务的测试/CI 依赖。
  - 示例（Gateway）：  
    ```bash
    uv pip install --python .venv/bin/python -r services/gateway-python/requirements.txt
    uv pip install --python .venv/bin/python -r services/gateway-python/requirements-test.txt
    ```
- **前端**：
  - `front_end/package.json` 与 `package-lock.json` 由 npm 管理；建议使用 `npm install`（或 `pnpm` 视团队约定而定）。

## 虚拟环境规范
- 默认在仓库根目录创建 `.venv/`，便于脚本、IDE、CI 定位。
- 激活方式：`source .venv/bin/activate`（macOS/Linux）或使用 `uv run`/`.venv/bin/python` 直接调用。
- 不要将 `.venv` 提交到版本库；`.gitignore` 已默认忽略。

## 版本固定与后续工作
- 各服务的 `requirements*.txt` 目前以浮动上限为主，建议逐步改为锁定范围（例如 `~=`, `<`)。
- 后续可引入 `pyproject.toml` 与 uv 的依赖组管理，统一锁定版本并生成 `uv.lock`；此文档作为当前状态的快速参考。
