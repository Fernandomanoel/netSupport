// Teste de fumaca da Etapa 1: um aluno conecta e o professor o ve no roster em tempo real;
// ao desconectar o aluno, ele some do roster.

import { test } from "node:test";
import assert from "node:assert/strict";
import WebSocket from "ws";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { iniciarSala } from "../src/room-server.js";
import { conectarAluno } from "../src/student-agent.js";
import { criarVigia } from "../src/app-guard.js";
import { criarAcervo } from "../src/test-store.js";
import { MSG, msg, parse } from "../shared/protocol.js";

// Espera a proxima mensagem (qualquer tipo) que satisfaca cond; resolve com a mensagem.
function esperarMsg(ws, cond, ms = 4000) {
  return new Promise((resolve, reject) => {
    const prazo = setTimeout(() => reject(new Error("timeout esperando mensagem")), ms);
    ws.on("message", (d) => {
      const m = parse(d);
      if (m && cond(m)) { clearTimeout(prazo); resolve(m); }
    });
  });
}

// Espera o proximo ROSTER que satisfaca `cond`, com timeout.
function esperarRoster(ws, cond, ms = 4000) {
  return new Promise((resolve, reject) => {
    const prazo = setTimeout(() => reject(new Error("timeout esperando roster")), ms);
    ws.on("message", (d) => {
      const m = parse(d);
      if (m && m.t === MSG.ROSTER && cond(m.alunos)) {
        clearTimeout(prazo);
        resolve(m.alunos);
      }
    });
  });
}

test("aluno aparece e some do roster do professor", async () => {
  const sala = await iniciarSala(0);
  const urlWs = `ws://localhost:${sala.port}`;

  // Professor conecta como painel.
  const prof = new WebSocket(urlWs);
  await new Promise((r) => prof.on("open", r));
  prof.send(msg(MSG.HELLO_PROFESSOR));

  // Aluno entra.
  const aluno = conectarAluno({ url: urlWs, nome: "Ana", host: "PC-01" });
  const comAna = await esperarRoster(prof, (as) => as.some((a) => a.nome === "Ana" && a.online));
  assert.equal(comAna.filter((a) => a.nome === "Ana").length, 1, "um unico registro da Ana");

  // Aluno sai.
  aluno.close();
  const semAna = await esperarRoster(prof, (as) => !as.some((a) => a.nome === "Ana"));
  assert.ok(!semAna.some((a) => a.nome === "Ana"), "Ana saiu do roster");

  prof.close();
  await sala.close();
});

test("professor bloqueia e libera a tela do aluno", async () => {
  const sala = await iniciarSala(0);
  const urlWs = `ws://localhost:${sala.port}`;

  const prof = new WebSocket(urlWs);
  await new Promise((r) => prof.on("open", r));
  prof.send(msg(MSG.HELLO_PROFESSOR));

  // Aluno com fila de comandos recebidos.
  const comandos = [];
  let aguardando = null;
  const aluno = conectarAluno({
    url: urlWs,
    nome: "Caio",
    onComando: (m) => { comandos.push(m); aguardando?.(); },
  });
  const proximoComando = () => new Promise((r) => (aguardando = r));

  // Espera o aluno entrar.
  await esperarRoster(prof, (as) => as.some((a) => a.nome === "Caio"));

  // Bloqueia no modo "reservado".
  prof.send(msg(MSG.LOCK, { modo: "reservado" }));
  await proximoComando();
  const lock = comandos.at(-1);
  assert.equal(lock.t, "aplicar_bloqueio");
  assert.equal(lock.rotulo, "Reservado");

  // Libera.
  prof.send(msg(MSG.UNLOCK));
  await proximoComando();
  assert.equal(comandos.at(-1).t, "remover_bloqueio");

  aluno.close();
  prof.close();
  await sala.close();
});

test("vigia encerra apenas apps da lista e avisa", async () => {
  const mortos = [];
  const avisados = [];
  const bloqueado = new Promise((r) => {
    const v = criarVigia({
      lista: ["chrome.exe"],
      intervalo: 50,
      listar: async () => ["chrome.exe", "notepad.exe"],
      matar: async (img) => { mortos.push(img); },
      onBloqueado: (img) => { avisados.push(img); r(v); },
    });
  });
  const v = await bloqueado;
  v.parar();
  assert.deepEqual(mortos, ["chrome.exe"], "so o app da lista foi encerrado");
  assert.deepEqual(avisados, ["chrome.exe"]);
});

test("professor bloqueia e libera apps do aluno", async () => {
  const sala = await iniciarSala(0);
  const urlWs = `ws://localhost:${sala.port}`;

  const prof = new WebSocket(urlWs);
  await new Promise((r) => prof.on("open", r));
  prof.send(msg(MSG.HELLO_PROFESSOR));

  const comandos = [];
  let aguardando = null;
  const aluno = conectarAluno({
    url: urlWs,
    nome: "Duda",
    onComando: (m) => { comandos.push(m); aguardando?.(); },
  });
  const proximo = () => new Promise((r) => (aguardando = r));

  await esperarRoster(prof, (as) => as.some((a) => a.nome === "Duda"));

  prof.send(msg(MSG.BLOCK_APPS, { lista: ["steam.exe", "chrome.exe"] }));
  await proximo();
  const bloq = comandos.at(-1);
  assert.equal(bloq.t, "block_apps");
  assert.deepEqual(bloq.lista, ["steam.exe", "chrome.exe"]);

  prof.send(msg(MSG.ALLOW_APPS));
  await proximo();
  assert.equal(comandos.at(-1).t, "allow_apps");

  aluno.close();
  prof.close();
  await sala.close();
});

test("quiz ao vivo: aplica sem gabarito, corrige e devolve ao professor", async () => {
  const dir = mkdtempSync(join(tmpdir(), "aulacerta-quiz-"));
  const acervo = criarAcervo(dir);
  const teste = acervo.salvar({
    nome: "Q",
    questoes: [
      { tipo: "objetiva", enunciado: "2+2?", opcoes: ["3", "4"], correta: 1 },
      { tipo: "dissertativa", enunciado: "por quê?" },
    ],
  });

  const sala = await iniciarSala(0, { dataDir: dir });
  const urlWs = `ws://localhost:${sala.port}`;

  const prof = new WebSocket(urlWs);
  await new Promise((r) => prof.on("open", r));
  prof.send(msg(MSG.HELLO_PROFESSOR));

  let ultimoQuiz = null;
  let aguardando = null;
  const aluno = conectarAluno({
    url: urlWs, nome: "Eli",
    onComando: (m) => { ultimoQuiz = m; aguardando?.(); },
  });
  const proximo = () => new Promise((r) => (aguardando = r));

  await esperarMsg(prof, (m) => m.t === MSG.ROSTER && m.alunos.some((a) => a.nome === "Eli"));

  // Aplica o teste.
  prof.send(msg(MSG.START_QUIZ, { testeId: teste.id }));
  await proximo();
  assert.equal(ultimoQuiz.t, "aplicar_quiz");
  assert.equal(ultimoQuiz.teste.questoes[0].correta, undefined, "aluno nao recebe o gabarito");

  // Responde (acerta a objetiva).
  aluno.enviar(MSG.ENVIAR_RESPOSTA, { testeId: teste.id, respostas: [1, "porque sim"] });

  const comResultado = await esperarMsg(
    prof,
    (m) => m.t === MSG.ROSTER && m.quiz.ativo && m.quiz.respostas.some((r) => r.nome === "Eli")
  );
  const r = comResultado.quiz.respostas.find((x) => x.nome === "Eli");
  assert.equal(r.acertos, 1, "1 acerto na objetiva");
  assert.equal(r.respostas[1], "porque sim");

  // Encerra.
  prof.send(msg(MSG.END_QUIZ));
  await proximo();
  assert.equal(ultimoQuiz.t, "remover_quiz");

  aluno.close();
  prof.close();
  await sala.close();
});

test("professor envia link e aluno recebe", async () => {
  const sala = await iniciarSala(0);
  const urlWs = `ws://localhost:${sala.port}`;
  const prof = new WebSocket(urlWs);
  await new Promise((r) => prof.on("open", r));
  prof.send(msg(MSG.HELLO_PROFESSOR));

  let ultimo = null, aguardando = null;
  const aluno = conectarAluno({ url: urlWs, nome: "Fil", onComando: (m) => { ultimo = m; aguardando?.(); } });
  const proximo = () => new Promise((r) => (aguardando = r));
  await esperarMsg(prof, (m) => m.t === MSG.ROSTER && m.alunos.some((a) => a.nome === "Fil"));

  prof.send(msg(MSG.SEND_LINK, { url: "https://exemplo.com/aula" }));
  await proximo();
  assert.equal(ultimo.t, "receber_link");
  assert.equal(ultimo.url, "https://exemplo.com/aula");

  aluno.close(); prof.close(); await sala.close();
});

test("upload de arquivo: aluno e avisado e consegue baixar", async () => {
  const sala = await iniciarSala(0);
  const base = `http://localhost:${sala.port}`;
  const prof = new WebSocket(`ws://localhost:${sala.port}`);
  await new Promise((r) => prof.on("open", r));
  prof.send(msg(MSG.HELLO_PROFESSOR));

  let ultimo = null, aguardando = null;
  const aluno = conectarAluno({ url: `ws://localhost:${sala.port}`, nome: "Gal", onComando: (m) => { ultimo = m; aguardando?.(); } });
  const proximo = () => new Promise((r) => (aguardando = r));
  await esperarMsg(prof, (m) => m.t === MSG.ROSTER && m.alunos.some((a) => a.nome === "Gal"));

  const conteudo = "material da aula\n";
  const recebido = new Promise((res) => (aguardando = res)); // registra antes do disparo (evita corrida)
  const r = await fetch(`${base}/api/enviar-arquivo`, {
    method: "POST",
    headers: { "content-type": "text/plain", "x-nome-arquivo": encodeURIComponent("aula.txt") },
    body: conteudo,
  });
  const d = await r.json();
  assert.ok(d.id);

  await recebido;
  assert.equal(ultimo.t, "receber_arquivo");
  assert.equal(ultimo.nome, "aula.txt");

  const baixado = await (await fetch(`${base}/arquivo/${ultimo.id}`)).text();
  assert.equal(baixado, conteudo, "bytes baixados batem com o enviado");

  aluno.close(); prof.close(); await sala.close();
});

test("miniatura de tela do aluno chega ao professor", async () => {
  const sala = await iniciarSala(0);
  const urlWs = `ws://localhost:${sala.port}`;
  const prof = new WebSocket(urlWs);
  await new Promise((r) => prof.on("open", r));
  prof.send(msg(MSG.HELLO_PROFESSOR));

  const aluno = conectarAluno({ url: urlWs, nome: "Ian" });
  await esperarMsg(prof, (m) => m.t === MSG.ROSTER && m.alunos.some((a) => a.nome === "Ian"));

  const espera = esperarMsg(prof, (m) => m.t === MSG.TELA_ALUNO);
  aluno.enviar(MSG.TELA, { jpeg: "QUFBQQ==" });
  const m = await espera;
  assert.equal(m.jpeg, "QUFBQQ==");
  assert.ok(m.id);
  // Um novo professor recebe a miniatura ja guardada ao entrar.
  const prof2 = new WebSocket(urlWs);
  await new Promise((r) => prof2.on("open", r));
  const esperaRoster = esperarMsg(prof2, (x) => x.t === MSG.ROSTER);
  const esperaTela = esperarMsg(prof2, (x) => x.t === MSG.TELA_ALUNO); // registra antes do HELLO
  prof2.send(msg(MSG.HELLO_PROFESSOR));
  const rosterP2 = await esperaRoster;
  assert.ok(rosterP2.alunos.every((a) => a.tela === undefined), "roster nao carrega a imagem");
  const telaGuardada = await esperaTela;
  assert.equal(telaGuardada.jpeg, "QUFBQQ==", "professor novo recebe a miniatura atual");

  prof2.close(); aluno.close(); prof.close(); await sala.close();
});
