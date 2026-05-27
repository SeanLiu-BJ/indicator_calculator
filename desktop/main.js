const { app, BrowserWindow, dialog } = require("electron");
const fs = require("fs");
const path = require("path");
const net = require("net");
const http = require("http");
const crypto = require("crypto");
const { spawn } = require("child_process");

let desktopLogPath = null;

function ensureDesktopLogPath() {
  if (desktopLogPath) return desktopLogPath;
  const logDir = path.join(app.getPath("userData"), "logs");
  fs.mkdirSync(logDir, { recursive: true });
  desktopLogPath = path.join(logDir, "desktop.log");
  return desktopLogPath;
}

function writeDesktopLog(level, message, extra = undefined) {
  const logPath = ensureDesktopLogPath();
  const payload = {
    ts: new Date().toISOString(),
    level,
    message,
    ...(extra ? { extra } : {}),
  };
  fs.appendFileSync(logPath, `${JSON.stringify(payload)}\n`, "utf8");
}

function getDesktopLogPath() {
  return ensureDesktopLogPath();
}

if (!process.versions || !process.versions.electron) {
  console.error("该入口必须在 Electron 中运行。请使用 `npm --prefix desktop run dev` 启动。");
  process.exit(1);
}

function findFreePort(startPort) {
  return new Promise((resolve) => {
    function tryPort(port) {
      const server = net.createServer();
      server.unref();
      server.on("error", () => tryPort(port + 1));
      server.listen({ port, host: "127.0.0.1" }, () => {
        const found = server.address().port;
        server.close(() => resolve(found));
      });
    }
    tryPort(startPort);
  });
}

function waitForHealth(url, timeoutMs) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    function tick() {
      const req = http.get(url, (res) => {
        if (res.statusCode === 200) {
          res.resume();
          resolve();
          return;
        }
        res.resume();
        retry();
      });
      req.on("error", retry);

      function retry() {
        if (Date.now() - start > timeoutMs) {
          reject(new Error("后端健康检查超时"));
          writeDesktopLog("error", "backend_health_timeout", { url, timeoutMs });
          return;
        }
        setTimeout(tick, 200);
      }
    }
    tick();
  });
}

function detectStartMode() {
  if (process.env.INDICATOR_ELECTRON_MODE) {
    return process.env.INDICATOR_ELECTRON_MODE;
  }
  return app.isPackaged ? "release" : "dev";
}

function resolveRuntimePaths() {
  const runtimeRoot = app.isPackaged ? process.resourcesPath : path.resolve(__dirname, "..");
  const backendRoot = process.env.INDICATOR_BACKEND_ROOT || runtimeRoot;
  const frontendDist =
    process.env.INDICATOR_FRONTEND_DIST || path.join(runtimeRoot, "frontend", "dist");
  const rendererURL = (process.env.INDICATOR_RENDERER_URL || "").trim();
  const backendExecutable =
    process.env.INDICATOR_BACKEND_EXECUTABLE ||
    path.join(runtimeRoot, "backend_runtime", process.platform === "win32" ? "indicator_backend.exe" : "indicator_backend");

  return {
    runtimeRoot,
    backendRoot,
    frontendDist,
    rendererURL,
    backendExecutable,
  };
}

function assertRuntimeAssumptions({ backendRoot, frontendDist, rendererURL, backendExecutable }) {
  const backendEntry = path.join(backendRoot, "backend", "app", "serve.py");
  const hasBundledExecutable = backendExecutable && fs.existsSync(backendExecutable);
  if (!hasBundledExecutable && !fs.existsSync(backendEntry)) {
    throw new Error(
      `缺少 backend 运行时：${backendEntry}。当前交付路径需要 backend 源码或已打包的 backend 可执行文件。`,
    );
  }

  if (!rendererURL && !fs.existsSync(frontendDist)) {
    throw new Error(
      `缺少前端静态资源：${frontendDist}。请先执行前端 build，或在 dev 模式下提供 INDICATOR_RENDERER_URL。`,
    );
  }
}

function resolvePythonExecutable(runtime) {
  if (process.env.INDICATOR_PYTHON) return process.env.INDICATOR_PYTHON;

  const candidates = [
    path.join(runtime.backendRoot, "backend", ".venv", "bin", "python"),
    path.join(runtime.backendRoot, "backend", ".venv", "Scripts", "python.exe"),
    path.join(runtime.runtimeRoot, "backend", ".venv", "bin", "python"),
    path.join(runtime.runtimeRoot, "backend", ".venv", "Scripts", "python.exe"),
    path.join(runtime.backendRoot, ".venv", "bin", "python"),
    path.join(runtime.backendRoot, ".venv", "Scripts", "python.exe"),
    path.join(runtime.runtimeRoot, ".venv", "bin", "python"),
    path.join(runtime.runtimeRoot, ".venv", "Scripts", "python.exe"),
    "python3",
    "python",
  ];
  for (const p of candidates) {
    try {
      if (p.includes(path.sep) && require("fs").existsSync(p)) return p;
      if (!p.includes(path.sep)) return p;
    } catch (e) {
      // ignore
    }
  }
  return "python";
}

let backendProcess = null;

async function startBackend(runtime) {
  const port = await findFreePort(Number(process.env.INDICATOR_PORT || 17892));
  const token = crypto.randomBytes(16).toString("hex");
  const dataDir = path.join(app.getPath("userData"), "indicator_calculator");
  const bundledBackendExists = runtime.backendExecutable && fs.existsSync(runtime.backendExecutable);

  const env = {
    ...process.env,
    INDICATOR_HOST: "127.0.0.1",
    INDICATOR_PORT: String(port),
    INDICATOR_DATA_DIR: dataDir,
    INDICATOR_LOG_DIR: path.join(app.getPath("userData"), "logs"),
    INDICATOR_TOKEN: token,
    INDICATOR_FRONTEND_DIST: runtime.frontendDist,
  };

  const spawnCommand = bundledBackendExists ? runtime.backendExecutable : resolvePythonExecutable(runtime);
  const spawnArgs = bundledBackendExists ? [] : ["-m", "backend.app.serve"];
  const launchMode = bundledBackendExists ? "bundled-executable" : "python-module";

  writeDesktopLog("info", "backend_starting", {
    launchMode,
    spawnCommand,
    spawnArgs,
    dataDir,
    backendRoot: runtime.backendRoot,
    frontendDist: runtime.frontendDist,
  });
  backendProcess = spawn(spawnCommand, spawnArgs, {
    cwd: bundledBackendExists ? path.dirname(runtime.backendExecutable) : runtime.backendRoot,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  backendProcess.stdout.on("data", (chunk) => {
    const text = String(chunk).trim();
    if (text) writeDesktopLog("info", "backend_stdout", { text });
    process.stdout.write(chunk);
  });

  backendProcess.stderr.on("data", (chunk) => {
    const text = String(chunk).trim();
    if (text) writeDesktopLog("error", "backend_stderr", { text });
    process.stderr.write(chunk);
  });

  backendProcess.on("error", (error) => {
    console.error(`[backend] 启动失败：${error.message}`);
    writeDesktopLog("error", "backend_spawn_error", { error: error.message });
  });

  backendProcess.on("exit", (code) => {
    if (code !== 0) {
      console.error(`[backend] 异常退出，退出码：${code}`);
      writeDesktopLog("error", "backend_exit", { code });
    }
  });

  await waitForHealth(`http://127.0.0.1:${port}/health`, 15000);
  return { port, token };
}

function stopBackend() {
  if (!backendProcess) return;
  try {
    backendProcess.kill();
  } catch (e) {
    // ignore
  }
  backendProcess = null;
}

function buildRendererUrl({ port, token, rendererURL }) {
  const base = rendererURL || `http://127.0.0.1:${port}/`;
  const url = new URL(base);
  url.searchParams.set("token", token);
  if (!rendererURL) {
    url.hash = "#/";
  }
  return url.toString();
}

async function createWindow() {
  const startMode = detectStartMode();
  const runtime = resolveRuntimePaths();
  assertRuntimeAssumptions(runtime);

  console.log(
    `[desktop] mode=${startMode} backendRoot=${runtime.backendRoot} frontendDist=${runtime.frontendDist} rendererURL=${runtime.rendererURL || "(backend static)"}`,
  );
  writeDesktopLog("info", "desktop_runtime_resolved", {
    mode: startMode,
    backendRoot: runtime.backendRoot,
    frontendDist: runtime.frontendDist,
    rendererURL: runtime.rendererURL || "(backend static)",
  });

  const { port, token } = await startBackend(runtime);

  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const url = buildRendererUrl({ port, token, rendererURL: runtime.rendererURL });
  await win.loadURL(url);
  writeDesktopLog("info", "renderer_loaded", { url });
}

app.on("ready", () => {
  createWindow().catch((e) => {
    console.error(e);
    writeDesktopLog("error", "desktop_start_failed", { error: e.message, stack: e.stack });
    stopBackend();
    dialog.showErrorBox("Indicator Desktop 启动失败", `${e.message}\n\n日志文件：${getDesktopLogPath()}`);
    app.quit();
  });
});

app.on("before-quit", () => {
  stopBackend();
});

app.on("window-all-closed", () => {
  stopBackend();
  app.quit();
});
