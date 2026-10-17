"""Agente: roda (visível) no PC do usuário.
Uso: python agent.py ws://SERVIDOR:8080 TOKEN
O usuário vê quando o suporte está olhando e só libera o controle clicando no botão (vale por sessão).
"""
import asyncio, io, json, os, socket, subprocess, sys, threading, time
import tkinter as tk
from tkinter import simpledialog

import aiohttp, mss, pyautogui
from PIL import Image

pyautogui.PAUSE = 0
pyautogui.FAILSAFE = False
url, token = sys.argv[1], sys.argv[2]
HTTP = ("https" if url.startswith("wss") else "http") + url[url.index(":"):]  # ws://h -> http://h
HOSTS = r"C:\Windows\System32\drivers\etc\hosts" if sys.platform == "win32" else "/etc/hosts"
MARK = "# netsupport"
RECV = os.path.join(os.path.expanduser("~"), "netsupport_recebidos")
st = {"watch": False, "allow": False, "ws": None, "s": None, "lock": False, "apps": set(), "note": ""}
lockwin = None
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


def block_sites(domains):
    """Reescreve o bloco netsupport do arquivo hosts (precisa de admin/root)."""
    try:
        keep = [l for l in open(HOSTS, encoding="utf-8", errors="ignore").read().splitlines() if MARK not in l]
        rules = [f"127.0.0.1 {d} {MARK}" for d in domains] + [f"127.0.0.1 www.{d} {MARK}" for d in domains]
        open(HOSTS, "w", encoding="utf-8").write("\n".join(keep + rules) + "\n")
        return True
    except OSError:
        return False  # sem permissão: avisa na janela


def kill_loop():
    """Encerra, a cada 2s, os apps da lista de bloqueio."""
    while True:
        for name in list(st["apps"]):
            if sys.platform == "win32":
                subprocess.run(["taskkill", "/F", "/IM", name], capture_output=True)
            else:
                subprocess.run(["pkill", "-f", name], capture_output=True)
        time.sleep(2)


async def recv_file(name, path):
    os.makedirs(RECV, exist_ok=True)
    async with st["s"].get(f"{HTTP}{path}", params={"token": token}) as r:
        data = await r.read()
    with open(os.path.join(RECV, os.path.basename(name)), "wb") as f:
        f.write(data)
    st["note"] = f"Recebido: {name}"


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
                    st["ws"], st["s"] = ws, s
                    sender = asyncio.create_task(stream(ws))
                    try:
                        async for m in ws:
                            if m.type != aiohttp.WSMsgType.TEXT:
                                continue
                            d = json.loads(m.data)
                            if d["t"] == "watch":
                                st["watch"] = d["on"]
                            elif d["t"] == "lock":
                                st["lock"] = True
                            elif d["t"] == "unlock":
                                st["lock"] = False
                            elif d["t"] == "block":
                                st["apps"] = {a.lower() for a in d.get("apps", [])}
                                if not await asyncio.to_thread(block_sites, d.get("sites", [])):
                                    st["note"] = "Bloqueio de sites exige rodar como admin/root"
                            elif d["t"] == "file":
                                asyncio.create_task(recv_file(d["name"], d["url"]))
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


def set_lock():
    """Cria/destrói a tela de bloqueio na thread do Tk (Tk não é thread-safe)."""
    global lockwin
    if st["lock"] and not lockwin:
        lockwin = tk.Toplevel(root, bg="#101828")
        lockwin.attributes("-fullscreen", True, "-topmost", True)
        tk.Label(lockwin, text="COMPUTADOR BLOQUEADO PELO SUPORTE", fg="white", bg="#101828", font=("", 28)).pack(expand=True)
        tk.Label(lockwin, text="Aguarde a liberação do técnico.", fg="#9fb3d0", bg="#101828", font=("", 16)).pack(pady=(0, 60))
        lockwin.bind("<Key>", lambda e: "break")   # engole o teclado
        lockwin.protocol("WM_DELETE_WINDOW", lambda: None)
        try:
            lockwin.grab_set_global()               # confina o mouse à tela de bloqueio
        except tk.TclError:
            lockwin.grab_set()
        lockwin.focus_force()
    elif not st["lock"] and lockwin:
        lockwin.destroy()
        lockwin = None


def tick():
    if not st["watch"] and st["allow"]:  # a permissão acaba quando o suporte sai
        st["allow"] = False
        send({"t": "allow", "on": False})
    set_lock()
    lbl.config(text="SUPORTE ESTÁ VENDO SUA TELA" + (" E CONTROLANDO" if st["allow"] else "") if st["watch"] else "Conectado ao suporte" if st["ws"] else "Sem conexão",
               fg="red" if st["watch"] else "black")
    btn.config(text="Revogar controle" if st["allow"] else "Permitir controle")
    note.config(text=st["note"])
    root.after(500, tick)


btn = tk.Button(root, command=toggle)
btn.pack(fill="x")
tk.Button(root, text="Pedir ajuda", command=ask).pack(fill="x")
note = tk.Label(root, fg="#555", wraplength=260)
note.pack()
threading.Thread(target=lambda: (asyncio.set_event_loop(loop), loop.run_until_complete(run())), daemon=True).start()
threading.Thread(target=kill_loop, daemon=True).start()
tick()
root.mainloop()
