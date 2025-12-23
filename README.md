# indicator_calculator

离线桌面版指数计算器（Electron + FastAPI + React + ECharts）。

## 开发启动

### 一键启动（前后端热更新）

```bash
./start.sh
```

打开 `http://127.0.0.1:5173`（Vite 热更新），后端 API 通过 `/api` 代理到 `127.0.0.1:8000`（Uvicorn `--reload`）。

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
