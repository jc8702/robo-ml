FROM node:20-slim

# Instala dependências essenciais de sistema para o Chromium/Playwright rodar em Linux sem interface gráfica
RUN apt-get update && apt-get install -y \
    wget \
    gnupg \
    ca-certificates \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libc6 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libexpat1 \
    libfontconfig1 \
    libgbm1 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libstdc++6 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxi6 \
    libxrandr2 \
    libxrender1 \
    libxtst6 \
    lsb-release \
    xdg-utils \
    xvfb \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copia package.json e package-lock.json
COPY package*.json ./

# Instala dependências do Node.js
RUN npm install

# Instala os binários do Chromium do Playwright
RUN npx playwright install chromium

# Copia todo o código-fonte
COPY . .

# Compila o projeto TypeScript
RUN npm run build

# Expõe volumes de sessões autenticadas (WhatsApp e Facebook)
VOLUME ["/app/.wa-auth", "/app/.fb-profile"]

# Expõe a porta da Dashboard HTTP
EXPOSE 3000

# Comando padrão para rodar o robô continuo 24/7
CMD ["node", "dist/index.js", "--auto"]
