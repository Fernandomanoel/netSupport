@echo off
REM Duplo-clique para gerar o agent.exe. Antes, edite SERVER e TOKEN no topo de agent.py.
cd /d "%~dp0"
python -m pip install -r requirements.txt pyinstaller || goto :erro
python -m PyInstaller --onefile --noconsole --name agent agent.py || goto :erro
echo.
echo Pronto: dist\agent.exe   (copie para cada PC e de duplo-clique)
pause
exit /b 0
:erro
echo.
echo Falhou. Instale o Python de python.org (marque "Add to PATH") e tente de novo.
pause
exit /b 1
