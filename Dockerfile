FROM mcr.microsoft.com/playwright:v1.49.0-noble

WORKDIR /app

# Copia pacotes de dependências
COPY package*.json ./

# Instala dependências do Node.js
RUN npm install

# Garante a instalação do binário do Chromium
RUN npx playwright install chromium

# Copia todo o código do repositório
COPY . .

# Compila os arquivos TypeScript para dist/
RUN npm run build

# Volumes para persistência de sessão do WhatsApp e perfil do Facebook
VOLUME ["/app/.wa-auth", "/app/.fb-profile"]

EXPOSE 3000

# Executa o robô em modo automático 24/7
CMD ["node", "dist/index.js", "--auto"]
