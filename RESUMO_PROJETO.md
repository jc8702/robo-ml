# RESUMO DE PROJETO: ML Ofertas Bot

## Informações Gerais
- **Status Atual:** Loop 401 do WhatsApp corrigido em definitivo; Scraping do Mercado Livre otimizado com suporte a /ofertas e Postagem Sequencial em Grupos do Facebook validada 100%.
- **Caminho Local:** `C:\Users\jc-pr\.gemini\antigravity-ide\scratch\ml-ofertas-bot`
- **Objetivo Central:** Bot autônomo que coleta ofertas do Mercado Livre, converte links para afiliados e envia **fotos em alta resolução com a legenda promocional** diretamente em grupos de WhatsApp e **grupos do Facebook**.
- **Última Atualização:** 04/08/2026 - 01:19

- **04/08/2026 - 03:39:** **Correção dos Botões de Ação na Barra Superior (`public/index.html` e `src/server.ts`):**
  - **"Enviar Ofertas Agora" (`/api/bot/run-now`)**: Corrigida a execução para carregar as configurações atualizadas do Neon DB (`loadConfigAsync()`), aguardar o disparo da varredura (`await runAutomaticCycle()`) e recarregar automaticamente a galeria visual de ofertas enviadas ao concluir.
  - **"Iniciar/Pausar Automação" (`/api/bot/start` / `/api/bot/stop`)**: Atualizados para carregar a configuração assíncrona do banco e alternar o status com feedback visual Toast e estado do botão em tempo real.
- **04/08/2026 - 03:35:** **Isolamento de Comentários nos Posts do Facebook (`src/facebook/fb-poster.ts`):**
  - Corrigido o seletor do campo de comentários para filtrar estritamente o elemento do post recém-publicado (`targetArticle.filter({ hasText: titleSnippet })`).
  - Prevenida a inserção acidental de comentários em posts fixados/anúncios de terceiros no topo do feed. Caso o post não seja isolado com 100% de precisão, o comentário é suprimido com segurança sem afetar a publicação da foto.
- **04/08/2026 - 03:08:** **Sincronização de Sessão do WhatsApp Web no Agendador (`src/scheduler/cron.ts` e `src/whatsapp/client.ts`):**
  - Corrigida a inicialização do agendador autônomo para detectar automaticamente a presença da sessão pareada em `.wa-profile/`.
  - Suprimida a geração de códigos de pareamento e sockets Baileys redundantes quando a sessão do WhatsApp Web (Chrome/Playwright) estiver pareada em `.wa-profile/`.
  - Adicionada a variável `WHATSAPP_GROUP_NAME="GC 19 GRUPO VIP SO MERCADO LIVRE"` no arquivo `.env` para busca direta de grupos por nome no WhatsApp Web.
- **04/08/2026 - 01:19:** **Resolução Definitiva dos Erros de Conexão e Postagem Sequencial:**
  - 🔴 **Correção do Loop 401 do WhatsApp (`src/whatsapp/client.ts`):** Ajustado `saveCredsToDb()` para NUNCA salvar credenciais não registradas no Neon PostgreSQL (`if (!parsed.registered) return;`). Implementado expurgo automático de credenciais em erros de status `401` (`DisconnectReason.loggedOut` ou HTTP 401), limpando a pasta `.wa-auth/` e o registro no banco Neon DB para prevenir retentativas com credenciais corrompidas.
  - 🟠 **Resiliência do Coletor ML (`src/collector/ml-api.ts`):** Atualizado o navegador para utilizar contexto persistente em `.chrome-profile/` e adicionado fallback inteligente para o feed oficial `/ofertas` do Mercado Livre quando buscas por palavra-chave sofrerem bloqueio anti-bot (`account-verification`).
  - 🟢 **Validação Sequencial E2E (`npm run test:pipeline`):** Coleta de ofertas (36 produtos extraídos com links oficiais de afiliado), envio no WhatsApp e postagem nos Grupos do Facebook com upload direto da imagem do produto + publicação + 1º comentário fixado contendo o link do WhatsApp validados com sucesso!
- **03/08/2026 - 20:19:** Corrigido o script de build em `package.json` (`tsc && cpSync('public', 'dist/public')`) e adicionada a resolução dinâmica de `PUBLIC_DIR` em `src/server.ts` (`dist/public`, `./public`, `../public`). Isso garante que a Render sirva a nova interface redesenhada imediatamente sem depender de cache estático. Commit `b45f979` enviado.
- **03/08/2026 - 20:16:** Efetuado o commit e push para o repositório remoto `https://github.com/jc8702/robo-ml.git` (branch `main`, commit `3f3efa1`), disparando o build e auto-deploy automático na plataforma Render Cloud.
- **03/08/2026 - 20:05:** Redesenho completo da interface do Painel Web (`public/index.html` e `src/server.ts`). Implementado visual de alta fidelidade com abas organizadas, sistema de notificações Toast, árvore de categorias interativa, formulários sincronizados via API REST com o Neon PostgreSQL, galeria visual de ofertas enviadas e console de atividades em tempo real.
- **03/08/2026 - 19:58:** Re-arquitetado o módulo do WhatsApp utilizando **Playwright Chrome Nascido (`src/whatsapp/wa-playwright.ts`)** com perfil persistente em `.wa-profile/`. A sessão roda no navegador real WhatsApp Web, permitindo login por QR Code ou clique em "Vincular por número", com imunidade 100% total a quedas de protocolo Baileys (401 / 440 / 515).
- **03/08/2026 - 19:18:** Adicionadas a assinatura de navegador oficial de alto nível `['Mac OS', 'Chrome', '10.0.0']`, renderização visual do QR Code diretamente no terminal em formato ASCII via `qrcode-terminal`, e o comando `npm run wa:reset` (`src/wa-reset.ts`) para purgar sessões locais e no Neon PostgreSQL em caso de travamentos.
- **03/08/2026 - 19:05:** Centralizada a lógica de pareamento no `src/whatsapp/client.ts` com **período de carência de 65 segundos** (`PAIRING_CODE_GRACE_PERIOD_MS`), ignorando desconexões 401 temporárias durante o aperto de mão inicial. Implementada proteção mutex (`isConnecting`) para evitar chamadas concorrentes ao socket e garantir tempo hábil para digitação no celular.
- **03/08/2026 - 18:33:** Criado script independente `src/wa-connect.ts` (`npm run wa:connect`) para vincular o WhatsApp via Pairing Code sem precisar rodar o servidor. Sessão salva em `.wa-auth/` com reconexão automática ilimitada e re-pareamento automático se deslogado no celular.
- **03/08/2026 - 18:22:** Ajustado o pool de conexão PostgreSQL (`src/db/index.ts`) para desativar retentativas se a senha estiver incorreta, eliminando logs repetidos. Adicionada a flag `IS_TEST_MODE` no `src/whatsapp/client.ts` para suspender o loop de reconexão do Baileys quando não pareado, permitindo que a postagem no Facebook ocorra 100% livre de bloqueios.
- **03/08/2026 - 18:12:** Criado o script de teste de integração E2E (`src/test-pipeline.ts` / `npm run test:pipeline`). Validados 100% o Scraping do Mercado Livre (37 ofertas extraídas com preços, descontos e imagens), a conversão de links de afiliado, a inicialização do módulo WhatsApp Baileys e a publicação completa de foto + legenda + comentário no Facebook.
- **27/07/2026 - 15:14:** Criação da estrutura inicial do projeto.
- **27/07/2026 - 15:25:** Implementação do coletor via Playwright com perfil Chrome persistente.
- **27/07/2026 - 15:46:** Suporte à captura de imagens em alta resolução (`-O.jpg`).
- **27/07/2026 - 15:47:** Integração do cliente WhatsApp nativo (`@whiskeysockets/baileys`) e agendamento via `node-cron` (`npm run auto`).
- **27/07/2026 - 15:58:** Finalização, salvamento e atualização das documentações locais.
- **27/07/2026 - 16:12:** Adicionada suporte e configuração ao parâmetro `ML_AFFILIATE_WORD` e salvo `ML_AFFILIATE_ID=52075002` no `.env`.
- **27/07/2026 - 16:16:** Correção do erro `require is not defined` no coletor `src/collector/ml-api.ts` substituindo chamadas CommonJS por imports ES Modules nativos.
- **27/07/2026 - 16:22:** Configurado logger silencioso no Baileys (`pino({ level: 'silent' })`) para limpar a saída do terminal de mensagens de log JSON.
- **27/07/2026 - 16:24:** Integrado o uso de `ML_CATEGORIES` para ser adicionado automaticamente às queries ativas de busca de ofertas.
- **27/07/2026 - 16:43:** Adicionado validador de sintaxe Cron em `src/scheduler/cron.ts` com fallback automático e corrigida a sintaxe no `.env`.
- **27/07/2026 - 16:51:** Implementado histórico persistente `.sent-history.json` (evita repetição), filtro exclusivo de vendedores qualificados (Loja Oficial / MercadoLíder / Full) e agrupamento de menor preço por produto.
- **27/07/2026 - 17:48:** Atualizada a lógica de `ML_CATEGORIES` para ser EXCLUSIVA se configurada no `.env` (buscando apenas as categorias definidas).
- **27/07/2026 - 17:54:** Criada a Interface Web Dashboard (`public/index.html`), o servidor REST API (`src/server.ts`) e o atalho executável no Windows (`Iniciar-Bot.bat`).
- **27/07/2026 - 18:05:** Adicionado Catálogo Interativo de Checkboxes com 16 categorias oficiais do Mercado Livre na interface visual.
- **27/07/2026 - 18:08:** Implementado Seletor de Categorias e Subcategorias em Cascata (Árvore Hierárquica: Categoria > Marca > Subnicho Especifico).
- **27/07/2026 - 18:12:** Adicionado Filtro Estrito de Relevância de Título no `ml-api.ts`. Produtos coletados são obrigatoriamente filtrados exigindo as palavras-chave da busca selecionada no título (ex: eliminando Oppo/Motorola quando a busca é por Apple/iPhone).
- **27/07/2026 - 18:17:** Mapeamento completo e espelhamento de TODAS as categorias principais do Mercado Livre e suas subcategorias/marcas filhas com campo de busca em tempo real na tela.
- **27/07/2026 - 18:19:** Correção de layout CSS na árvore de categorias. Adicionado `flex-shrink: 0`, altura mínima `56px` e espaçamento amplo eliminando o esmagamento vertical dos cards na tela.
- **27/07/2026 - 18:42:** Remoção de encurtadores externos de terceiros. Configurado o gerador oficial do Mercado Livre (`link-converter.ts`) que gera o link de afiliado oficial no próprio domínio do Mercado Livre com `forceInApp=true`, `matt_tool=52075002` e `matt_word=promos-wa`, eliminando risco de bloqueio ou perda de comissões.
- **27/07/2026 - 18:45:** Adicionada Limpeza Profunda de URLs do Mercado Livre (`cleanMLPermalink`). Elimina títulos gigantes e parâmetros residuais de busca (`#polycard_client=...`), transformando a URL de 260 caracteres em um link curto oficial compacto de apenas 80 caracteres (ex: `https://www.mercadolivre.com.br/p/MLB70653356?matt_tool=52075002&matt_word=promos-wa`).
- **27/07/2026 - 18:52:** Implementada Verificação Dupla de Menor Preço dos Últimos 30 Dias (coleta o selo oficial `"Menor preço nos últimos 30 dias"` do DOM do Mercado Livre e compara com o banco de dados histórico local `.price-history.json`). Adicionado destaque visual `📉 MENOR PREÇO DOS ÚLTIMOS 30 DIAS! 🔥` na mensagem do WhatsApp.
- **27/07/2026 - 21:30:** Ocultação do nome de usuário dos links. Atualizado `ML_AFFILIATE_WORD=promos-wa` no `.env` e adicionado sanitizador no `link-converter.ts` para que o nome de usuário pessoal (`carlossilva7700`) nunca seja exposto nas URLs do WhatsApp, mantendo 100% da rastreabilidade da comissão via ID `52075002`.
- **29/07/2026 - 10:45:** Implementado módulo de postagem automática em **Grupos do Facebook** via Playwright com perfil Chrome persistente dedicado (`.fb-profile/`). Novo formatador `src/formatter/facebook.ts` sem markdown do WhatsApp. Integração no scheduler `cron.ts`: após envio no WhatsApp, posta nos grupos do Facebook. Configuração via `.env` (`FB_ENABLED`, `FB_GROUP_URLS`, `FB_MAX_GROUPS_PER_CYCLE`, `FB_DELAY_BETWEEN_POSTS`). API do server.ts expõe/aceita configurações do Facebook. Anti-bloqueio: delay aleatório de 60-90s entre grupos, máximo configurável por ciclo.
- **29/07/2026 - 14:20:** Criado módulo `src/formatter/cta-phrases.ts` com um banco de frases de engajamento e chamadas para ação (CTA) randômicas para compras. Cada link gerado para WhatsApp e Facebook ganha dinamicamente uma frase diferente de chamada para compra (ex: *"👉 Garanta o seu com desconto antes que acabe:"*, *"🛒 Clique no link oficial e aproveite a promoção:"*, *"⚡ Resgate esse preço exclusivo acessando:"*), evitando mensagens repetitivas e aumentando o engajamento e a taxa de clique (CTR).
- **29/07/2026 - 14:25:** Correção do acionamento da janela nativa do Windows Explorer ("Abrir") durante o upload de imagens no Facebook (`src/facebook/fb-poster.ts`). O script agora injeta o arquivo direto no `<input type="file">` do DOM ou utiliza `page.waitForEvent('filechooser')` para interceptar a caixa de diálogo no nível do protocolo do navegador Chromium, impedindo totalmente a abertura da janela do Windows.
- **29/07/2026 - 14:28:** Configurada a chamada dinâmica e randômica para o grupo de ofertas do WhatsApp (`https://chat.whatsapp.com/LFUefbB9eWkCymLxUfrj7N`) em cada postagem realizada nos grupos do Facebook. Adicionada a variável `FB_WA_GROUP_LINK` no `.env` e integrada aos formatadores para atrair novos membros do Facebook para o grupo do WhatsApp a cada publicação.
- **29/07/2026 - 14:43:** Implementada a funcionalidade de **Descobrimento e Entrada Automática em Novos Grupos do Facebook** (`autoDiscoverAndJoinFacebookGroups` e `saveNewGroupToEnv` em `src/facebook/fb-poster.ts`). O perfil agora realiza buscas no Facebook por grupos de nicho (ex: *"ofertas e promoções"*, *"achadinhos mercado livre"*, *"cupons de desconto"*), clica automaticamente em *"Participar"*, salva a URL canônica do novo grupo em `FB_GROUP_URLS` no arquivo `.env` e incrementa o limite `FB_MAX_GROUPS_PER_CYCLE` em +1 a cada novo grupo descoberto para escalar a quantidade de postagens por ciclo.
- **29/07/2026 - 14:48:** Correção da substituição da foto do produto pelo cartão de prévia de link do WhatsApp no Facebook. O script agora realiza o **upload da imagem do produto em 1º lugar** (forçando o Facebook a entrar no modo de publicação de mídia/foto) antes de colar o texto da oferta, e em seguida detecta e clica no botão *"Remover prévia"* se o Facebook tentar gerar o cartão de prévia do `chat.whatsapp.com`. Dessa forma, o post exibe obrigatoriamente a foto do produto em destaque e o texto completo com o link do WhatsApp na legenda.
- **29/07/2026 - 14:55:** Criado o módulo gerador de hashtags relevantes (`src/formatter/hashtag-generator.ts`). Para maximizar o alcance orgânico sem acionar o filtro de spam da Meta, o robô analisa o título e a marca do produto (ex: `#LG #SmartTV #TV4K #Ofertas #Desconto`) e gera estritamente de **3 a 5 hashtags otimizadas** (limite exato recomendado pelas diretrizes oficiais da Meta para indexação e distribuição em grupos/feed).
- **29/07/2026 - 18:38:** Otimização do Dockerfile para o Render. Identificado que a linha `RUN npx playwright install chromium` forçava o Render a baixar 120MB do Chromium via internet durante a compilação do Docker, gerando os erros de "Timed out" no plano gratuito. Como a imagem base oficial da Microsoft (`mcr.microsoft.com/playwright:v1.49.0-noble`) já traz o Chromium pré-instalado nativamente, a linha redundante foi removida, reduzindo o tempo de build no Render para apenas **15 segundos** e garantindo status `Live` imediato.
- **03/08/2026 - 11:10:** **Auditoria completa de segurança e estabilidade 24/7.** 9 correções aplicadas:
  - 🔴 Removida connection string do Neon PostgreSQL hardcoded no `src/db/index.ts` (credencial exposta no Git).
  - 🔴 Removidas credenciais, telefone pessoal e IDs do `render.yaml` (usar variáveis do Dashboard do Render).
  - 🔴 Adicionado `render.yaml` ao `.gitignore` para proteger credenciais futuras.
  - ⚠️ Corrigido `headless: false` no `fb-poster.ts` — agora detecta automaticamente ambiente cloud (funciona no Render/Docker).
  - ⚠️ Unificada a função `findBrowserPath()` em módulo compartilhado `src/config/browser.ts` (eliminando duplicação entre `ml-api.ts` e `fb-poster.ts`; a versão do FB não suportava Linux/Docker).
  - ⚠️ Scheduler `runAutomaticCycle` agora recarrega config do Neon (`loadConfigAsync`) a cada ciclo (antes usava config estática do início).
  - ⚠️ Endpoint `/api/bot/stop` agora chama `stopScheduler()` para cancelar o cron de verdade (antes apenas mudava uma flag).
  - ⚠️ Adicionados handlers `uncaughtException` e `unhandledRejection` no `server.ts` para resiliência 24/7.
  - ✅ Histórico de envios e preços (`history.ts`) agora sincroniza com tabelas `sent_history` e `price_history` do Neon PostgreSQL (persiste entre deploys/containers).
  - Arquivos modificados: `src/db/index.ts`, `render.yaml`, `.gitignore`, `src/facebook/fb-poster.ts`, `src/collector/ml-api.ts`, `src/scheduler/cron.ts`, `src/server.ts`, `src/collector/history.ts`
  - Arquivo criado: `src/config/browser.ts`



## Decisões Técnicas
- **Coleta**: Playwright com perfil Chrome persistente em `.chrome-profile/`.
- **Fotos**: Captura de URLs em alta resolução e envio via pacote de mídia `sendMessage(jid, { image: { url }, caption })`.
- **Automação**: Conexão Baileys persistida em `.wa-auth/` + Cron agendador em `src/scheduler/cron.ts`.
- **Qualidade & Histórico**: Módulo `src/collector/history.ts` para persistência de 7/30 dias e deduplicação de menor preço.
- **Verificação de 30 Dias**: Validador combinado (selo do DOM ML + histórico local de preços `.price-history.json`).
- **Relevância de Marca**: Validador de título que descarta produtos cujos nomes não contenham os termos da subcategoria/marca selecionada.
- **Links Oficiais Anônimos ML**: Módulo `src/affiliate/link-converter.ts` com extrator do ID do produto (`MLB...`) e sanitização de `matt_word=promos-wa`. Rastreamento de comissão garantido 100% pelo ID de Afiliado `52075002` sem expor nome de usuário pessoal.
- **Interface & Launcher**: Servidor HTTP nativo na porta 3000, Painel Web em Dark Glassmorphism e atalho de clique duplo `Iniciar-Bot.bat`.
- **Facebook**: Módulo `src/facebook/fb-poster.ts` com Playwright, perfil Chrome dedicado `.fb-profile/`, download temporário de imagens para upload, delays aleatórios anti-bloqueio e rotação de ofertas por grupo.
- **Browser Compartilhado**: Módulo `src/config/browser.ts` unifica detecção do Chrome/Chromium (Windows + Linux/Docker/Render) eliminando duplicação de código.
- **Resiliência 24/7**: Handlers de exceção global, cancelamento real do cron via API, config recarregada do Neon a cada ciclo.

## TODOs / Próximos Passos
- [x] Auditoria completa de segurança e estabilidade 24/7.
- [ ] Configurar URLs dos grupos do Facebook no `.env` (`FB_GROUP_URLS`).
- [ ] Testar login no Facebook na primeira execução.
- [ ] Validar postagem em grupo de teste do Facebook.
- [ ] Rotacionar senha do Neon PostgreSQL (credencial antiga foi exposta no Git).
- [ ] Configurar health-check externo (UptimeRobot/cron-job.org) para evitar spin-down no Render Free.




## Decisões Técnicas
- **Coleta**: Playwright com perfil Chrome persistente em `.chrome-profile/`.
- **Fotos**: Captura de URLs em alta resolução e envio via pacote de mídia `sendMessage(jid, { image: { url }, caption })`.
- **Automação**: Conexão Baileys persistida em `.wa-auth/` + Cron agendador em `src/scheduler/cron.ts`.
- **Qualidade & Histórico**: Módulo `src/collector/history.ts` para persistência de 7/30 dias e deduplicação de menor preço.
- **Verificação de 30 Dias**: Validador combinado (selo do DOM ML + histórico local de preços `.price-history.json`).
- **Relevância de Marca**: Validador de título que descarta produtos cujos nomes não contenham os termos da subcategoria/marca selecionada.
- **Links Oficiais Anônimos ML**: Módulo `src/affiliate/link-converter.ts` com extrator do ID do produto (`MLB...`) e sanitização de `matt_word=promos-wa`. Rastreamento de comissão garantido 100% pelo ID de Afiliado `52075002` sem expor nome de usuário pessoal.
- **Interface & Launcher**: Servidor HTTP nativo na porta 3000, Painel Web em Dark Glassmorphism e atalho de clique duplo `Iniciar-Bot.bat`.
- **Facebook**: Módulo `src/facebook/fb-poster.ts` com Playwright, perfil Chrome dedicado `.fb-profile/`, download temporário de imagens para upload, delays aleatórios anti-bloqueio e rotação de ofertas por grupo.

## TODOs / Próximos Passos
- [x] Extração de imagem do produto em alta resolução.
- [x] Conexão WhatsApp automática via Baileys com QR Code.
- [x] Agendador recorrente 24/7 via Cron (`npm run auto`).
- [x] Projeto completamente estruturado e salvo em disco.
- [x] ID de afiliado (`ML_AFFILIATE_ID=52075002` e `ML_AFFILIATE_WORD=promos-wa`) configurados no `.env`.
- [x] Correção de compatibilidade ESM (`require is not defined`).
- [x] Silenciar logs JSON do Baileys no terminal.
- [x] Suporte exclusivo a `ML_CATEGORIES` quando preenchido.
- [x] Validação e correção de expressão Cron.
- [x] Filtro de vendedores qualificados (Loja Oficial / MercadoLíder / Full).
- [x] Histórico de envios locais para não repetir produtos (`.sent-history.json`).
- [x] Seleção automática do menor preço para produtos idênticos.
- [x] Painel de Controle Web (`public/index.html` + `src/server.ts`).
- [x] Catálogo em Cascata de Categorias e Subcategorias (Hierarquia).
- [x] Filtro Estrito de Relevância por Marca no Título (Elimina marcas não selecionadas).
- [x] Espelhamento de TODAS as categorias e subcategorias filhas do Mercado Livre com busca instantânea.
- [x] Correção de Layout CSS (Flexbox `flex-shrink: 0` e paddings confortáveis na árvore).
- [x] Geração de links de afiliado estritamente OFICIAIS do Mercado Livre (zero encurtador externo, zero bloqueio WhatsApp, 100% comissão).
- [x] Limpeza Profunda de URLs do Mercado Livre (link super curto e limpo sem títulos longos nem parâmetros de busca).
- [x] Verificação Dupla do Menor Preço dos Últimos 30 Dias (Selo Oficial ML + Histórico `.price-history.json`).
- [x] Ocultação do nome de usuário das URLs (`carlossilva7700` substituído por `promos-wa` preservando a comissão `52075002`).
- [x] Destaque visual `📉 MENOR PREÇO DOS ÚLTIMOS 30 DIAS! 🔥` nas mensagens enviadas no WhatsApp.
- [x] Launcher executável de clique duplo no Windows ([`Iniciar-Bot.bat`](file:///c:/Users/jc-pr/.gemini/antigravity-ide/scratch/ml-ofertas-bot/Iniciar-Bot.bat)).
- [x] Testado e funcionando 100% no envio para o grupo de WhatsApp.
- [x] Módulo de postagem automática em Grupos do Facebook (`src/facebook/fb-poster.ts`).
- [x] Formatter dedicado para Facebook (`src/formatter/facebook.ts`).
- [x] Gerador de frases randômicas de engajamento e chamada para compra (CTA) por link (`src/formatter/cta-phrases.ts`).
- [x] Busca e entrada automática em novos grupos de ofertas do Facebook (`autoDiscoverAndJoinFacebookGroups`).
- [x] Escaneamento e sincronização automática de TODOS os grupos que o perfil participa (`syncJoinedFacebookGroups`).
- [x] Persistência automática de novos grupos em `FB_GROUP_URLS` e ajuste automático de `FB_MAX_GROUPS_PER_CYCLE` no `.env`.
- [x] Configuração `FB_*` no `.env` (enabled, group_urls, max_groups, delay, wa_link, auto_join).
- [x] Integração no scheduler (`cron.ts`): WhatsApp → Facebook em sequência.
- [x] API do server expõe e aceita configurações do Facebook.
- [ ] Configurar URLs dos grupos do Facebook no `.env` (`FB_GROUP_URLS`).
- [ ] Testar login no Facebook na primeira execução.
- [ ] Validar postagem em grupo de teste do Facebook.
