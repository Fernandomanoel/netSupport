# AulaCerta

Gestão de sala de aula enxuta para **Windows em rede local (LAN)**. **Um único aplicativo**
que, na primeira execução, é configurado como **Administrador (professor)** ou **Aluno** —
escolha definitiva no app (não há troca de papel depois).

## Usar o aplicativo (.exe)

Um executável só:

```
dist\AulaCerta-win32-x64\AulaCerta.exe
```

Instalar: copie a **pasta inteira** `AulaCerta-win32-x64` para onde quiser (ex.:
`C:\Program Files\AulaCerta\`) e rode `AulaCerta.exe`.

**Primeira execução (configuração):** o app pergunta o papel deste computador.
- **Administrador (professor):** defina uma **senha**. A sala inicia e o painel abre com o
  **mosaico de miniaturas** das telas dos alunos. A senha é exigida a cada abertura.
- **Aluno:** o app fica fixo como aluno; a cada abertura, informe o **IP do professor** e seu
  nome e clique **Conectar**.

> A escolha do papel é **definitiva no app**. Para reconfigurar, reinstale (ou apague
> `setup.json` na pasta de dados do app). Para implantação em massa, a TI pode colocar um
> `resources/app/role.txt` com `professor` ou `aluno` para pular a pergunta.

**Funções do professor:** bloqueio de tela (Bloqueio/Reservado), bloqueio de apps, enviar
link/arquivo, **mensagem para a turma**, **testes/quiz** (criar, aplicar ao vivo, corrigir),
**miniaturas ao vivo** das telas (clique para ampliar) e **✋ pedidos de ajuda** dos alunos.

> Transparência: o aluno é avisado de que o professor acompanha uma miniatura da tela e pode
> bloqueá-la; o bloqueio mostra um aviso em tela cheia. Uso previsto em máquinas geridas pela
> instituição, com o aluno ciente. Sem monitoramento oculto.

## Desenvolvimento

```bash
npm install
npm run sala      # servidor + painel em http://localhost:4571
npm run aluno -- ws://SEU-IP:4571 "Nome"   # agente de teste (linha de comando)
npm run app       # app Electron (tela de escolha de papel)
npm test          # testes de conexão e de bloqueio
```

## Gerar o .exe

Com Electron instalado em `node_modules` (via `npm install`), o pacote portátil é montado em
`dist\AulaCerta-win32-x64\`. Em redes onde o `@electron/packager` não consegue baixar o runtime,
o pacote é montado a partir do Electron já presente em `node_modules/electron/dist` (runtime +
`AulaCerta.exe` + `resources/app`).

## Firewall

Na primeira execução como professor, o Windows pode pedir para liberar a porta **4571** na rede
privada. Autorize para os alunos conseguirem conectar.
