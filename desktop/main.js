const { app, BrowserWindow } = require("electron");
const path = require("path");
const net = require("net");
const http = require("http");
const crypto = require("crypto");
const { spawn } = require("child_process");

if (!process.versions || !process.versions.electron) {
  console.error("This entrypoint must be run with Electron. Use `npm --prefix desktop run dev`.");
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
          reject(new Error("Backend health check timed out"));
          return;
        }
        setTimeout(tick, 200);
      }
    }
    tick();
  });
}

function resolvePythonExecutable(repoRoot) {
  if (process.env.INDICATOR_PYTHON) return process.env.INDICATOR_PYTHON;

  const candidates = [
    path.join(repoRoot, "backend", ".venv", "bin", "python"),
    path.join(repoRoot, "backend", ".venv", "Scripts", "python.exe"),
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

async function startBackend(repoRoot) {
  const port = await findFreePort(Number(process.env.INDICATOR_PORT || 17892));
  const token = crypto.randomBytes(16).toString("hex");
  const dataDir = path.join(app.getPath("userData"), "indicator_calculator");

  const pythonExec = resolvePythonExecutable(repoRoot);
  const env = {
    ...process.env,
    INDICATOR_HOST: "127.0.0.1",
    INDICATOR_PORT: String(port),
    INDICATOR_DATA_DIR: dataDir,
    INDICATOR_TOKEN: token,
  };

  backendProcess = spawn(pythonExec, ["-m", "backend.app.serve"], {
    cwd: repoRoot,
    env,
    stdio: "inherit",
  });

  backendProcess.on("exit", (code) => {
    if (code !== 0) {
      console.error(`[backend] exited with code ${code}`);
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

async function createWindow() {
  const repoRoot = path.resolve(__dirname, "..");
  const { port, token } = await startBackend(repoRoot);

  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const url = `http://127.0.0.1:${port}/?token=${token}#/`;
  await win.loadURL(url);
}

app.on("ready", () => {
  createWindow().catch((e) => {
    console.error(e);
    stopBackend();
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
