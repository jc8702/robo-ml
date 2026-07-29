# 🛒 ML Ofertas Bot

Bot local que coleta ofertas do Mercado Livre e gera mensagens com links de afiliado prontas para WhatsApp.

## ⚡ Quick Start

```bash
# 1. Instalar dependências
npm install

# 2. Instalar browser (se não tiver Chrome no sistema)
npx playwright install chromium

# 3. Configurar (opcional)
# Edite o arquivo .env com seu tracking ID de afiliado

# 4. Rodar!
npm run ofertas
```

## 🔧 Configuração

Copie `.env.example` para `.env` e configure:

| Variável | Descrição | Default |
|----------|-----------|---------|
| `ML_AFFILIATE_ID` | Seu ID do programa de afiliados ML | *(vazio)* |
| `ML_MIN_DISCOUNT` | Desconto mínimo (%) | `10` |
| `ML_MIN_PRICE` | Preço mínimo (R$) | `30` |
| `ML_MAX_PRICE` | Preço máximo (R$) | `500` |
| `ML_MAX_RESULTS` | Quantidade máxima de ofertas | `10` |
| `ML_DEFAULT_QUERIES` | Termos de busca (separados por vírgula) | `ofertas do dia` |
| `ML_OUTPUT_FORMAT` | `individual` ou `lista` | `individual` |

## 📖 Como Usar

```bash
# Busca padrão (queries do .env)
npm run ofertas

# Busca específica
npm run ofertas:query "fone bluetooth"

# Ou diretamente
npx tsx src/index.ts "notebook gamer"
```

### Primeira Execução

Na **primeira vez**, o bot abre um browser visível para você completar a verificação de segurança do Mercado Livre. Depois disso, os cookies são salvos e as próximas execuções são automáticas.

### Mensagens Geradas

As mensagens são:
- 📋 **Copiadas para o clipboard** — cole no WhatsApp com Ctrl+V
- 💾 **Salvas em arquivo** na pasta `output/` para histórico

## 🏗️ Arquitetura

```
src/
├── index.ts              # Orquestrador do pipeline
├── config/settings.ts    # Configuração via .env
├── collector/ml-api.ts   # Coleta via Playwright (browser real)
├── affiliate/link-converter.ts  # Conversão para links de afiliado
├── formatter/whatsapp.ts # Formatação de mensagens WhatsApp
└── output/clipboard.ts   # Clipboard + arquivo
```

## 📱 Programa de Afiliados

Para gerar comissão, cadastre-se em:
👉 https://www.mercadolivre.com.br/afiliados

Após o cadastro, copie seu tracking ID e configure em `ML_AFFILIATE_ID` no `.env`.
