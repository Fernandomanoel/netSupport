// Ponte segura entre a tela de escolha e o processo principal.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("aulacerta", {
  escolher: (payload) => ipcRenderer.send("escolher-papel", payload),
  // Quiz do aluno
  onTeste: (cb) => ipcRenderer.on("quiz-teste", (_ev, teste) => cb(teste)),
  responder: (payload) => ipcRenderer.send("quiz-responder", payload),
  // Senha do professor
  senhaDefinida: () => ipcRenderer.invoke("senha-definida"),
  senhaDefinir: (pwd) => ipcRenderer.send("senha-definir", pwd),
  senhaEntrar: (pwd) => ipcRenderer.send("senha-entrar", pwd),
  onSenhaErro: (cb) => ipcRenderer.on("senha-erro", (_ev, msg) => cb(msg)),
});
