// AulaCerta — processo principal Electron. Um app, dois papeis:
//  - Professor: hospeda o Servidor de Sala e abre o painel.
//  - Aluno: conecta na sala e exibe o overlay de bloqueio quando o professor manda.
// O papel vem da tela de escolha (ou de --aluno/--professor na linha de comando).

import { app, BrowserWindow, ipcMain, Notification, shell, desktopCapturer } from "electron";
import { fileURLToPath } from "node:url";
import { dirname, join, basename } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
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
let capturaTimer = null; // envio periodico da miniatura de tela

function criarJanelaBase(arquivo, query = "") {
  const win = new BrowserWindow({
    width: 460,
    height: 560,
    resizable: false,
    title: "AulaCerta",
    backgroundColor: "#ffffff",
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
    backgroundColor: "#ffffff",
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
  iniciarCaptura();
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
      else if (m.t === "receber_mensagem") mostrarMensagem(m.texto);
    },
  });
}

let janelaMensagem = null;
function mostrarMensagem(texto) {
  if (!texto) return;
  if (janelaMensagem && !janelaMensagem.isDestroyed()) janelaMensagem.close();
  janelaMensagem = new BrowserWindow({
    width: 480, height: 230, frame: false, alwaysOnTop: true, skipTaskbar: true,
    resizable: false, backgroundColor: "#ffffff",
    webPreferences: { preload: join(__dirname, "preload.js") },
  });
  janelaMensagem.setAlwaysOnTop(true, "screen-saver");
  janelaMensagem.loadFile(join(__dirname, "mensagem.html"), { search: `?t=${encodeURIComponent(texto)}` });
  janelaMensagem.show();
}

// Aluno levanta/baixa a mao (pedir ajuda).
ipcMain.on("aluno-ajuda", (_ev, pedindo) => agente?.enviar("ajuda", { pedindo: !!pedindo }));

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
      backgroundColor: "#ffffff",
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

// Captura uma miniatura da tela do aluno periodicamente e envia ao servidor.
// Transparente: o aluno e avisado na tela de status que isso acontece durante a aula.
function iniciarCaptura() {
  if (capturaTimer) return;
  const tick = async () => {
    try {
      const fontes = await desktopCapturer.getSources({
        types: ["screen"],
        thumbnailSize: { width: 320, height: 180 },
      });
      const img = fontes[0]?.thumbnail;
      if (img && !img.isEmpty()) agente?.enviar("tela", { jpeg: img.toJPEG(55).toString("base64") });
    } catch {
      /* captura indisponivel neste ciclo */
    }
  };
  tick();
  capturaTimer = setInterval(tick, 4000);
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
      backgroundColor: "#ffffff",
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

// ---- Configuracao inicial (papel + senha) e roteamento ----
// setup.json em userData guarda { papel, senhaHash }. Definido uma vez na 1a execucao;
// o app NAO oferece troca de papel depois. Para reconfigurar: reinstalar/limpar a config.
const setupArquivo = () => join(app.getPath("userData"), "setup.json");
const hashSenha = (s) => createHash("sha256").update(String(s)).digest("hex");
function lerSetup() {
  try { return JSON.parse(readFileSync(setupArquivo(), "utf8")); } catch { return null; }
}
// role.txt (opcional, para implantacao em massa pela TI) forca o papel.
function papelForcado() {
  try {
    const r = readFileSync(join(__dirname, "..", "role.txt"), "utf8").trim().toLowerCase();
    return r === "professor" || r === "aluno" ? r : null;
  } catch { return null; }
}

// Setup da 1a execucao: escolhe o papel e (professor) define a senha.
ipcMain.on("setup-concluir", (ev, payload) => {
  const papel = payload?.papel === "professor" ? "professor" : payload?.papel === "aluno" ? "aluno" : null;
  if (!papel) return;
  if (papel === "professor") {
    const s = String(payload.senha || "");
    if (s.length < 4) { ev.sender.send("setup-erro", "A senha precisa de ao menos 4 caracteres."); return; }
    try { writeFileSync(setupArquivo(), JSON.stringify({ papel, senhaHash: hashSenha(s) })); }
    catch { ev.sender.send("setup-erro", "Não foi possível salvar a configuração."); return; }
    iniciarProfessor();
  } else {
    try { writeFileSync(setupArquivo(), JSON.stringify({ papel })); } catch {}
    entrarAluno();
  }
});

// Professor configurado: exige a senha a cada abertura.
function fluxoProfessor() {
  if (janelaBase && !janelaBase.isDestroyed()) janelaBase.close();
  janelaBase = criarJanelaBase("senha.html");
}
ipcMain.on("senha-entrar", (ev, pwd) => {
  const cfg = lerSetup();
  if (cfg?.senhaHash && cfg.senhaHash === hashSenha(pwd)) iniciarProfessor();
  else ev.sender.send("senha-erro", "Senha incorreta.");
});

// Aluno: abre direto o formulario de conexao, sem opcao de virar professor.
function entrarAluno() {
  if (janelaBase && !janelaBase.isDestroyed()) janelaBase.close();
  janelaBase = criarJanelaBase("chooser.html", "papel=aluno&lock=1");
}
ipcMain.on("escolher-papel", (_ev, payload) => {
  if (payload?.papel === "aluno") iniciarAluno({ url: payload.url, nome: payload.nome });
});

function rotear() {
  const papel = papelForcado() || lerSetup()?.papel || null;
  if (papel === "professor") fluxoProfessor();
  else if (papel === "aluno") entrarAluno();
  else janelaBase = criarJanelaBase("setup.html"); // 1a execucao
}

app.whenReady().then(() => {
  rotear();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0 && !agente) rotear();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
