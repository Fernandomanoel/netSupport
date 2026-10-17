"""Autoteste: agente falso + console falso contra o servidor real."""
import asyncio, os
os.environ["TOKEN"] = "t"
import aiohttp
from aiohttp import web, ClientSession
import server

async def main():
    r = web.AppRunner(server.app); await r.setup()
    await web.TCPSite(r, "127.0.0.1", 8099).start()
    async with ClientSession() as s:
        assert (await s.get("http://127.0.0.1:8099/?token=x")).status == 403
        a = await s.ws_connect("http://127.0.0.1:8099/agent?token=t&name=pc1")
        c = await s.ws_connect("http://127.0.0.1:8099/console?token=t")
        st = (await c.receive_json()); aid = st["agents"][0]["id"]
        await c.send_json({"t": "watch", "id": aid})
        assert (await a.receive_json()) == {"t": "watch", "on": True}
        await a.send_bytes(b"jpeg"); assert (await c.receive_bytes()) == b"jpeg"
        await c.send_json({"t": "move", "x": .5, "y": .5})      # sem permissão: não chega
        await a.send_json({"t": "help", "text": "sem internet"})
        st = await c.receive_json(); assert st["tickets"][0]["text"] == "sem internet"
        # administração chega mesmo com allow=False
        await c.send_json({"t": "lock"})
        assert (await asyncio.wait_for(a.receive_json(), 2)) == {"t": "lock"}
        await c.send_json({"t": "shutdown"})
        assert (await asyncio.wait_for(a.receive_json(), 2)) == {"t": "shutdown"}
        # envio de arquivo: upload -> agente é avisado -> download funciona
        fd = aiohttp.FormData(); fd.add_field("file", b"oi", filename="n.txt")
        assert (await s.post(f"http://127.0.0.1:8099/upload?token=t&id={aid}", data=fd)).status == 200
        m = await asyncio.wait_for(a.receive_json(), 2); assert m["t"] == "file" and m["name"] == "n.txt", m
        assert (await (await s.get(f"http://127.0.0.1:8099{m['url']}?token=t")).read()) == b"oi"
        await a.send_json({"t": "allow", "on": True}); await c.receive_json()
        await c.send_json({"t": "move", "x": .5, "y": .5})
        m = await asyncio.wait_for(a.receive_json(), 2); assert m["t"] == "move", m
        print("OK")
    await r.cleanup()
asyncio.run(main())
