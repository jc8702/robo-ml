FROM mcr.microsoft.com/playwright:v1.49.0-noble

WORKDIR /app

# Copia pacotes de dependências
COPY package*.json ./

# Instala dependências
RUN npm install

# Copia todo o código do repositório
COPY . .

# Compila o projeto TypeScript para dist/
RUN npm run build

# Expõe porta para health check do Render
EXPOSE 3000

# Executa o servidor HTTP que também inicia o bot em modo automação
CMD ["node", "dist/server.js"]
