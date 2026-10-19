// Ponte segura entre a tela de escolha e o processo principal.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("aulacerta", {
  escolher: (payload) => ipcRenderer.send("escolher-papel", payload),
  // Quiz do aluno
  onTeste: (cb) => ipcRenderer.on("quiz-teste", (_ev, teste) => cb(teste)),
  responder: (payload) => ipcRenderer.send("quiz-responder", payload),
});
