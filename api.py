from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from agent import MiniGPTAgent
from agent.config import ROOT


agent: MiniGPTAgent | None = None


@asynccontextmanager
async def lifespan(_: FastAPI):
    global agent
    agent = MiniGPTAgent()
    yield


app = FastAPI(title="Mini-GPT Agent", version="1.0.0", lifespan=lifespan)
app.mount("/static", StaticFiles(directory=ROOT / "web"), name="static")


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=5000)
    session_id: str = Field(default="default", min_length=1, max_length=100)
    allow_web: bool = True


class MemoryRequest(BaseModel):
    content: str = Field(min_length=1, max_length=5000)


@app.get("/")
def index():
    return FileResponse(ROOT / "web" / "index.html")


@app.get("/manifest.json")
def manifest():
    return FileResponse(ROOT / "web" / "manifest.json")


@app.get("/sw.js")
def service_worker():
    return FileResponse(ROOT / "web" / "sw.js", media_type="application/javascript")


@app.get("/api/health")
def health():
    return {"status": "ok", "agent_ready": agent is not None}


@app.post("/api/chat")
def chat(request: ChatRequest):
    if agent is None:
        raise HTTPException(status_code=503, detail="Agent is starting")
    return agent.chat(request.message, request.session_id, request.allow_web).to_dict()


@app.get("/api/memories")
def memories():
    if agent is None:
        raise HTTPException(status_code=503, detail="Agent is starting")
    return {"memories": agent.memory.list_memories()}


@app.post("/api/memories")
def remember(request: MemoryRequest):
    if agent is None:
        raise HTTPException(status_code=503, detail="Agent is starting")
    return {"saved": agent.memory.remember(request.content, {"source": "manual"})}


@app.delete("/api/memories/{memory_id}")
def forget(memory_id: int):
    if agent is None:
        raise HTTPException(status_code=503, detail="Agent is starting")
    return {"deleted": agent.memory.forget(memory_id)}
