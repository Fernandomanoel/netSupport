"""Agente: roda (visível) no PC do usuário.
Uso: python agent.py ws://SERVIDOR:8080 TOKEN
O usuário vê quando o suporte está olhando e só libera o controle clicando no botão (vale por sessão).
"""
import asyncio, io, json, socket, sys, threading
import tkinter as tk
from tkinter import simpledialog

import aiohttp, mss, pyautogui
from PIL import Image

pyautogui.PAUSE = 0
pyautogui.FAILSAFE = False
url, token = sys.argv[1], sys.argv[2]
st = {"watch": False, "allow": False, "ws": None}
loop = asyncio.new_event_loop()
KEYS = {"Enter": "enter", "Backspace": "backspace", "Tab": "tab", "Escape": "esc", "Delete": "delete", " ": "space",
        "ArrowUp": "up", "ArrowDown": "down", "ArrowLeft": "left", "ArrowRight": "right", "Control": "ctrl"}


def frame():
    with mss.mss() as s:
        g = s.grab(s.monitors[1])
    im = Image.frombytes("RGB", g.size, g.bgra, "raw", "BGRX")
    im.thumbnail((1280, 1280))
    b = io.BytesIO()
    im.save(b, "JPEG", quality=50)
    return b.getvalue()


def do_input(d):
    if not st["allow"]:
        return
    t, (w, h) = d["t"], pyautogui.size()
    if t == "move":
        pyautogui.moveTo(int(d["x"] * w), int(d["y"] * h))
    elif t == "down":
        pyautogui.mouseDown(int(d["x"] * w), int(d["y"] * h), button=d["b"])
    elif t == "up":
        pyautogui.mouseUp(int(d["x"] * w), int(d["y"] * h), button=d["b"])
    elif t == "scroll":
        pyautogui.scroll(-int(d["d"]))
    elif t == "key":
        k = d["k"]
        if len(k) == 1 and k != " ":
            pyautogui.write(k)
        else:
            pyautogui.press(KEYS.get(k, k.lower()))


async def stream(ws):
    while True:
        if st["watch"]:
            await ws.send_bytes(await asyncio.to_thread(frame))
        await asyncio.sleep(0.2)


async def run():
    async with aiohttp.ClientSession() as s:
        while True:
            try:
                async with s.ws_connect(f"{url}/agent", params={"token": token, "name": socket.gethostname()}, max_msg_size=0) as ws:
                    st["ws"] = ws
                    sender = asyncio.create_task(stream(ws))
                    try:
                        async for m in ws:
                            if m.type != aiohttp.WSMsgType.TEXT:
                                continue
                            d = json.loads(m.data)
                            if d["t"] == "watch":
                                st["watch"] = d["on"]
                            else:
                                try:
                                    do_input(d)
                                except Exception:
                                    pass  # tecla/valor inválido vindo do console
                    finally:
                        sender.cancel()
            except aiohttp.ClientError:
                pass
            st["watch"], st["ws"] = False, None
            await asyncio.sleep(3)


def send(d):
    if st["ws"]:
        asyncio.run_coroutine_threadsafe(st["ws"].send_json(d), loop)


root = tk.Tk()
root.title("Suporte")
root.attributes("-topmost", True)
lbl = tk.Label(root, width=36, pady=8)
lbl.pack()


def toggle():
    st["allow"] = not st["allow"]
    send({"t": "allow", "on": st["allow"]})


def ask():
    text = simpledialog.askstring("Pedir ajuda", "Descreva o problema:", parent=root)
    if text:
        send({"t": "help", "text": text})


def tick():
    if not st["watch"] and st["allow"]:  # a permissão acaba quando o suporte sai
        st["allow"] = False
        send({"t": "allow", "on": False})
    lbl.config(text="SUPORTE ESTÁ VENDO SUA TELA" + (" E CONTROLANDO" if st["allow"] else "") if st["watch"] else "Conectado ao suporte" if st["ws"] else "Sem conexão",
               fg="red" if st["watch"] else "black")
    btn.config(text="Revogar controle" if st["allow"] else "Permitir controle")
    root.after(500, tick)


btn = tk.Button(root, command=toggle)
btn.pack(fill="x")
tk.Button(root, text="Pedir ajuda", command=ask).pack(fill="x")
threading.Thread(target=lambda: (asyncio.set_event_loop(loop), loop.run_until_complete(run())), daemon=True).start()
tick()
root.mainloop()
