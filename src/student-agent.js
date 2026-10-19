// Agente do Aluno: conecta ao Servidor de Sala na LAN, se registra e responde ao batimento.
// Etapa 1: so presenca/status. Overlay de bloqueio e controle de apps vem nas etapas 2-3.
// Reconecta sozinho se a sala cair.

import os from "node:os";
import WebSocket from "ws";
import { MSG, msg, parse } from "../shared/protocol.js";

// Conecta a ws://host:porta. Retorna { close } e mantem a conexao viva.
// onComando(m) recebe comandos do servidor (ex.: aplicar/remover bloqueio).
export function conectarAluno({
  url,
  nome = os.hostname(),
  host = os.hostname(),
  onComando = () => {},
} = {}) {
  let ws = null;
  let fechado = false;
  let tentarDeNovo = null;

  function abrir() {
    if (fechado) return;
    ws = new WebSocket(url);

    ws.on("open", () => ws.send(msg(MSG.HELLO_ALUNO, { nome, host })));

    ws.on("message", (dados) => {
      const m = parse(dados);
      if (!m) return;
      if (m.t === MSG.PING) {
        ws.send(msg(MSG.PONG));
      } else if (
        m.t === MSG.APLICAR_BLOQUEIO ||
        m.t === MSG.REMOVER_BLOQUEIO ||
        m.t === MSG.BLOCK_APPS ||
        m.t === MSG.ALLOW_APPS ||
        m.t === MSG.APLICAR_QUIZ ||
        m.t === MSG.REMOVER_QUIZ ||
        m.t === MSG.RECEBER_LINK ||
        m.t === MSG.RECEBER_ARQUIVO
      ) {
        onComando(m);
      }
      // WELCOME/ROSTER sao informativos para o agente.
    });

    ws.on("close", reconectar);
    ws.on("error", () => {}); // o 'close' seguinte agenda a reconexao
  }

  function reconectar() {
    if (fechado || tentarDeNovo) return;
    tentarDeNovo = setTimeout(() => {
      tentarDeNovo = null;
      abrir();
    }, 2000);
  }

  abrir();
  return {
    enviar: (t, campos) => {
      if (ws && ws.readyState === 1 /* OPEN */) ws.send(msg(t, campos));
    },
    close: () => {
      fechado = true;
      clearTimeout(tentarDeNovo);
      ws?.close();
    },
  };
}

// CLI: `npm run aluno -- ws://IP:4571 "Nome do Aluno"`
if (import.meta.main) {
  const url = process.argv[2] || `ws://localhost:${process.env.PORTA || 4571}`;
  const nome = process.argv[3] || os.hostname();
  conectarAluno({
    url,
    nome,
    onComando: (m) => console.log(`[comando] ${m.t}${m.rotulo ? " · " + m.rotulo : ""}`),
  });
  console.log(`Aluno "${nome}" conectando em ${url} ...`);
}
