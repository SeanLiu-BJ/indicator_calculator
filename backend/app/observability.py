from __future__ import annotations

import json
import logging
import time
import traceback
from logging.handlers import RotatingFileHandler
from pathlib import Path
from typing import Any

from fastapi import Request
from fastapi.responses import JSONResponse


_configured = False
request_logger = logging.getLogger("indicator.request")
event_logger = logging.getLogger("indicator.event")
error_logger = logging.getLogger("indicator.error")


def setup_logging(log_dir: Path) -> None:
    global _configured
    if _configured:
        return

    log_dir.mkdir(parents=True, exist_ok=True)
    formatter = logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s")

    for logger_name, filename in {
        "indicator.request": "requests.log",
        "indicator.event": "events.log",
        "indicator.error": "errors.log",
    }.items():
        logger = logging.getLogger(logger_name)
        logger.setLevel(logging.INFO)
        logger.propagate = False
        handler = RotatingFileHandler(log_dir / filename, maxBytes=1_500_000, backupCount=3, encoding="utf-8")
        handler.setFormatter(formatter)
        logger.handlers.clear()
        logger.addHandler(handler)

    _configured = True


def log_event(event: str, **fields: Any) -> None:
    payload = {"event": event, **fields}
    event_logger.info(json.dumps(payload, ensure_ascii=False, sort_keys=True))


def log_error(event: str, **fields: Any) -> None:
    payload = {"event": event, **fields}
    error_logger.error(json.dumps(payload, ensure_ascii=False, sort_keys=True))


async def request_logging_middleware(request: Request, call_next):  # type: ignore[no-untyped-def]
    started = time.perf_counter()
    try:
        response = await call_next(request)
        elapsed_ms = round((time.perf_counter() - started) * 1000, 2)
        request_logger.info(
            json.dumps(
                {
                    "method": request.method,
                    "path": request.url.path,
                    "query": str(request.url.query),
                    "status": response.status_code,
                    "elapsedMs": elapsed_ms,
                },
                ensure_ascii=False,
                sort_keys=True,
            )
        )
        return response
    except Exception as exc:  # pragma: no cover
        elapsed_ms = round((time.perf_counter() - started) * 1000, 2)
        log_error(
            "request_exception",
            method=request.method,
            path=request.url.path,
            query=str(request.url.query),
            elapsedMs=elapsed_ms,
            error=str(exc),
            traceback=traceback.format_exc(),
        )
        raise


async def unhandled_exception_handler(_request: Request, exc: Exception) -> JSONResponse:
    log_error("unhandled_exception", error=str(exc), traceback=traceback.format_exc())
    return JSONResponse(status_code=500, content={"detail": "服务端发生未处理异常"})


def tail_log(path: Path, limit: int = 200) -> list[str]:
    if not path.exists():
        return []
    lines = path.read_text(encoding="utf-8", errors="ignore").splitlines()
    return lines[-limit:]
