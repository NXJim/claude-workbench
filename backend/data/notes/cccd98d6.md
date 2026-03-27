Setup (once):
python -m venv D:\tmp\dw-venv; D:\tmp\dw-venv\Scripts\Activate.ps1; pip install PyQt6 requests openpyxl pyinstaller

Build (each time):
robocopy "R:\home\nomax\projects\apps\dw-spectrum" "D:\tmp\dw-spectrum" /E /XD venv .git venv-win build dist __pycache__; cd D:\tmp\dw-spectrum; D:\tmp\dw-venv\Scripts\Activate.ps1; pyinstaller pyinstaller.spec