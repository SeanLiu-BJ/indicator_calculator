# indicator_calculator

离线桌面版指数计算器（Electron + FastAPI + React + ECharts）。

## 开发启动

### 1) 后端（FastAPI）

```bash
python3 -m venv backend/.venv
source backend/.venv/bin/activate
python -m pip install -r backend/requirements.txt
```

### 2) 前端（React）

```bash
npm --prefix frontend install
npm --prefix frontend run build
```

### 3) 桌面壳（Electron）

```bash
npm --prefix desktop install
npm --prefix desktop run dev
```

> Electron 会自动拉起本地 FastAPI（仅监听 127.0.0.1）并打开窗口。

