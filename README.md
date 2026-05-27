# indicator_calculator

离线桌面版指数计算器（Electron + FastAPI + React + ECharts）。

## 开发启动

### 一键启动（前后端热更新）

```bash
./start.sh
```

或直接使用面向演示的根命令：

```bash
npm run demo:start
```

打开 `http://127.0.0.1:5173`（Vite 热更新），后端 API 通过 `/api` 代理到 `127.0.0.1:8000`（Uvicorn `--reload`）。

## Demo 演示路径

启动后建议直接从 onboarding 页开始讲：

1. 在示例数据页切换 `熵权法 / PCA / AHP`
2. 先看页面顶部摘要卡和算法说明
3. 再看指数表格和图表，说明综合指数与分项指数差异
4. 最后点击“开始导入我的数据”进入真实业务数据流程

前端开发依赖：Node `>=22.12`（或 `>=20.19`）+ `pnpm`（见 `frontend/package.json` 的 `packageManager`）。

如果你通过 Homebrew 安装的是 `node@22`（keg-only），需要把它放到 PATH 前面：

```bash
echo 'export PATH="/usr/local/opt/node@22/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
node -v
```

### 1) 后端（FastAPI）

```bash
python3 -m venv backend/.venv
source backend/.venv/bin/activate
python -m pip install -r backend/requirements.txt
```

### 2) 前端（React）

```bash
pnpm --dir frontend install
pnpm --dir frontend build
```

### 3) 桌面壳（Electron）

```bash
npm --prefix desktop install
npm --prefix desktop run dev
```

> Electron 会自动拉起本地 FastAPI（仅监听 127.0.0.1）并打开窗口。

如果你要挂到 Vite 热更新界面，而不是使用 `frontend/dist` 静态资源：

```bash
./start.sh
npm run dev:desktop:vite
```

### Desktop Delivery Path

最小可交付路径已经收口成一条显式脚本：

```bash
npm run build:desktop:release
```

这条路径会做三件事：
- 校验 Electron 交付时的 Python runtime 假设
- 构建 `frontend/dist`
- 产出一个 staged release 目录：内含 `backend/` 源码、`frontend/dist`、Electron runtime 和启动脚本

当前 release runtime 假设是显式的：
- 不内嵌 Python，也不打包 backend wheel；release 目录只携带 `backend/` 源码
- 默认使用 `INDICATOR_PYTHON` 指向的解释器；未设置时按 `backend/.venv`、`.venv`、`python3`、`python` 顺序查找
- Electron `dev` 模式默认走 backend 托管的 `frontend/dist`；如果设置 `INDICATOR_RENDERER_URL`，则改为连接外部前端开发服务器
- Electron `release` 模式读取 staged app 下的 `backend/` 与 `frontend/dist`
- release 构建会按 `desktop/package.json` 声明的 Electron 版本自动下载 runtime，不再依赖 `desktop/node_modules/electron/dist`

构建完成后可直接运行：

```bash
./desktop/dist/release/run-indicator-desktop.sh
```

在 macOS 上，release 目录还会额外生成一个可双击的启动器：

```text
./desktop/dist/release/Indicator Calculator.app
```

如果要运行产出的 release，目标机器仍需满足上面的 Python 假设；这一步还没有做到“真正单文件交付”。

### Windows EXE Installer（内嵌 backend 可执行文件）

Windows 交付链已经收成“先打 backend.exe，再打 Electron 安装包”的模式。当前仓库里已经包含：

- `scripts/build-backend-exe.ps1`
  - 使用 PyInstaller 把 `backend/app/windows_entry.py` 打成 `indicator_backend.exe`
- `scripts/build-windows-installer.ps1`
  - 串起 backend.exe、`frontend/dist` 和 Electron NSIS 安装包
- `desktop/package.json`
  - 已补 `electron-builder` 的 Windows NSIS 配置

在 **Windows 构建机** 上执行：

```powershell
pnpm --dir frontend install
npm --prefix desktop install
powershell -ExecutionPolicy Bypass -File .\scripts\build-windows-installer.ps1
```

预期产物：

- backend 可执行文件：
  - `desktop/dist/win-build/backend-runtime/indicator_backend.exe`
- Windows 安装包：
  - `desktop/dist/installer/*.exe`

当前限制：

- 这条链路需要在 Windows 环境里执行，才能稳定产出可安装的 `Setup.exe`
- 我现在这台机器是 macOS，所以已经把打包骨架和启动逻辑准备好，但没有直接产出 Windows 安装包实物

## 最小质量基线

统一校验入口：

```bash
bash ./scripts/validate.sh
```

或：

```bash
npm run validate
```

当前会做两件事：
- 安装/更新 backend 的最小依赖到仓库本地 `.venv`
- 运行 `backend/tests/test_engine.py` 的确定性回归测试
