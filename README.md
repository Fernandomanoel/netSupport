# netSupport

Suporte remoto simples: o técnico vê e controla a tela dos PCs pelo navegador, e os usuários podem abrir chamados.

```
pip install -r requirements.txt
TOKEN=segredo python server.py            # servidor; abrir http://IP:8080/?token=segredo
python agent.py ws://IP:8080 segredo      # em cada PC (precisa de tela)
python test_server.py                     # autoteste do servidor
```

- O usuário vê quando o suporte está olhando a tela e só libera o controle clicando em "Permitir controle" (vale por sessão).
- Sem TLS e com token único compartilhado: use em rede local, ou atrás de um proxy HTTPS.
- Chamados ficam na memória; só captura o monitor principal.
