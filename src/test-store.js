// Acervo de testes do professor, gravado em um unico JSON (testes.json).
// Regras de produto: no maximo 5 testes guardados e no maximo 10 questoes por teste.
// Escolha deliberada por JSON em vez de SQLite: o volume e minimo e evita modulo nativo
// no empacotamento do .exe. Migrar para SQLite so se o acervo crescer muito (ver SPEC).

import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";

export const MAX_TESTES = 5;
export const MAX_QUESTOES = 10;
const TIPOS = new Set(["objetiva", "dissertativa"]);

export class ErroAcervo extends Error {
  constructor(codigo, mensagem) {
    super(mensagem);
    this.codigo = codigo; // "estoque_cheio" | "invalido" | "nao_encontrado"
  }
}

function validarTeste(teste) {
  const nome = String(teste?.nome ?? "").trim();
  if (!nome) throw new ErroAcervo("invalido", "o teste precisa de um nome");
  const qs = Array.isArray(teste?.questoes) ? teste.questoes : [];
  if (qs.length < 1) throw new ErroAcervo("invalido", "inclua ao menos 1 questao");
  if (qs.length > MAX_QUESTOES)
    throw new ErroAcervo("invalido", `maximo de ${MAX_QUESTOES} questoes por teste`);

  const questoes = qs.map((q, i) => {
    const tipo = String(q?.tipo ?? "");
    if (!TIPOS.has(tipo)) throw new ErroAcervo("invalido", `questao ${i + 1}: tipo invalido`);
    const enunciado = String(q?.enunciado ?? "").trim();
    if (!enunciado) throw new ErroAcervo("invalido", `questao ${i + 1}: enunciado vazio`);

    if (tipo === "objetiva") {
      const opcoes = (Array.isArray(q?.opcoes) ? q.opcoes : [])
        .map((o) => String(o).trim())
        .filter(Boolean);
      if (opcoes.length < 2)
        throw new ErroAcervo("invalido", `questao ${i + 1}: objetiva precisa de 2+ opcoes`);
      const correta = Number(q?.correta);
      if (!Number.isInteger(correta) || correta < 0 || correta >= opcoes.length)
        throw new ErroAcervo("invalido", `questao ${i + 1}: marque a opcao correta`);
      return { ordem: i + 1, tipo, enunciado, opcoes, correta };
    }
    return { ordem: i + 1, tipo, enunciado, opcoes: null, correta: null };
  });

  return { nome: nome.slice(0, 80), questoes };
}

// Abre (ou cria) o acervo em dataDir. Retorna a API do acervo.
export function criarAcervo(dataDir) {
  mkdirSync(dataDir, { recursive: true });
  const arquivo = join(dataDir, "testes.json");

  function carregar() {
    try {
      const dados = JSON.parse(readFileSync(arquivo, "utf8"));
      return Array.isArray(dados) ? dados : [];
    } catch {
      return [];
    }
  }

  function gravar(lista) {
    const tmp = arquivo + ".tmp";
    writeFileSync(tmp, JSON.stringify(lista, null, 2));
    renameSync(tmp, arquivo); // troca atomica
  }

  return {
    listar: () => carregar(),
    obter: (id) => carregar().find((t) => t.id === id) || null,

    // Cria ou atualiza. Novo teste respeita o limite de 5. Lanca ErroAcervo em falha.
    salvar(teste) {
      const limpo = validarTeste(teste);
      const lista = carregar();
      const idx = teste.id ? lista.findIndex((t) => t.id === teste.id) : -1;

      if (idx === -1) {
        if (lista.length >= MAX_TESTES)
          throw new ErroAcervo("estoque_cheio", `estoque cheio (max ${MAX_TESTES} testes)`);
        const novo = { id: randomUUID(), criado_em: Date.now(), ...limpo };
        lista.push(novo);
        gravar(lista);
        return novo;
      }
      const atualizado = { ...lista[idx], ...limpo };
      lista[idx] = atualizado;
      gravar(lista);
      return atualizado;
    },

    excluir(id) {
      const lista = carregar();
      const idx = lista.findIndex((t) => t.id === id);
      if (idx === -1) throw new ErroAcervo("nao_encontrado", "teste nao encontrado");
      lista.splice(idx, 1);
      gravar(lista);
    },
  };
}
