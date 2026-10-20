// Ponte segura entre a tela de escolha e o processo principal.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("aulacerta", {
  escolher: (payload) => ipcRenderer.send("escolher-papel", payload),
  // Quiz do aluno
  onTeste: (cb) => ipcRenderer.on("quiz-teste", (_ev, teste) => cb(teste)),
  responder: (payload) => ipcRenderer.send("quiz-responder", payload),
  // Setup inicial (papel + senha)
  setupConcluir: (payload) => ipcRenderer.send("setup-concluir", payload),
  onSetupErro: (cb) => ipcRenderer.on("setup-erro", (_ev, msg) => cb(msg)),
  // Senha do professor (abertura)
  senhaEntrar: (pwd) => ipcRenderer.send("senha-entrar", pwd),
  onSenhaErro: (cb) => ipcRenderer.on("senha-erro", (_ev, msg) => cb(msg)),
  // Aluno: pedir ajuda
  alunoAjuda: (pedindo) => ipcRenderer.send("aluno-ajuda", pedindo),
});
