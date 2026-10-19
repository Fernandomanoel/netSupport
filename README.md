# AulaCerta

Gestão de sala de aula enxuta para **Windows em rede local (LAN)**. Um app, dois papéis: o
**professor** hospeda a sala e controla; o **aluno** conecta e recebe os comandos.

Estado atual: **Etapa 1** (conexão + presença) e **Etapa 2** (bloqueio de tela nos modos
"Bloqueio" e "Reservado") concluídas. Ver [SPEC.md](SPEC.md) para o plano completo.

## Usar o aplicativo (.exe)

São **dois executáveis separados**, cada um travado no seu papel:

```
dist\AulaCerta-Professor\AulaCerta-Professor.exe
dist\AulaCerta-Aluno\AulaCerta-Aluno.exe
```

- **Professor:** abra `AulaCerta-Professor.exe`. Na primeira vez, **defina uma senha**; depois
  ela é exigida a cada abertura. Com a senha correta, a sala inicia e o painel abre com o
  **mosaico de miniaturas** das telas dos alunos. Anote o IP mostrado e informe aos alunos.
- **Aluno:** em cada máquina, abra `AulaCerta-Aluno.exe`, digite o **IP do professor** e seu
  nome, e clique **Conectar**. O aluno não tem a opção de virar professor.

> Transparência: o aluno é avisado de que o professor acompanha uma miniatura da tela e pode
> bloqueá-la; o bloqueio mostra um aviso em tela cheia. Uso previsto em máquinas geridas pela
> instituição, com o aluno ciente. Sem monitoramento oculto.

Em desenvolvimento, um único app com seletor de papel: `npm run app` (ou `--professor` /
`--aluno`). O papel fixo vem de `resources/app/role.txt` em cada build empacotado.

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
