# netSupport no Windows 10/11

Passo a passo para instalar, testar cada funcionalidade e gerar o executável.
Rode tudo na máquina Windows (o agente precisa de tela e, para algumas ações, de administrador).

## 1. Instalar o Python e as dependências

1. Instale o Python 3 de https://python.org — marque **"Add python.exe to PATH"**.
2. No PowerShell, dentro da pasta do projeto:

```powershell
pip install -r requirements.txt
```

## 2. Subir o servidor (o PC do técnico, ou um servidor na rede)

```powershell
$env:TOKEN="segredo"
python server.py            # escuta na porta 8080
```

No navegador do técnico, abra: `http://IP_DO_SERVIDOR:8080/?token=segredo`
(troque `IP_DO_SERVIDOR`; na mesma máquina use `127.0.0.1`).

## 3. Rodar o agente em cada PC do usuário

Para ter TODAS as funções (bloquear sites, encerrar apps de outros usuários),
rode o PowerShell **como administrador**:

```powershell
python agent.py ws://IP_DO_SERVIDOR:8080 segredo
```

Uma janelinha "Suporte" aparece na tela do usuário. O PC surge na lista do console.

## 4. Testar cada funcionalidade (uma de cada vez)

No console (navegador), clique no nome do PC para selecioná-lo.

| # | Funcionalidade        | Como testar                                                                 | O que deve acontecer |
|---|-----------------------|------------------------------------------------------------------------------|----------------------|
| 1 | **Ver a tela**        | Selecionar o PC                                                              | A tela do usuário aparece ao vivo |
| 2 | **Controlar**         | No PC, clicar **"Permitir controle"**; no console, mover/clicar/digitar sobre a imagem | O mouse/teclado do usuário obedece. Sem o botão, não controla |
| 3 | **Pedir ajuda**       | No PC, clicar **"Pedir ajuda"** e escrever                                  | O chamado aparece em "Chamados" no console; clicar nele marca como resolvido |
| 4 | **Bloquear PC**       | Console: **"Bloquear PC"** / **"Liberar PC"**                               | Tela cheia "COMPUTADOR BLOQUEADO" trava o teclado/mouse; liberar remove |
| 5 | **Bloquear sites/apps** | Console: preencher sites (`facebook.com`) e apps (`chrome.exe`), **"Aplicar bloqueio"** | Sites não abrem (hosts); apps são encerrados a cada 2s. "Remover bloqueios" desfaz |
| 6 | **Suspender**         | Console: **"Suspender PC"**                                                 | O PC entra em suspensão |
| 7 | **Desligar**          | Console: **"Desligar PC"** (pede confirmação)                               | O PC desliga |

Se bloquear sites falhar, a janela do agente avisa que precisa de admin —
é só rodar o agente como administrador (passo 3).

## 5. Gerar o instalável (um arquivo .exe)

No Windows, com o agente já funcionando:

```powershell
pip install pyinstaller
pyinstaller --onefile --noconsole agent.py
```

O executável fica em `dist\agent.exe`. Para rodar em outro PC, copie o `.exe` e:

```powershell
dist\agent.exe ws://IP_DO_SERVIDOR:8080 segredo
```

> Para o `.exe` iniciar junto com o Windows, coloque um atalho dele (com os
> argumentos) na pasta `shell:startup`, ou crie uma Tarefa Agendada "ao fazer logon".
