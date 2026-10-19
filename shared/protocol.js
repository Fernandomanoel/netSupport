// Contrato de mensagens entre Servidor de Sala, Agente do Aluno e Painel do Professor.
// JSON simples e versionado. Todas as mensagens: { v, t, ...campos }.

export const PROTOCOL_VERSION = 1;

// Tipos de mensagem (t)
export const MSG = {
  // aluno -> servidor
  HELLO_ALUNO: "hello_aluno", // { nome, host }
  PONG: "pong",
  // professor(painel) -> servidor
  HELLO_PROFESSOR: "hello_professor",
  LOCK: "lock", // { modo: "bloqueio" | "reservado" }
  UNLOCK: "unlock",
  BLOCK_APPS: "block_apps", // { lista: ["chrome.exe", ...] } (professor->servidor->aluno)
  ALLOW_APPS: "allow_apps",
  START_QUIZ: "start_quiz", // { testeId } (professor -> servidor)
  END_QUIZ: "end_quiz",
  SEND_LINK: "send_link", // { url } (professor -> servidor). Arquivos vao por upload HTTP.
  // aluno -> servidor
  ENVIAR_RESPOSTA: "enviar_resposta", // { testeId, respostas: [...] }
  TELA: "tela", // { jpeg } miniatura da tela do aluno (base64)
  // servidor -> clientes
  WELCOME: "welcome", // { id }
  ROSTER: "roster", // { alunos: [...], aula: { ...bloqueio/apps, quiz } }
  PING: "ping",
  // servidor -> aluno
  APLICAR_BLOQUEIO: "aplicar_bloqueio", // { modo, rotulo }
  REMOVER_BLOQUEIO: "remover_bloqueio",
  APLICAR_QUIZ: "aplicar_quiz", // { teste } (sem gabarito)
  REMOVER_QUIZ: "remover_quiz",
  RECEBER_LINK: "receber_link", // { url }
  RECEBER_ARQUIVO: "receber_arquivo", // { id, nome, tamanho } -> aluno baixa em /arquivo/:id
  // servidor -> professor
  TELA_ALUNO: "tela_aluno", // { id, jpeg } miniatura ao vivo de um aluno
};

// Modos de bloqueio: mesma funcao, rotulos distintos (ver SPEC F2).
export const MODOS = {
  bloqueio: "Bloqueio",
  reservado: "Reservado",
};
export function rotuloDoModo(modo) {
  return MODOS[modo] || MODOS.bloqueio;
}

export function msg(t, campos = {}) {
  return JSON.stringify({ v: PROTOCOL_VERSION, t, ...campos });
}

// Faz o parse e valida a versao. Retorna null em mensagem invalida (nunca lanca).
export function parse(dados) {
  let obj;
  try {
    obj = JSON.parse(typeof dados === "string" ? dados : dados.toString("utf8"));
  } catch {
    return null;
  }
  if (!obj || typeof obj.t !== "string") return null;
  if (obj.v !== PROTOCOL_VERSION) return null;
  return obj;
}
