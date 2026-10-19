// Servidor de Sala: hospeda o painel do professor (HTTP) e o canal de tempo real (WebSocket).
// Rastreia alunos conectados e transmite o roster para os paines de professor.
// Etapa 1 do plano: conexao professor<->aluno com status em tempo real.

import http from "node:http";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { WebSocketServer } from "ws";
import { MSG, msg, parse, rotuloDoModo } from "../shared/protocol.js";
import { criarAcervo, ErroAcervo } from "./test-store.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PANEL = join(__dirname, "..", "professor", "panel.html");
const PROTOCOLO = join(__dirname, "..", "shared", "protocol.js");

function responderJson(res, status, obj) {
  const corpo = JSON.stringify(obj);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(corpo);
}
const MAX_ARQUIVO = 25 * 1024 * 1024; // 25 MB por envio
const MAX_ARQUIVOS = 10; // mantem os ultimos N na memoria

function lerCorpoBinario(req, limite = MAX_ARQUIVO) {
  return new Promise((resolve, reject) => {
    const partes = [];
    let tam = 0;
    req.on("data", (c) => {
      tam += c.length;
      if (tam > limite) reject(new Error("arquivo grande demais"));
      else partes.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(partes)));
    req.on("error", reject);
  });
}
function lerCorpo(req, limite = 256 * 1024) {
  return new Promise((resolve, reject) => {
    let dados = "";
    req.on("data", (c) => {
      dados += c;
      if (dados.length > limite) reject(new Error("corpo grande demais"));
    });
    req.on("end", () => {
      try { resolve(dados ? JSON.parse(dados) : {}); }
      catch { reject(new Error("json invalido")); }
    });
    req.on("error", reject);
  });
}

const PING_MS = 3000; // batimento
const OFFLINE_MS = 8000; // sem pong por este tempo => offline

// Sobe o servidor. Retorna { server, wss, close } para uso em testes e no CLI.
// dataDir: onde o acervo de testes e gravado (userData no app; ./.data no CLI).
export function iniciarSala(porta = 0, { dataDir = join(process.cwd(), ".data") } = {}) {
  const acervo = criarAcervo(dataDir);
  const alunos = new Map(); // id -> { id, nome, host, online, visto_em, sock }
  const professores = new Set(); // sockets dos paineis
  let proximoId = 1;
  // Estado da aula (vale para toda a sala).
  const aula = { bloqueado: false, modo: null, rotulo: null, travaApps: false, apps: [] };
  // Quiz ao vivo: null ou { teste (com gabarito), respostas: Map(alunoId -> resultado) }.
  let quizAtual = null;
  // Arquivos enviados, em memoria: id -> { nome, tipo, bytes }. Mantem os ultimos N.
  const arquivos = new Map();

  const semGabarito = (teste) => ({
    id: teste.id,
    nome: teste.nome,
    questoes: teste.questoes.map((q) => ({ ordem: q.ordem, tipo: q.tipo, enunciado: q.enunciado, opcoes: q.opcoes })),
  });
  function quizPayload() {
    if (!quizAtual) return { ativo: false };
    const totalObjetivas = quizAtual.teste.questoes.filter((q) => q.tipo === "objetiva").length;
    return {
      ativo: true,
      teste: quizAtual.teste, // completo (so o professor recebe o roster)
      totalObjetivas,
      respostas: [...quizAtual.respostas.entries()].map(([alunoId, r]) => ({ alunoId, ...r })),
    };
  }

  const httpServer = http.createServer(async (req, res) => {
    if (req.url === "/" || req.url === "/panel.html") {
      try {
        const html = await readFile(PANEL);
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(html);
      } catch {
        res.writeHead(500).end("painel indisponivel");
      }
      return;
    }
    if (req.url === "/shared/protocol.js") {
      try {
        const js = await readFile(PROTOCOLO);
        res.writeHead(200, { "content-type": "text/javascript; charset=utf-8" });
        res.end(js);
      } catch {
        res.writeHead(500).end("protocolo indisponivel");
      }
      return;
    }
    // ---- Envio de arquivos ----
    if (req.url === "/api/enviar-arquivo" && req.method === "POST") {
      try {
        const bytes = await lerCorpoBinario(req);
        if (bytes.length === 0) return responderJson(res, 400, { erro: "arquivo vazio" });
        const nome = decodeURIComponent(req.headers["x-nome-arquivo"] || "arquivo").slice(0, 160);
        const tipo = req.headers["content-type"] || "application/octet-stream";
        const id = randomUUID();
        arquivos.set(id, { nome, tipo, bytes });
        while (arquivos.size > MAX_ARQUIVOS) arquivos.delete(arquivos.keys().next().value);
        enviarAosAlunos(msg(MSG.RECEBER_ARQUIVO, { id, nome, tamanho: bytes.length }));
        return responderJson(res, 200, { id, enviados: alunos.size });
      } catch (e) {
        return responderJson(res, 413, { erro: e.message });
      }
    }
    const mArq = req.url.match(/^\/arquivo\/([^/?]+)/);
    if (mArq && req.method === "GET") {
      const a = arquivos.get(decodeURIComponent(mArq[1]));
      if (!a) {
        res.writeHead(404).end("arquivo nao encontrado");
        return;
      }
      res.writeHead(200, {
        "content-type": a.tipo,
        "content-length": a.bytes.length,
        "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(a.nome)}`,
      });
      res.end(a.bytes);
      return;
    }
    // ---- API REST do acervo de testes ----
    if (req.url === "/api/testes" && req.method === "GET") {
      return responderJson(res, 200, acervo.listar());
    }
    if (req.url === "/api/testes" && req.method === "POST") {
      try {
        const teste = await lerCorpo(req);
        return responderJson(res, 200, acervo.salvar(teste));
      } catch (e) {
        const status = e instanceof ErroAcervo ? (e.codigo === "estoque_cheio" ? 409 : 400) : 400;
        return responderJson(res, status, { erro: e.message, codigo: e.codigo });
      }
    }
    const mTeste = req.url.match(/^\/api\/testes\/([^/]+)$/);
    if (mTeste) {
      const id = decodeURIComponent(mTeste[1]);
      if (req.method === "GET") {
        const t = acervo.obter(id);
        return t ? responderJson(res, 200, t) : responderJson(res, 404, { erro: "nao encontrado" });
      }
      if (req.method === "DELETE") {
        try { acervo.excluir(id); return responderJson(res, 200, { ok: true }); }
        catch (e) { return responderJson(res, 404, { erro: e.message }); }
      }
    }
    res.writeHead(404).end("nao encontrado");
  });

  const wss = new WebSocketServer({ server: httpServer });

  function rosterPayload() {
    return msg(MSG.ROSTER, {
      alunos: [...alunos.values()].map(({ sock, tela, ...pub }) => pub),
      aula: { ...aula },
      quiz: quizPayload(),
    });
  }

  function transmitirRoster() {
    const payload = rosterPayload();
    for (const p of professores) if (p.readyState === p.OPEN) p.send(payload);
  }

  function enviarAosAlunos(payload) {
    for (const a of alunos.values())
      if (a.sock.readyState === a.sock.OPEN) a.sock.send(payload);
  }

  wss.on("connection", (sock) => {
    let papel = null; // "aluno" | "professor"
    let alunoId = null;

    sock.on("message", (dados) => {
      const m = parse(dados);
      if (!m) return; // mensagem invalida: ignora

      if (m.t === MSG.HELLO_ALUNO) {
        papel = "aluno";
        alunoId = String(proximoId++);
        alunos.set(alunoId, {
          id: alunoId,
          nome: String(m.nome || "Aluno").slice(0, 60),
          host: String(m.host || "").slice(0, 60),
          online: true,
          visto_em: Date.now(),
          sock,
        });
        sock.send(msg(MSG.WELCOME, { id: alunoId }));
        // Aluno que entra durante um bloqueio ja recebe o estado atual.
        if (aula.bloqueado)
          sock.send(msg(MSG.APLICAR_BLOQUEIO, { modo: aula.modo, rotulo: aula.rotulo }));
        if (aula.travaApps) sock.send(msg(MSG.BLOCK_APPS, { lista: aula.apps }));
        if (quizAtual) sock.send(msg(MSG.APLICAR_QUIZ, { teste: semGabarito(quizAtual.teste) }));
        transmitirRoster();
      } else if (m.t === MSG.PONG && alunoId) {
        const a = alunos.get(alunoId);
        if (a) {
          a.visto_em = Date.now();
          if (!a.online) {
            a.online = true;
            transmitirRoster();
          }
        }
      } else if (m.t === MSG.ENVIAR_RESPOSTA && alunoId && quizAtual && m.testeId === quizAtual.teste.id) {
        const a = alunos.get(alunoId);
        const respostas = Array.isArray(m.respostas) ? m.respostas : [];
        let acertos = 0;
        quizAtual.teste.questoes.forEach((q, i) => {
          if (q.tipo === "objetiva" && Number(respostas[i]) === q.correta) acertos++;
        });
        quizAtual.respostas.set(alunoId, {
          nome: a ? a.nome : "Aluno",
          acertos,
          respostas,
          enviadoEm: Date.now(),
        });
        transmitirRoster();
      } else if (m.t === MSG.TELA && alunoId) {
        const a = alunos.get(alunoId);
        if (a && typeof m.jpeg === "string" && m.jpeg.length < 400000) {
          a.tela = m.jpeg;
          a.visto_em = Date.now();
          const payload = msg(MSG.TELA_ALUNO, { id: alunoId, jpeg: m.jpeg });
          for (const p of professores) if (p.readyState === p.OPEN) p.send(payload);
        }
      } else if (m.t === MSG.HELLO_PROFESSOR) {
        papel = "professor";
        professores.add(sock);
        sock.send(rosterPayload());
        // Miniaturas que ja temos, para o professor que acabou de entrar.
        for (const a of alunos.values())
          if (a.tela) sock.send(msg(MSG.TELA_ALUNO, { id: a.id, jpeg: a.tela }));
      } else if (m.t === MSG.LOCK && papel === "professor") {
        const modo = m.modo === "reservado" ? "reservado" : "bloqueio";
        aula.bloqueado = true;
        aula.modo = modo;
        aula.rotulo = rotuloDoModo(modo);
        enviarAosAlunos(msg(MSG.APLICAR_BLOQUEIO, { modo, rotulo: aula.rotulo }));
        transmitirRoster();
      } else if (m.t === MSG.UNLOCK && papel === "professor") {
        aula.bloqueado = false;
        aula.modo = null;
        aula.rotulo = null;
        enviarAosAlunos(msg(MSG.REMOVER_BLOQUEIO));
        transmitirRoster();
      } else if (m.t === MSG.BLOCK_APPS && papel === "professor") {
        const lista = Array.isArray(m.lista)
          ? m.lista.map((n) => String(n).trim().slice(0, 80)).filter(Boolean).slice(0, 50)
          : [];
        aula.travaApps = lista.length > 0;
        aula.apps = lista;
        enviarAosAlunos(msg(aula.travaApps ? MSG.BLOCK_APPS : MSG.ALLOW_APPS, { lista }));
        transmitirRoster();
      } else if (m.t === MSG.ALLOW_APPS && papel === "professor") {
        aula.travaApps = false;
        aula.apps = [];
        enviarAosAlunos(msg(MSG.ALLOW_APPS));
        transmitirRoster();
      } else if (m.t === MSG.START_QUIZ && papel === "professor") {
        const teste = acervo.obter(String(m.testeId || ""));
        if (teste) {
          quizAtual = { teste, respostas: new Map() };
          enviarAosAlunos(msg(MSG.APLICAR_QUIZ, { teste: semGabarito(teste) }));
          transmitirRoster();
        }
      } else if (m.t === MSG.END_QUIZ && papel === "professor") {
        quizAtual = null;
        enviarAosAlunos(msg(MSG.REMOVER_QUIZ));
        transmitirRoster();
      } else if (m.t === MSG.SEND_LINK && papel === "professor") {
        const url = String(m.url || "").slice(0, 2000);
        if (/^https?:\/\//i.test(url)) enviarAosAlunos(msg(MSG.RECEBER_LINK, { url }));
      }
    });

    sock.on("close", () => {
      if (papel === "aluno" && alunoId && alunos.has(alunoId)) {
        alunos.delete(alunoId);
        transmitirRoster();
      } else if (papel === "professor") {
        professores.delete(sock);
      }
    });
    sock.on("error", () => {}); // nao derruba o servidor por socket defeituoso
  });

  // Batimento: marca offline quem parou de responder (sem removel-o da lista).
  const ping = setInterval(() => {
    const agora = Date.now();
    let mudou = false;
    for (const a of alunos.values()) {
      if (a.sock.readyState === a.sock.OPEN) a.sock.send(msg(MSG.PING));
      if (a.online && agora - a.visto_em > OFFLINE_MS) {
        a.online = false;
        mudou = true;
      }
    }
    if (mudou) transmitirRoster();
  }, PING_MS);
  ping.unref?.();

  return new Promise((resolve, reject) => {
    httpServer.once("error", reject); // ex.: porta ocupada -> rejeita em vez de travar
    httpServer.listen(porta, () => {
      httpServer.removeListener("error", reject);
      const { port } = httpServer.address();
      resolve({
        port,
        close: () =>
          new Promise((r) => {
            clearInterval(ping);
            wss.close(() => {
              httpServer.close(() => r());
              httpServer.closeAllConnections?.(); // encerra conexoes keep-alive (ex.: fetch)
            });
          }),
      });
    });
  });
}

// CLI: `npm run sala`
if (import.meta.main) {
  const porta = Number(process.env.PORTA || 4571);
  const { port } = await iniciarSala(porta);
  const ip = enderecoLan();
  console.log(`Sala no ar.`);
  console.log(`  Painel do professor: http://localhost:${port}`);
  console.log(`  Alunos conectam em:  ws://${ip}:${port}`);
}

export function enderecoLan() {
  // Melhor IPv4 nao-interno para informar aos alunos na LAN.
  const nets = Object.values(os.networkInterfaces()).flat();
  const lan = nets.find((n) => n && n.family === "IPv4" && !n.internal);
  return lan ? lan.address : "localhost";
}
