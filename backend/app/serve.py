from __future__ import annotations

import os

import uvicorn

from backend.app.main import app


def main() -> None:
    host = os.environ.get("INDICATOR_HOST", "127.0.0.1")
    port = int(os.environ.get("INDICATOR_PORT", "8000"))
    uvicorn.run(app, host=host, port=port, log_level="info")


if __name__ == "__main__":
    main()
