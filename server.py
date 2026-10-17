"""Servidor: liga agentes (PCs) a consoles (navegador do técnico) e guarda chamados.
Uso: TOKEN=segredo python server.py [porta]   ->  abrir http://SERVIDOR:PORTA/?token=segredo
"""
import json, os, secrets, sys, time
from pathlib import Path
from aiohttp import web, WSMsgType

TOKEN = os.environ.get("TOKEN") or secrets.token_urlsafe(8)
agents = {}    # id -> {ws, name, allow, watchers:set}
consoles = {}  # ws -> id do agente observado (ou None)
tickets = []   # {id, who, text, ts, done}
files = {}     # fid -> (nome, bytes) de um arquivo a caminho de um agente
ADMIN = {"block", "lock", "unlock"}  # comandos à máquina administrada; não dependem do "permitir controle"


async def safe(ws, send, *a):
    """Peer que caiu no meio do envio não pode derrubar os outros."""
    try:
        await getattr(ws, send)(*a)
    except ConnectionError:
        pass


def authed(r):
    return secrets.compare_digest(r.query.get("token", ""), TOKEN)


async def push_state():
    msg = json.dumps({"t": "state", "tickets": tickets, "agents": [
        {"id": i, "name": a["name"], "allow": a["allow"]} for i, a in agents.items()]})
    for c in list(consoles):
        await safe(c, "send_str", msg)


async def unwatch(c):
    a = agents.get(consoles.get(c))
    consoles[c] = None
    if a:
        a["watchers"].discard(c)
        if not a["watchers"]:
            await safe(a["ws"], "send_json", {"t": "watch", "on": False})


async def index(r):
    if not authed(r):
        raise web.HTTPForbidden()
    return web.FileResponse(Path(__file__).with_name("console.html"))


async def upload(r):
    if not authed(r):
        raise web.HTTPForbidden()
    a = agents.get(r.query.get("id"))
    if not a:
        raise web.HTTPNotFound()
    f = (await r.post())["file"]
    fid = secrets.token_hex(8)
    files[fid] = (f.filename, f.file.read())
    await safe(a["ws"], "send_json", {"t": "file", "name": f.filename, "url": f"/download/{fid}"})
    return web.Response(text="ok")


async def download(r):
    if not authed(r):
        raise web.HTTPForbidden()
    name, data = files.pop(r.match_info["fid"], (None, None))
    if data is None:
        raise web.HTTPNotFound()
    return web.Response(body=data, headers={"Content-Disposition": f'attachment; filename="{name}"'})


async def agent_ws(r):
    if not authed(r):
        raise web.HTTPForbidden()
    ws = web.WebSocketResponse(max_msg_size=0)
    await ws.prepare(r)
    aid = secrets.token_hex(3)
    a = agents[aid] = {"ws": ws, "name": r.query.get("name", "?")[:40], "allow": False, "watchers": set()}
    await push_state()
    try:
        async for m in ws:
            if m.type == WSMsgType.BINARY:
                for c in list(a["watchers"]):
                    await safe(c, "send_bytes", m.data)
            elif m.type == WSMsgType.TEXT:
                try:
                    d = json.loads(m.data)
                except ValueError:
                    continue  # frame inválido não derruba o agente
                if d.get("t") == "allow":
                    a["allow"] = bool(d.get("on"))
                elif d.get("t") == "help":
                    tickets.append({"id": len(tickets) + 1, "who": a["name"], "text": str(d["text"])[:500],
                                    "ts": time.strftime("%H:%M"), "done": False})
                await push_state()
    finally:
        del agents[aid]
        for c in a["watchers"]:
            consoles[c] = None
        await push_state()
    return ws


async def console_ws(r):
    if not authed(r):
        raise web.HTTPForbidden()
    c = web.WebSocketResponse()
    await c.prepare(r)
    consoles[c] = None
    await push_state()
    try:
        async for m in c:
            if m.type != WSMsgType.TEXT:
                continue
            try:
                d = json.loads(m.data)
            except ValueError:
                continue  # frame inválido não derruba o console
            t = d.get("t")
            if t == "watch":
                await unwatch(c)
                a = agents.get(d.get("id"))
                if a:
                    consoles[c] = d["id"]
                    a["watchers"].add(c)
                    await safe(a["ws"], "send_json", {"t": "watch", "on": True})
            elif t == "resolve":
                for tk in tickets:
                    if tk["id"] == d.get("id"):
                        tk["done"] = True
                await push_state()
            elif t in ADMIN:  # administração: chega mesmo sem o "permitir controle"
                a = agents.get(consoles[c])
                if a:
                    await safe(a["ws"], "send_str", m.data)
            else:  # entrada de mouse/teclado: o agente só obedece se o usuário permitiu
                a = agents.get(consoles[c])
                if a and a["allow"]:
                    await safe(a["ws"], "send_str", m.data)
    finally:
        await unwatch(c)
        del consoles[c]
    return c


app = web.Application(client_max_size=256 * 1024 * 1024)  # shortcut: limite de 256MB por arquivo
app.add_routes([web.get("/", index), web.get("/agent", agent_ws), web.get("/console", console_ws),
                web.post("/upload", upload), web.get("/download/{fid}", download)])

if __name__ == "__main__":
    print(f"token: {TOKEN}")
    # shortcut: HTTP/WS sem TLS, só para rede local confiável; para internet colocar atrás de proxy HTTPS
    web.run_app(app, port=int(sys.argv[1]) if len(sys.argv) > 1 else 8080)
