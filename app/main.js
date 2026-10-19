// AulaCerta — processo principal Electron. Um app, dois papeis:
//  - Professor: hospeda o Servidor de Sala e abre o painel.
//  - Aluno: conecta na sala e exibe o overlay de bloqueio quando o professor manda.
// O papel vem da tela de escolha (ou de --aluno/--professor na linha de comando).

import { app, BrowserWindow, ipcMain, Notification, shell } from "electron";
import { fileURLToPath } from "node:url";
import { dirname, join, basename } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { iniciarSala, enderecoLan } from "../src/room-server.js";
import { conectarAluno } from "../src/student-agent.js";
import { criarVigia } from "../src/app-guard.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORTA = 4571;

let janelaBase = null; // escolha de papel / status do aluno
let janelaOverlay = null; // overlay de bloqueio do aluno
let agente = null;
let vigia = null; // vigia de aplicativos bloqueados
let ultimoAviso = 0; // evita enxurrada de notificacoes
let janelaQuiz = null; // janela de teste do aluno
let salaHttpBase = null; // base HTTP da sala, para baixar arquivos

function criarJanelaBase(arquivo, query = "") {
  const win = new BrowserWindow({
    width: 460,
    height: 560,
    resizable: false,
    title: "AulaCerta",
    backgroundColor: "#070c18",
    webPreferences: { preload: join(__dirname, "preload.js") },
  });
  win.setMenuBarVisibility(false);
  win.loadFile(join(__dirname, arquivo), query ? { search: query } : undefined);
  return win;
}

// ---- Papel: Professor ----
async function iniciarProfessor() {
  let port;
  try {
    ({ port } = await iniciarSala(PORTA, { dataDir: app.getPath("userData") }));
  } catch (e) {
    const { dialog } = await import("electron");
    dialog.showErrorBox(
      "AulaCerta",
      `Não foi possível iniciar a sala na porta ${PORTA}.\n` +
        (e?.code === "EADDRINUSE" ? "A porta já está em uso (outra sala aberta?)." : String(e?.message || e))
    );
    app.quit();
    return;
  }
  const ip = enderecoLan();
  if (janelaBase) janelaBase.close();
  janelaBase = new BrowserWindow({
    width: 1040,
    height: 720,
    minWidth: 720,
    minHeight: 480,
    title: "AulaCerta — Professor",
    backgroundColor: "#070c18",
  });
  janelaBase.setMenuBarVisibility(false);
  janelaBase.loadURL(`http://localhost:${port}/?ip=${encodeURIComponent(ip)}`);
}

// ---- Papel: Aluno ----
function iniciarAluno({ url, nome }) {
  salaHttpBase = url.replace(/^ws/i, "http");
  if (janelaBase) {
    janelaBase.loadFile(join(__dirname, "status.html"), {
      search: `?url=${encodeURIComponent(url)}&nome=${encodeURIComponent(nome)}`,
    });
  }
  agente = conectarAluno({
    url,
    nome,
    onComando: (m) => {
      if (m.t === "aplicar_bloqueio") mostrarOverlay(m.rotulo || "Bloqueio");
      else if (m.t === "remover_bloqueio") esconderOverlay();
      else if (m.t === "block_apps") ativarVigia(m.lista || []);
      else if (m.t === "allow_apps") pararVigia();
      else if (m.t === "aplicar_quiz") abrirQuiz(m.teste);
      else if (m.t === "remover_quiz") fecharQuiz();
      else if (m.t === "receber_link") abrirLink(m.url);
      else if (m.t === "receber_arquivo") baixarArquivo(m);
    },
  });
}

function abrirLink(url) {
  if (!/^https?:\/\//i.test(url || "")) return;
  shell.openExternal(url);
  if (Notification.isSupported())
    new Notification({ title: "AulaCerta", body: "O professor enviou um link." }).show();
}

async function baixarArquivo({ id, nome }) {
  try {
    const resp = await fetch(`${salaHttpBase}/arquivo/${id}`);
    if (!resp.ok) return;
    const buf = Buffer.from(await resp.arrayBuffer());
    const dir = join(app.getPath("downloads"), "AulaCerta");
    await mkdir(dir, { recursive: true });
    const destino = join(dir, basename(nome || "arquivo"));
    await writeFile(destino, buf);
    if (Notification.isSupported()) {
      const n = new Notification({ title: "AulaCerta", body: `Arquivo recebido: ${basename(nome)}` });
      n.on("click", () => shell.showItemInFolder(destino));
      n.show();
    }
  } catch {
    /* envio falhou; aluno pode pedir reenvio ao professor */
  }
}

function abrirQuiz(teste) {
  if (!janelaQuiz) {
    janelaQuiz = new BrowserWindow({
      width: 720,
      height: 660,
      minWidth: 420,
      title: "AulaCerta — Teste",
      backgroundColor: "#070c18",
      alwaysOnTop: true,
      webPreferences: { preload: join(__dirname, "preload.js") },
    });
    janelaQuiz.setMenuBarVisibility(false);
    janelaQuiz.on("closed", () => { janelaQuiz = null; });
  }
  janelaQuiz.loadFile(join(__dirname, "..", "aluno", "quiz.html"));
  janelaQuiz.webContents.once("did-finish-load", () => {
    janelaQuiz?.webContents.send("quiz-teste", teste);
  });
  janelaQuiz.show();
  janelaQuiz.focus();
}

function fecharQuiz() {
  if (janelaQuiz) { janelaQuiz.destroy(); janelaQuiz = null; }
}

ipcMain.on("quiz-responder", (_ev, payload) => {
  agente?.enviar("enviar_resposta", payload);
  // A janela permanece mostrando a confirmacao; o professor encerra o teste.
});

function ativarVigia(lista) {
  if (!vigia) {
    vigia = criarVigia({ lista, onBloqueado: avisarBloqueioApp });
  } else {
    vigia.atualizar(lista);
  }
}

function pararVigia() {
  vigia?.parar();
  vigia = null;
}

function avisarBloqueioApp(imagem) {
  const agora = Date.now();
  if (agora - ultimoAviso < 4000 || !Notification.isSupported()) return; // no maximo 1 aviso/4s
  ultimoAviso = agora;
  new Notification({
    title: "AulaCerta",
    body: `O aplicativo "${imagem}" foi bloqueado pelo professor durante a aula.`,
  }).show();
}

function mostrarOverlay(rotulo) {
  if (!janelaOverlay) {
    janelaOverlay = new BrowserWindow({
      fullscreen: true,
      frame: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      closable: false,
      minimizable: false,
      backgroundColor: "#070c18",
      webPreferences: {},
    });
    janelaOverlay.setAlwaysOnTop(true, "screen-saver");
    janelaOverlay.on("close", (e) => e.preventDefault()); // aluno nao fecha o overlay
  }
  janelaOverlay.loadFile(join(__dirname, "..", "aluno", "overlay.html"), {
    search: `?rotulo=${encodeURIComponent(rotulo)}`,
  });
  janelaOverlay.show();
  janelaOverlay.setAlwaysOnTop(true, "screen-saver");
  janelaOverlay.focus();
}

function esconderOverlay() {
  if (janelaOverlay) janelaOverlay.hide();
}

// ---- IPC da tela de escolha ----
ipcMain.on("escolher-papel", (_ev, payload) => {
  if (payload?.papel === "professor") iniciarProfessor();
  else if (payload?.papel === "aluno") iniciarAluno({ url: payload.url, nome: payload.nome });
});

app.whenReady().then(() => {
  const argv = process.argv.slice(1);
  if (argv.includes("--professor")) iniciarProfessor();
  else if (argv.includes("--aluno")) criarJanelaBase("chooser.html", "papel=aluno");
  else janelaBase = criarJanelaBase("chooser.html");

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0 && !agente) janelaBase = criarJanelaBase("chooser.html");
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
