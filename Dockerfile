# Imagen oficial de Playwright: trae Python, Chromium y todas sus dependencias del sistema.
# La versión de la imagen y la de la librería playwright tienen que coincidir.
FROM mcr.microsoft.com/playwright/python:v1.56.0-noble

WORKDIR /app

# En el contenedor no hay pantalla: siempre headless y con el Chromium de Playwright.
ENV PYTHONUNBUFFERED=1 \
    PYTHONIOENCODING=utf-8 \
    PIP_BREAK_SYSTEM_PACKAGES=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    HEADLESS=true \
    BROWSER_CHANNEL=

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt "playwright==1.56.0"

COPY . .

ENTRYPOINT ["python", "main.py"]
CMD ["--check"]
