// Vigia de aplicativos: encerra, no computador do aluno, processos cuja imagem esta
// na lista definida pelo professor. Encerra apenas o que esta na lista; nada mais.
// `listar` e `matar` sao injetaveis para teste; o padrao usa tasklist/taskkill (Windows).

import { execFile } from "node:child_process";

const norm = (lista) => new Set((lista || []).map((n) => String(n).trim().toLowerCase()).filter(Boolean));

// Lista as imagens (nomes .exe) dos processos em execucao no Windows.
function listarWindows() {
  return new Promise((resolve) => {
    execFile("tasklist", ["/fo", "csv", "/nh"], { windowsHide: true }, (err, stdout) => {
      if (err || !stdout) return resolve([]);
      const nomes = [];
      for (const linha of stdout.split(/\r?\n/)) {
        const m = linha.match(/^"([^"]+)"/); // primeiro campo CSV = nome da imagem
        if (m) nomes.push(m[1]);
      }
      resolve(nomes);
    });
  });
}

function matarWindows(imagem) {
  return new Promise((resolve) => {
    execFile("taskkill", ["/IM", imagem, "/F", "/T"], { windowsHide: true }, () => resolve());
  });
}

// Cria o vigia. Retorna { parar, atualizar(lista) }.
export function criarVigia({
  lista = [],
  intervalo = 1500,
  listar = listarWindows,
  matar = matarWindows,
  onBloqueado = () => {},
} = {}) {
  let alvos = norm(lista);
  let ocupado = false;

  async function ciclo() {
    if (ocupado || alvos.size === 0) return;
    ocupado = true;
    try {
      const rodando = await listar();
      const jaMortos = new Set();
      for (const img of rodando) {
        const chave = String(img).toLowerCase();
        if (alvos.has(chave) && !jaMortos.has(chave)) {
          jaMortos.add(chave);
          await matar(img);
          onBloqueado(img);
        }
      }
    } catch {
      // uma falha de ciclo nao derruba o vigia
    } finally {
      ocupado = false;
    }
  }

  const timer = setInterval(ciclo, intervalo);
  timer.unref?.();
  ciclo();

  return {
    parar: () => clearInterval(timer),
    atualizar: (nova) => {
      alvos = norm(nova);
    },
  };
}
