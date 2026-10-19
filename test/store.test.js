// Acervo de testes: limites de estoque (5) e de questoes (10), validacao e edicao.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { criarAcervo, ErroAcervo, MAX_TESTES } from "../src/test-store.js";

const novoDir = () => mkdtempSync(join(tmpdir(), "aulacerta-"));
const testeOk = (nome = "T") => ({
  nome,
  questoes: [
    { tipo: "objetiva", enunciado: "2+2?", opcoes: ["3", "4"], correta: 1 },
    { tipo: "dissertativa", enunciado: "Explique." },
  ],
});

test("salva, lista e obtem um teste", () => {
  const a = criarAcervo(novoDir());
  const t = a.salvar(testeOk("Frações"));
  assert.ok(t.id);
  assert.equal(a.listar().length, 1);
  assert.equal(a.obter(t.id).nome, "Frações");
  assert.equal(a.obter(t.id).questoes[0].correta, 1);
});

test("estoque limita a 5 testes", () => {
  const a = criarAcervo(novoDir());
  for (let i = 0; i < MAX_TESTES; i++) a.salvar(testeOk("T" + i));
  assert.throws(() => a.salvar(testeOk("sexto")), (e) => e instanceof ErroAcervo && e.codigo === "estoque_cheio");
});

test("editar teste existente nao conta no limite", () => {
  const a = criarAcervo(novoDir());
  const ids = [];
  for (let i = 0; i < MAX_TESTES; i++) ids.push(a.salvar(testeOk("T" + i)).id);
  const edit = a.salvar({ id: ids[0], nome: "Renomeado", questoes: testeOk().questoes });
  assert.equal(edit.nome, "Renomeado");
  assert.equal(a.listar().length, MAX_TESTES);
});

test("rejeita mais de 10 questoes", () => {
  const a = criarAcervo(novoDir());
  const q = Array.from({ length: 11 }, () => ({ tipo: "dissertativa", enunciado: "x" }));
  assert.throws(() => a.salvar({ nome: "grande", questoes: q }), /10 quest/);
});

test("objetiva exige opcao correta valida", () => {
  const a = criarAcervo(novoDir());
  assert.throws(
    () => a.salvar({ nome: "X", questoes: [{ tipo: "objetiva", enunciado: "?", opcoes: ["a", "b"], correta: 5 }] }),
    (e) => e instanceof ErroAcervo && e.codigo === "invalido"
  );
});

test("exclui um teste", () => {
  const a = criarAcervo(novoDir());
  const t = a.salvar(testeOk());
  a.excluir(t.id);
  assert.equal(a.listar().length, 0);
});
