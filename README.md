# netSupport

Suporte remoto simples: o técnico vê e controla a tela dos PCs pelo navegador, e os usuários podem abrir chamados.

```
pip install -r requirements.txt
TOKEN=segredo python server.py            # servidor; abrir http://IP:8080/?token=segredo
python agent.py ws://IP:8080 segredo      # em cada PC (precisa de tela)
python test_server.py                     # autoteste do servidor
```

Gerar o agente como `.exe` (Windows): edite `SERVER` e `TOKEN` no topo de `agent.py`,
depois **dê duplo-clique em `build.bat`** (ou `pyinstaller --onefile --noconsole --name agent agent.py`).
Sai `dist\agent.exe` — copie para cada PC e dê duplo-clique; sem o cmd, usa o servidor/token embutidos.
Passo a passo completo e teste de cada função: ver `WINDOWS.md`.

- O usuário vê quando o suporte está olhando a tela e só libera o controle clicando em "Permitir controle" (vale por sessão).
- Sem TLS e com token único compartilhado: use em rede local, ou atrás de um proxy HTTPS.
- Chamados ficam na memória; só captura o monitor principal.
- Desligar/suspender/bloquear chegam ao PC mesmo sem "permitir controle" (são ações de administração); desligar e suspender podem exigir admin/root.
