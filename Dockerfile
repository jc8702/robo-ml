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

# Expõe porta padrão se necessário
EXPOSE 3000

# Executa o robô em modo de automação contínua 24/7
CMD ["node", "dist/index.js", "--auto"]
