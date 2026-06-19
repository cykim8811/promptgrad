from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.responses import JSONResponse
from sqlalchemy import text

from app.core.database import AsyncSessionLocal
from app.core.seed import seed_prompts
from app.routes.prompts import router as prompts_router
from app.routes.sessions import router as sessions_router
from app.routes.users import router as users_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Seed default Generator/Evaluator prompts on first boot.
    try:
        await seed_prompts()
    except Exception:
        # Don't block startup if the DB isn't ready yet; migrations run
        # in the entrypoint before us, so this should normally succeed.
        pass
    yield


app = FastAPI(
    title="promptgrad API",
    version="0.1.0",
    lifespan=lifespan,
    docs_url="/api/docs",
    openapi_url="/api/openapi.json",
)

app.include_router(users_router)
app.include_router(prompts_router)
app.include_router(sessions_router)


@app.get("/api/health")
async def health() -> JSONResponse:
    try:
        async with AsyncSessionLocal() as session:
            await session.execute(text("SELECT 1"))
    except Exception:
        return JSONResponse(
            status_code=503, content={"status": "error", "detail": "database"}
        )
    return JSONResponse(content={"status": "ok"})


@app.get("/api/_diag/llm")
async def diag_llm() -> JSONResponse:
    """TEMPORARY diagnostic — verifies the managed LLM call path."""
    import os
    import traceback

    from app.core import llm as _llm
    from app.core.config import settings

    base = os.environ.get("ANTHROPIC_BASE_URL", "")
    info = {
        "base_url_set": bool(base),
        "base_url": base,
        "key_set": bool(os.environ.get("ANTHROPIC_API_KEY")),
        "default_model": settings.default_model,
    }
    try:
        client = _llm._get_client()
        msg = await client.messages.create(
            model=settings.default_model,
            max_tokens=32,
            messages=[{"role": "user", "content": "Reply with the single word: ok"}],
        )
        text_out = "".join(b.text for b in msg.content if b.type == "text")
        return JSONResponse(content={"ok": True, "text": text_out, **info})
    except Exception as e:  # noqa: BLE001
        return JSONResponse(
            content={
                "ok": False,
                "error": repr(e),
                "tb": traceback.format_exc()[-1500:],
                **info,
            }
        )
