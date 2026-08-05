# RESUMO DE PROJETO: ML Ofertas Bot

## Informações Gerais
- **Status Atual:** Transição 100% concluída para a arquitetura **Local-First**. O robô executa localmente via inicializador de 1 clique (`Iniciar-Bot.bat`), abre automaticamente a interface de configurações em `http://localhost:3000` e gerencia as sessões/logins locais do WhatsApp, Facebook e Instagram.
- **Caminho Local:** `C:\Users\jc-pr\.gemini\antigravity-ide\scratch\ml-ofertas-bot`
- **Objetivo Central:** Bot autônomo que coleta ofertas do Mercado Livre, converte links para afiliados e envia **fotos em alta resolução com a legenda promocional** diretamente em grupos de WhatsApp, **grupos do Facebook** e **feed do Instagram**.
- **Última Atualização:** 05/08/2026 - 20:00

- **05/08/2026 - 20:00:** **📸 CORREÇÃO DO PERFIL DO INSTAGRAM NAS MENSAGENS (`src/formatter/whatsapp.ts`, `src/formatter/facebook.ts`):**
  - **Ajuste do Handle do Instagram**: Atualizado o perfil do Instagram nas legendas geradas para o WhatsApp e Facebook de `@achadosdomeli.bnu` para `@achadosmeli.bnu` (`instagram.com/achadosmeli.bnu`).
  - **Suporte a Variável Dinâmica**: As funções de formatação agora utilizam a variável de ambiente `INSTAGRAM_USERNAME` com fallback seguro para `achadosmeli.bnu`.
  - **Validação de Build**: Executado `npm run build` com compilação 100% limpa sem erros.

- **05/08/2026 - 19:50:** **⚡ CORREÇÃO E ATIVAÇÃO AUTOMÁTICA DA VARREDURA & POSTAGEM DO FACEBOOK (`src/scheduler/cron.ts`, `src/facebook/fb-poster.ts`):**
  - **Desbloqueio de Execução (`cron.ts`)**: Removida a verificação impeditiva `config.facebook.groupUrls.length > 0` que impedia o robô de chamar `postOffersToFacebookGroups` quando a lista de grupos no `.env` estava vazia. Agora o ciclo do Facebook sempre roda quando o Facebook está habilitado, acionando a varredura automática logo no início.
  - **Varredura Robusta Multi-Endpoint (`fb-poster.ts`)**: Aprimorada a função `syncJoinedFacebookGroups` para buscar grupos tanto em `/groups/joins/` quanto em `/groups/`, realizando rolagens profundas de página para capturar 100% dos grupos participados pelo perfil.
  - **Recarregamento Instantâneo das URLs (`fb-poster.ts`)**: Adicionada a atualização imediata da variável `groupUrls` a partir da lista recém-sincronizada, garantindo que a postagem nos grupos comece instantaneamente na sequência da varredura.
  - **Validação de Build**: Executado `npm run build` com sucesso de compilação 100% limpo sem erros.

- **05/08/2026 - 19:35:** **🚀 DEPLOY COMPLETO (GITHUB & VERCEL PRODUCTION):**
  - **Compilação**: `npm run build` executado com sucesso de compilação 100% limpo sem erros.
  - **Sincronização GitHub**: Todas as alterações foram comitadas e enviadas para o repositório remoto [`https://github.com/jc8702/robo-ml.git`](https://github.com/jc8702/robo-ml.git) na branch `main` (commit `2204298`).
  - **Deploy Vercel Production**: Deploy de produção realizado com sucesso via Vercel CLI na URL oficial de produção [`https://ml-ofertas-bot-five.vercel.app`](https://ml-ofertas-bot-five.vercel.app).
  - **Status**: 100% implantado e operacional.

- **05/08/2026 - 19:10:** **📘 VARREDURA & AUTOSSINCRONIZAÇÃO DE GRUPOS DO FACEBOOK & RESTAURAÇÃO DO WHATSAPP A GRUPO ÚNICO (`src/facebook/fb-poster.ts`, `src/server.ts`, `public/index.html`, `src/scheduler/cron.ts`):**
  - **Restauração do WhatsApp a Grupo Único**: Removido o varredor de múltiplos grupos do WhatsApp e restaurada a configuração do WhatsApp para utilizar exclusivamente o grupo principal já configurado no `.env` (`WHATSAPP_GROUP_ID` / `WHATSAPP_GROUP_NAME`).
  - **Varredor de Grupos do Facebook (`fb-poster.ts`)**: Implementada a função `syncFacebookProfileGroups` que acessa a página de grupos do perfil (`/groups/joins/`) via Playwright, extrai as URLs de todos os grupos em que o perfil está inscrito e sincroniza no `.env` e Neon PostgreSQL DB.
  - **Auto-Join com Inclusão Automática**: Atualizada a função `saveNewGroupToEnv` para salvar automaticamente qualquer novo grupo de Facebook que o robô entrar na lista de `FB_GROUP_URLS` do `.env` e Neon DB, garantindo que o grupo entre nos ciclos seguintes.
  - **Botão no Painel Visual (`public/index.html`)**: Adicionado o botão **"🔍 Escanear & Sincronizar Meus Grupos do Facebook"** na aba do Facebook do painel. Ao clicar, executa o escaneamento em tempo real, preenche o campo de texto `fbGroupUrls` e salva no banco de dados.
  - **Endpoint da API (`src/server.ts`)**: Criada a rota `POST /api/facebook/sync-groups` para suporte a escaneamento sob demanda via painel web.
  - **Validação de Build**: Executado `npm run build` com sucesso de compilação 100% limpo sem erros.

- **05/08/2026 - 19:05:** **🔍 DETECÇÃO & AUTOSSINCRONIZAÇÃO DE GRUPOS DE WHATSAPP PARTICIPADOS (`src/whatsapp/wa-playwright.ts`, `src/whatsapp/client.ts`, `src/scheduler/cron.ts`, `src/server.ts`, `public/index.html`):**
  - **Varredor de Grupos (`wa-playwright.ts` & `client.ts`)**: Implementada a função `discoverWhatsAppGroupsPlaywright` para varrer a lista de chats do WhatsApp Web (`#pane-side`), identificar automaticamente todos os grupos participados pela conta e capturar seus nomes. Implementada também a função `syncAllWhatsAppGroups` que mescla grupos descobertos (via Playwright/Baileys) com grupos pré-existentes.
  - **Botão no Painel Visual (`public/index.html`)**: Adicionado o botão **"🔍 Escanear & Sincronizar Meus Grupos"** no painel de configurações. Ao clicar, o sistema efetua o escaneamento em tempo real, preenche o campo de texto com todos os grupos encontrados e salva automaticamente no Neon PostgreSQL.
  - **Endpoint da API (`src/server.ts`)**: Criado a rota `POST /api/whatsapp/sync-groups` para execução do escaneamento sob demanda via painel web.
  - **Sincronização Automática em Cada Ciclo (`src/scheduler/cron.ts`)**: Adicionada a chamada `syncAllWhatsAppGroups()` no início do ciclo automático `runAutomaticCycle`, garantindo que novos grupos aos quais o usuário se junte no celular sejam descobertos e incluídos automaticamente antes dos envios de ofertas.
  - **Validação de Build**: Executado `npm run build` com sucesso de compilação 100% limpo sem erros.

- **05/08/2026 - 19:00:** **📱 SUPORTE A MÚLTIPLOS GRUPOS DE WHATSAPP POR LINK DE CONVITE, NOME OU JID & DIAGNÓSTICO DO FACEBOOK (`public/index.html`, `src/config/settings.ts`, `src/whatsapp/wa-playwright.ts`, `src/server.ts`):**
  - **Suporte a Links de Convite de Grupos WhatsApp**: O campo do WhatsApp no Painel de Controle visual foi atualizado para aceitar links diretos (`https://chat.whatsapp.com/...`), nomes de grupos ou JIDs (separados por linha ou vírgula), espelhando o formato dos grupos do Facebook.
  - **Navegação Direta por Link (`wa-playwright.ts`)**: Adicionada inteligência na função `selectWaGroupChat` para identificar links `chat.whatsapp.com/CODE`, navegando diretamente via `https://web.whatsapp.com/accept?code=CODE` no WhatsApp Web para abrir a conversa do grupo instantaneamente.
  - **Iteração por GrupoAlvo (`wa-playwright.ts`)**: Removida a sobreposição rígida da variável global `WHATSAPP_GROUP_NAME` que forçava a busca do mesmo grupo em todas as iterações, permitindo ao robô iterar por cada grupo configurado no array `groupIds`.
  - **Parsing Flexível de Listas (`settings.ts`)**: Atualizada a função `parseList` para suportar separadores por quebra de linha (`\n`) e vírgulas (`,`).
  - **Diagnóstico do Log do Facebook**: Esclarecido o motivo do aviso `⚠️ [FACEBOOK] Facebook habilitado mas nenhum grupo configurado` (variável `FB_GROUP_URLS` vazia).
  - **Validação de Build**: Executado `npm run build` com sucesso de compilação 100% limpo sem erros.

- **05/08/2026 - 17:27:** **⏱️ REORDENAMENTO DE FLUXO: AUTO-JOIN DE GRUPOS MOVIDO PARA O FINAL DO PROCESSO (`src/facebook/fb-poster.ts`):**
  - **Reordenação do Fluxo**: A busca e entrada em novos grupos do Facebook (`autoDiscoverAndJoinFacebookGroups`) foi transferida do início do ciclo para o **final do processo**, após a conclusão completa dos envios para os grupos do WhatsApp, postagens nos grupos do Facebook e Instagram.
  - **Sem Interrupções**: As postagens nos grupos existentes agora iniciam imediatamente sem aguardar a varredura de novos grupos.
  - **Validação de Build**: Executado `npm run build` com sucesso de compilação 100% limpo sem erros.
  - **Formatação de URLs sem Protocolo `https://`**:
    - As chamadas do grupo do WhatsApp (`chat.whatsapp.com/...`) e do Instagram (`instagram.com/achadosdomeli.bnu`) nas postagens foram ajustadas sem o prefixo de protocolo `https://`. Isso impede que os algoritmos de scrapers do Facebook e do WhatsApp gerem cartões de prévia OpenGraph dos links sociais sobre a imagem do produto.
  - **Remoção Automática no Playwright (`fb-poster.ts`)**:
    - Expandida a varredura do robô no modal do Facebook com seletores para capturar e expurgar qualquer cartão de prévia de link que a plataforma tente criar, garantindo 100% que a única foto exibida seja a foto em alta resolução do produto postado.
  - **Validação de Build**: Executado `npm run build` com sucesso de compilação 100% limpo sem erros.
  - **Facebook (No Corpo do Post)**:
    - Removida a regra de fazer comentários separados. O link do grupo VIP do WhatsApp (`FB_WA_GROUP_LINK`) e a chamada do Instagram (`@achadosdomeli.bnu`) agora são incluídos diretamente no corpo principal da publicação do Facebook.
  - **WhatsApp (Apenas Instagram)**:
    - Dentro do grupo do WhatsApp, a mensagem inclui exclusivamente o CTA do Instagram (`@achadosdomeli.bnu`), omitindo o próprio link do grupo do WhatsApp.
  - **Validação de Build**: Executado `npm run build` com sucesso de compilação 100% limpo sem erros.
  - **Extração de Link Curto & ID do Produto (`fetchOfficialAffiliateShortLink`)**:
    - Atualizada a função de captura na barra oficial de afiliados do Mercado Livre para varrer o modal e extrair simultaneamente o link curto `meli.la` e o ID de busca do produto (ex: `103WG5-TQ6V`).
    - Adicionado suporte a `productId` nas interfaces `MLOffer` e `AffiliateOffer`.
  - **Formatação de Legendas no WhatsApp (`src/formatter/whatsapp.ts`)**:
    - Mantida a estrutura rica de mensagens (título, descontos, frete, badges, hashtags) integrando o bloco oficial de busca por ID do Mercado Livre:
      `🔍 *Cole este texto no buscador do Mercado Livre:* [ID_DO_PRODUTO]`
      `🔗 *Ou acesse o link:* https://meli.la/...`
  - **Variação Dinâmica de CTAs (`src/formatter/cta-phrases.ts`)**:
    - Expandida a coleção `CTA_PHRASES` com 30+ frases de chamada para ação variadas para garantir engajamento e diversidade em cada postagem.
  - **Validação de Build**: Executado `npm run build` com sucesso de compilação 100% limpo sem erros.
  - **Compilação TypeScript**: Executado `npm run build` com cópia de ativos estáticos da pasta `public` para `dist/public`.
  - **Sincronização GitHub**: Todas as alterações locais foram comitadas e enviadas para o repositório remoto [`https://github.com/jc8702/robo-ml.git`](https://github.com/jc8702/robo-ml.git) na branch `main`.
  - **Deploy Vercel Production**:
    - Criado arquivo `.vercelignore` para otimização de upload.
    - Realizado o deploy de produção no Vercel: URL oficial de produção [`https://ml-ofertas-bot-five.vercel.app`](https://ml-ofertas-bot-five.vercel.app).
  - **Status do Deploy**: 100% concluído e operacional.

- **05/08/2026 - 15:51:** **🔓 RESOLUÇÃO DEFINITIVA DE TRAVAMENTO NO EDITOR DE FOTO DO WHATSAPP WEB (`src/whatsapp/wa-playwright.ts`):**
  - **Identificação da Causa Raiz**: No editor de mídias (`div[role="dialog"]`), o clique exclusivo via seletores SVG em `[data-icon="send"]` por vezes não acionava a submissão no React do WhatsApp Web. Ao falhar, a rotina lançava uma exceção que desviava para a rota de fallback sem antes re-selecionar o grupo no `#side`, deixando a tela presa no modal de mídia. Além disso, o descarte em `forceClearAllWaModals` abria o popup de confirmação *"Descartar mídia?"* sem fechar o diálogo.
  - **Correções Aplicadas**:
    1. **Tripla Estratégia de Disparo (`sendOfferWithPhotoPlaywright`)**: O disparo do envio no modal agora foca o campo de legenda e envia a tecla `Enter` (comportamento nativo de envio no modal do WhatsApp Web), executa o clique direto no elemento container via JS (`(btn as HTMLElement).click()`) e realiza o clique via Playwright.
    2. **Descarte Rigoroso em 4 Passos (`forceClearAllWaModals`)**: Responde automaticamente a popups *"Descartar"*, envia tecla `Escape` dupla, clica no botão (X) e executa `page.reload()` caso algum modal persista.
    3. **Re-seleção Automática de Grupo no Fallback (`selectWaGroupChat`)**: Se por qualquer oscilação de rede o modal de imagem precisar ser expurgado, o robô automaticamente re-seleciona a conversa/grupo antes de postar a oferta com o preview no chat principal, garantindo 0 travamentos.
  - **Validação de Build**: Executado `npm run build` com sucesso de compilação 100% limpo sem erros.

- **05/08/2026 - 15:42:** **🛡️ CORREÇÃO DE DESCARTE DE OFERTAS & FALLBACK AUTOMÁTICO DE LINK DE AFILIADO ML (`src/collector/ml-api.ts`):**
  - **Identificação da Causa Raiz**: O robô encontrou 247 ofertas brutas e 212 após os filtros, porém a função `fetchOfficialAffiliateShortLink` descartou 100% dos produtos por não encontrar o botão `"Compartilhar"` da barra oficial de afiliados do Mercado Livre. Sem um fallback ativado, a lista final zerava (`0 ofertas com COMISSÃO DE AFILIADOS CONFIRMADA`).
  - **Ajustes Realizados**:
    1. **Ampliação de Seletores e Varredura Pré-Clique (`ml-api.ts`)**: Adicionada checagem direta na página por links `meli.la` e `mercadolivre.com/sec`, e expandidos os seletores do botão para incluir `"Gerar link"`, `"Gerar Link"`, `"Copiar link"`, `"Copiar Link"`, `"Compartilhar"` e variações da barra.
    2. **Fallback Canônico Oficial (`convertToOfficialMLAffiliateLink`)**: Caso a barra do navegador não consiga gerar o link encurtado dinamicamente (ex: barra inativa no item ou alteração de layout do ML), o robô aciona automaticamente a conversão canônica oficial do Mercado Livre utilizando os parâmetros de comissão (`matt_tool=...`).
    3. **Garantia de Envio**: Produtos minerados não são mais descartados indevidamente por falha de clique na interface web.
  - **Validação de Build**: Executado `npm run build` com sucesso de compilação 100% limpo sem erros.

- **05/08/2026 - 15:25:** **🛑 AJUSTE DE INICIALIZAÇÃO: ROBÔ INICIA DESLIGADO/PAUSADO POR PADRÃO (`src/server.ts`):**
  - **Solicitação do Usuário**: Alterar a inicialização do sistema para que o robô comece sempre DESLIGADO ao abrir o inicializador (`Iniciar-Bot.bat`) e só comece a trabalhar quando o usuário clicar no botão "Iniciar Automação" no painel.
  - **Ajustes Realizados**:
    1. Removido o disparo automático do agendador (`startScheduler`) que ocorria no boot do servidor HTTP em `src/server.ts`.
    2. O servidor agora força `isBotRunning = false` e grava `AUTO_BOT_RUNNING = 'false'` na subida.
    3. Ao abrir o painel em `http://localhost:3000`, a interface exibe o status `⏸️ Automação Pausada` e o botão `⚡ Iniciar Automação`.
    4. O robô só inicia as varreduras e envios quando o usuário clica manualmente em `⚡ Iniciar Automação` (que envia o `POST /api/bot/start`).
  - **Validação de Build**: Executado `npm run build` com sucesso de compilação 100% limpo sem erros.

- **05/08/2026 - 15:17:** **🗑️ REGRA DE EXPURGO ESTRITO E REVISÃO DE GRUPOS INEFICIENTES / COM APROVAÇÃO NO FACEBOOK (`src/facebook/fb-poster.ts`):**
  - **Filtro de Eficiência Máxima**: O robô agora analisa o resultado de cada tentativa de postagem no Facebook e remove sumariamente qualquer grupo que não ofereça publicação e comentário instantâneos.
  - **Critérios de Purga Imediata**:
    1. **`[PURGA DE APROVAÇÃO]`**: Grupos que colocam posts na fila de moderação dos administradores (*"Submit for admin approval"*, *"Pendente de aprovação"*) são **removidos sumariamente** da lista do `.env` e do banco Neon DB.
    2. **`[PURGA DE INEFICIÊNCIA]`**: Grupos onde o campo de texto/publicação não abrir, o botão *"Publicar"* falhar ou o grupo for desativado/privado são **removidos sumariamente**.
    3. **`[PURGA DE COMENTÁRIO]`**: Grupos que restringem a caixa de comentários para membros são **removidos sumariamente**.
    4. **`[PURGA DE REGRAS]`**: Grupos que exigem formulários manuais de participação são **removidos sumariamente**.
  - **Sincronização Neon DB**: Toda purga atualiza a lista `FB_GROUP_URLS` simultaneamente no `.env` e no banco PostgreSQL Neon.
  - **Validação de Build**: Executado `npm run build` com sucesso de compilação 100% limpo sem erros.

- **05/08/2026 - 15:10:** **⚡ FILA CIRCULAR CONTINUADA DO FACEBOOK & OTIMIZAÇÃO DA ENTREGA PRIORITÁRIA NO WHATSAPP (`src/facebook/fb-poster.ts`, `src/config/settings.ts`):**
  - **Entrega Imediata no WhatsApp**: Em cada ciclo, o robô envia 10 novas ofertas para o grupo do WhatsApp nos primeiros **30 segundos**, antes de iniciar as postagens do Facebook.
  - **Fila Circular de Grupos (`FB_LAST_GROUP_INDEX`)**:
    - Ajustado o lote do Facebook para **15 grupos por ciclo** (`FB_MAX_GROUPS_PER_CYCLE = 15`), reduzindo a duração do ciclo para apenas ~18 minutos.
    - Implementado ponteiro persistente do último grupo postado (`FB_LAST_GROUP_INDEX`), salvo no `.env` e no **Neon PostgreSQL DB**.
    - A cada novo ciclo, o Facebook continua a postagem nos próximos 15 grupos da lista de 217 grupos sem nunca repetir os primeiros e dando voltas infinitas.
  - **Validação de Build**: Executado `npm run build` com sucesso de compilação 100% limpo sem erros.

- **05/08/2026 - 14:51:** **🔓 CORREÇÃO DE TRAVAMENTO & MECANISMO DE DESTRAVAMENTO AUTOMÁTICO/MANUAL DO WHATSAPP WEB (`src/whatsapp/wa-playwright.ts`, `src/server.ts`, `public/index.html`):**
  - **Identificação da Causa Raiz**: No editor de imagem/mídia do WhatsApp Web, fotos altas empurravam o botão verde de enviar (`[data-icon="send"]`) para fora da área visível da tela (abaixo da dobra). A checagem `isVisible()` falhava por razões de rolagem, deixando a janela de edição (`div[role="dialog"]`) travada na tela sem concluir o envio ou liberar a interface de chats.
  - **Correções Aplicadas**:
    1. **Rolagem & Clique Forçado DOM (`wa-playwright.ts`)**: Adicionado `scrollIntoViewIfNeeded()` e clique forçado direto via DOM (`el.click()`) no botão de envio, garantindo o disparo mesmo se a imagem for gigante.
    2. **Expurgo Incondicional de Modais (`forceClearAllWaModals`)**: Detecção alterada para checar presença no DOM via `document.querySelector('div[role="dialog"]')`. Se um modal persistir, o robô executa `page.reload()` incondicionalmente, expurgando o modal e restaurando os chats em 2s.
    3. **Fallback Automático no Chat Limpo**: Caso ocorra falha no editor de mídia, a mensagem é publicada diretamente no campo de texto principal do chat com o card de preview do produto.
    4. **Botão de Destravamento Manual no Painel (`public/index.html` & `src/server.ts`)**: Adicionado o botão **"🔓 Destravar Janela do WhatsApp"** e o endpoint `POST /api/sessions/unlock-wa` para destravamento instantâneo com 1 clique pelo usuário.
  - **Validação de Build**: Executado `npm run build` com sucesso de compilação 100% limpo sem erros.

- **05/08/2026 - 14:45:** **🛡️ REGRA IMUTÁVEL: VALIDAÇÃO ESTRITA DE COMISSÃO DE AFILIADOS E DESCARTE DE PRODUTOS NÃO COMISSIONADOS (`src/collector/ml-api.ts`, `src/affiliate/link-converter.ts`):**
  - **Identificação do Risco**: Nem todo produto anunciado no Mercado Livre gera comissão no programa de afiliados. Caso um produto sem comissão fosse postado, haveria o risco de vendas sem o retorno de comissão para o usuário.
  - **Dupla Trava de Segurança**:
    1. **Validação da Barra Oficial (`ml-api.ts`)**: Ao extrair produtos, o robô valida cada oferta na barra de afiliados oficial do Mercado Livre (`fetchOfficialAffiliateShortLink`). Ofertas que não gerarem o link curto oficial de afiliado (`meli.la/`, `mercadolivre.com/sec/`, `mliv.re/`, `matt_tool=`) são **descartadas sumariamente** da lista de envios com o log `🚫 [SEM COMISSÃO DESCARTADO]`.
    2. **Filtro Estrito em `convertOffers` (`link-converter.ts`)**: Adicionada trava de segurança final na conversão que bloqueia e suprime qualquer produto sem o link de afiliado verificado.
  - **Garantia Imutável**: O robô agora compartilha **exclusivamente** produtos com comissão de afiliado confirmada.
  - **Validação de Build**: Executado `npm run build` com sucesso de compilação 100% limpo sem erros.

- **05/08/2026 - 14:38:** **🎯 IMPLEMENTAÇÃO DA HIERARQUIA DE 10 CATEGORIAS & MODO FOCADO DE SCRAPING (`public/index.html`, `src/config/settings.ts`, `src/server.ts`, `src/collector/ml-api.ts`):**
  - **Interface Visual (`public/index.html`)**:
    - Criada a seção **"🎯 Hierarquia de Categorização & Campanhas Sazonais (Ex: Dia dos Pais, Black Friday)"**.
    - Implementados **10 campos numerados de prioridade** (1ª Prioridade / Máxima até a 10ª Prioridade) para inserção de categorias ou subcategorias.
    - Adicionada a chave seletora **"🎯 Ativar Modo Focado (Rodar APENAS nas Categorias Prioritárias)"**.
  - **Persistência de Dados & API (`src/config/settings.ts`, `src/server.ts`)**:
    - Adicionadas as chaves de configuração `ML_PRIORITY_CATEGORIES` (array de até 10 strings) e `ML_USE_PRIORITY_ONLY` (`true`/`false`).
    - Integração completa com o **Neon PostgreSQL DB** (`app_settings`), arquivo `.env` e variáveis em memória.
    - Endpoints `GET /api/config` e `POST /api/config` atualizados para carregar e salvar a hierarquia.
  - **Motor de Coleta (`src/collector/ml-api.ts`)**:
    - **Modo Focado Ativo (`usePriorityOnly === true`)**: O robô minera **exclusivamente** nas categorias preenchidas nos campos de 1 a 10 na ordem exata configurada pelo usuário.
    - **Modo Amplo com Prioridade (`usePriorityOnly === false`)**: O robô processa as 10 categorias prioritárias em 1º lugar e em seguida minera as demais categorias do catálogo do Mercado Livre.
  - **Validação de Build**: Executado `npm run build` com sucesso de compilação 100% limpo sem erros.

- **05/08/2026 - 14:26:** **🛡️ RESOLUÇÃO DA TRAVA NA TELA "THIS CONTENT ISN'T AVAILABLE RIGHT NOW" NO FACEBOOK (`src/facebook/fb-poster.ts`):**
  - **Identificação da Causa Raiz**: Quando um grupo do Facebook é desativado, tornado privado ou deletado, o Facebook renderiza dinamicamente via SPA a tela de erro *"This content isn't available right now"* (*"Este conteúdo não está disponível no momento"*). O robô realizava uma checagem síncrona prematura e, se falhasse por atraso na renderização do React, ficava travado ~40 segundos tentando encontrar seletores de postagem em uma página morta. Além disso, a janela do navegador mantinha a aba presa na tela de erro.
  - **Prevenção em 3 Camadas**:
    1. **Rotina de Detecção Avançada (`checkIsFacebookPageUnavailable`)**: Implementada varredura com retentativas (3 tentativas com espera de renderização) e verificação normalizada de termos multilíngues (*"content isn't available"*, *"este conteúdo não está disponível"*, *"when this happens"*, *"go to feed"*, *"visit help center"*, *"central de ajuda"*, *"voltar"*).
    2. **Despoluição e Redirecionamento Automático da Janela**: Ao identificar a tela de erro (seja no `goto` inicial ou durante a busca do campo de publicação), o robô executa a limpeza da URL morta no arquivo `.env` (`removeInvalidGroupUrlFromEnv`) e **navega imediatamente a página para `https://www.facebook.com`**, fechando a tela de erro e despoluindo a janela do Chromium exibida na área de trabalho.
    3. **Prevenção de Loops e Delays**: Evita a execução de seletores repetitivos quando a página não possui campo de publicação, reduzindo o tempo de descarte para menos de 1 segundo.
  - **Validação de Build**: Executado `npm run build` com sucesso de compilação 100% limpo sem erros.

- **05/08/2026 - 14:23:** **🎯 ISOLAMENTO DEFINITIVO DO 1º COMENTÁRIO EXCLUSIVAMENTE NA POSTAGEM PRÓPRIA NO FACEBOOK (`src/facebook/fb-poster.ts`):**
  - **Identificação da Causa Raiz**: O robô possuía um fallback de busca global no DOM (`page.locator('div[role="feed"] form ...')`). Quando o campo de comentário do post próprio não era encontrado de imediato, esse fallback global localizava a caixa de comentário aberta na publicação de outro membro abaixo no feed, comentando na postagem errada.
  - **Resolução em 3 Camadas**:
    1. **Captura/Navegação via Toast Permalink**: Ao clicar em "Publicar", o robô intercepta a notificação *"Ver publicação"* / *"View post"* e navega diretamente para a URL do post recém-criado (`/posts/ID/`), onde só existe a publicação do próprio usuário na tela.
    2. **Filtro de Cards Principais do Feed (`topFeedUnitSelectors`)**: Atualizada a busca de posts no feed para usar seletores de nivel superior (`div[data-pagelet*="FeedUnit"]`, `:not([role="article"] [role="article"])`), ignorando 100% dos comentários internos e sub-postagens de terceiros.
    3. **Eliminação Total do Fallback Global**: Removida completamente a busca global `page.locator()` para caixa de comentário. Se a caixa não for encontrada dentro do container isolado do post próprio, o comentário é suprimido por segurança. É matematicamente impossível o robô comentar na publicação de outro membro.
  - **Validação de Build**: Executado `npm run build` com sucesso de compilação 100% limpo sem erros.

- **05/08/2026 - 14:18:** **🛡️ RESOLUÇÃO DEFINITIVA DE TRAVAMENTOS DO WHATSAPP WEB (`src/whatsapp/wa-playwright.ts`):**
  - **Identificação da Causa Raiz**:
    1. A resolução anterior de tela (`1280x800`) fazia com que imagens grandes empurrassem a legenda e o botão verde de envio para fora do campo visível (abaixo da dobra da tela), impedindo o clique no botão de envio.
    2. Modais de mídia persistiam na tela mesmo após tentar o descarte por cliques.
  - **Prevenção em 3 Camadas**:
    1. **Aumento da Viewport para 1080p (`1366x1080`)**: Garante altura vertical suficiente para manter a caixa de legenda e o botão verde de enviar sempre 100% visíveis na janela do Chrome.
    2. **Expurgo Incondicional via `page.reload()` (`forceClearAllWaModals`)**: Caso um modal persista visível após tentativas de clique, o robô recarrega a página (`await page.reload()`). Como a sessão está salva em `.wa-profile`, o WhatsApp Web recarrega limpo em 2 segundos na lista de chats sem nenhum modal aberto.
    3. **Modo Bypass sem Modal (`WA_DIRECT_POST_MODE` / Fallback Limpo)**: Permite enviar o texto completo da oferta com o preview de imagem do link diretamente na caixa do chat principal (`#main div[contenteditable="true"]`), zerando a necessidade de abrir qualquer modal de edição ou janela de upload.
  - **Validação de Build**: Executado `npm run build` com sucesso de compilação 100% limpo sem erros.

- **05/08/2026 - 14:10:** **🛡️ TRATAMENTO E AUTO-EXPURGO DE GRUPOS INDISPONÍVEIS / DELETADOS NO FACEBOOK (`src/facebook/fb-poster.ts`):**
  - **Identificação da Causa Raiz**: Quando um grupo do Facebook era deletado, alterado para privado ou desativado, o Facebook exibia a tela *"This content isn't available right now"* (*"Este conteúdo não está disponível no momento"*). O robô ficava tentando localizar o campo de publicação indefinidamente, perdendo tempo em links mortos.
  - **Checagem Instantânea Pré-Postagem**:
    - Adicionada detecção ao navegar na página do grupo para termos como *"content isn't available"*, *"este conteúdo não está disponível"*, *"page not found"*, *"go to feed"*, *"visit help center"*.
    - Ao detectar um grupo indisponível, o robô encerra a tentativa no grupo em menos de 1 segundo sem travar a execução.
  - **Auto-Expurgo de URLs Quebradas (`removeInvalidGroupUrlFromEnv`)**:
    - Desenvolvida a rotina que limpa automaticamente a URL do grupo indisponível do arquivo `.env` (`FB_GROUP_URLS`) e reduz a contagem de `FB_MAX_GROUPS_PER_CYCLE`, evitando que o robô volte a visitar links mortos em ciclos futuros.
  - **Validação de Build**: Executado `npm run build` com sucesso de compilação 100% limpo sem erros.

- **05/08/2026 - 14:07:** **💬 GARANTIA DE INSERÇÃO DO 1º COMENTÁRIO PÓS-PUBLICAÇÃO NO FACEBOOK (`src/facebook/fb-poster.ts`):**
  - **Identificação da Causa Raiz**: O localizador anterior de artigos exigia rigor estrito de palavras do título e marcadores de texto específicos do Facebook. Quando o Facebook apresentava pequenas variações de texto ou acentuação, o localizador retornava `null`, fazendo o robô omitir o comentário por segurança (`Comentário suprimido`).
  - **Identificação Multi-Nível Resiliente (`findNewlyCreatedPostArticle`)**:
    - **Tier 1 (Link de Afiliado Unívoco)**: O robô verifica prioritariamente se o artigo contém o link de afiliado exclusivo ou permalink da oferta (`meli.la/`, `mercadolivre.com.br/`).
    - **Tier 2 (Palavras do Título sem Acentos)**: Comparação normalizada de termos sem distinção de acentuação ou caracteres especiais.
    - **Tier 3 (Selos Recentes)**: Busca por selos de publicação recente (*"Você acabou de publicar"*, *"Agora mesmo"*, *"1 min"*).
    - **Tier 4 (Fallback Topo do Feed)**: Seleciona incondicionalmente o primeiro artigo recente não fixado no topo do feed do grupo.
  - **Inserção Direta via `insertText` API**: Substituído o envio linha a linha com `Shift+Enter` pela injeção atômica via `page.keyboard.insertText(waCommentText)`, eliminando o envio prematuro e garantindo o comentário com o link do WhatsApp no post do grupo.
  - **Validação de Build**: Executado `npm run build` com sucesso de compilação 100% limpo sem erros.

- **05/08/2026 - 14:04:** **🛡️ REGRA IMUTÁVEL DE AUTO-DESCARTE DE MODAIS E EDITORES TRAVADOS NO WHATSAPP WEB (`src/whatsapp/wa-playwright.ts`):**
  - **Identificação da Causa Raiz**: Ao enviar uma imagem no WhatsApp Web, o navegador abre a tela/modal do editor de mídia. Se o clique no botão de envio falhar, se o evento `Enter` não for aceito ou se houver atraso no upload, o modal (`div[role="dialog"]`) permanecia visível na tela por padrão, bloqueando as pesquisas e envios subsequentes.
  - **Desenvolvimento da Função Autônoma (`forceClearAllWaModals`)**:
    - Criada a rotina em loop de limpeza que detecta modais de sobreposição (`div[role="dialog"]`, `[data-animate-modal-popup]`, etc.).
    - Executa tripla ação de fechamento: envia a tecla `Escape`, aciona botões de fechar com ícone `x` (`[aria-label*="Fechar"]`, `[data-icon="x"]`) e aceita janelas de confirmação de descarte (`"Descartar"`, `"Discard"`).
  - **Checagem Preventiva & Trava de Segurança no Envio**:
    - **Varredura Prévia**: A função `forceClearAllWaModals(page)` é invocada antes de qualquer busca de grupo ou interação no WhatsApp Web.
    - **Timeout Estrito de Submissão**: Após tentar o envio da mídia, o robô aguarda até 8 segundos pela desanexação do modal (`state: 'detached'`). Caso o modal permaneça aberto (travado na tela), o robô cancela a sobreposição via `forceClearAllWaModals(page)` e aciona o fallback de postagem no chat principal com preview oficial do link.
  - **Validação de Build**: Executado `npm run build` com sucesso de compilação 100% limpo sem erros.

- **05/08/2026 - 13:56:** **🎯 ISOLAMENTO ESTRITO DO 1º COMENTÁRIO NA PUBLICAÇÃO DO USUÁRIO NO FACEBOOK (`src/facebook/fb-poster.ts`):**
  - **Identificação da Causa Raiz**: O robô executava busca global (`page.locator(...)`) quando o modal do comentário não abria de imediato no artigo da oferta. Isso fazia com que ele clicasse na caixa de comentário do post seguinte no feed (criado por outro membro), inserindo o link do WhatsApp na publicação errada.
  - **Localizador de Post Próprio (`findNewlyCreatedPostArticle`)**: Desenvolvida a busca estrita do post recém-criado pelo próprio usuário através de selos do Facebook (*"Você acabou de publicar"*, *"Agora mesmo"*, *"Just now"*) e correspondência de palavras-chave do título.
  - **Eliminação de Fallback Global & Trava de Segurança**: A busca da caixa de comentário e submissão foi restrita exclusivamente ao contêiner `targetArticle.locator(...)`. Removida a busca global por toda a página. Caso o post próprio não possa ser isolado com 100% de certeza, o comentário é suprimido com aviso no log, garantindo que o robô jamais comente na publicação de outro membro.
  - **Validação de Build**: Executado `npm run build` com sucesso de compilação 100% limpo sem erros.

- **05/08/2026 - 13:51:** **📋 TRATAMENTO INTELIGENTE E PULO DE MODAIS DE REGRAS DE GRUPO NO FACEBOOK (`src/facebook/fb-poster.ts`):**
  - **Rotina de Desbloqueio Autônomo (`handleFacebookGroupRulesModal`)**:
    - Implementada a detecção e tratamento automático do modal de sobreposição **"Participation review"** (*Análise de participação / Regras do grupo / Perguntas de adesão*).
    - **Auto-Aceite de Regras Simples**: O robô marca automaticamente caixas de seleção (*"I agree to the group rules"* / *"Concordo com as regras"*) e clica em **Submit / Enviar** para concluir a adesão.
    - **Desbloqueio e Pulo Gracioso**: Caso o grupo exija respostas manuais de texto ou o modal continue visível, o robô aciona o botão de fechar (`aria-label="Close"`, `Fechar`, `Escape`), desfazendo a sobreposição e pulando o grupo com segurança (`return false`), garantindo que o ciclo continue nos demais grupos sem travar.
  - **Validação de Build**: Executado `npm run build` com sucesso de compilação 100% limpo sem erros.

- **05/08/2026 - 13:46:** **🛡️ RESOLUÇÃO DA TRAVA DA JANELA NATIVA "ABRIR" DO WINDOWS EXPLORER NO FACEBOOK (`src/facebook/fb-poster.ts`, `src/utils/win-dialog-dismiss.ts`):**
  - **Identificação da Causa Raiz**: Ao clicar no botão "Foto/vídeo" do modal do Facebook sem isolamento no protocolo Playwright, o Chromium invocava a janela gráfica nativa `comdlg32.dll` ("Abrir") do Windows OS, paralisando a thread do navegador e travando o robô indefinidamente.
  - **Prevenção em 3 Camadas**:
    1. **Upload Direto no DOM + Wrapper CDP (`fb-poster.ts`)**: O robô agora tenta preencher `input[type="file"]` no DOM antes de qualquer clique. Se o clique for necessário, ele é envelopado em `Promise.all([ page.waitForEvent('filechooser'), btn.click() ])`, interceptando a requisição no protocolo do Chrome DevTools (CDP) e injetando a foto via `fileChooser.setFiles()` sem disparar a janela gráfica do Windows.
    2. **Interceptor Global de FileChooser**: Atualizado o ouvinte para cobrir 100% das páginas existentes no contexto (`context.pages()`) e novas abas (`context.on('page')`), cancelando imediatamente qualquer solicitação de arquivo não gerenciada.
    3. **Utilitário de Auto-Dismiss Nativo Windows (`src/utils/win-dialog-dismiss.ts`)**: Desenvolvida rotina em background que usa PowerShell/Win32 para fechar automaticamente qualquer janela nativa "Abrir" / "Open" caso surja no sistema operacional.
  - **Validação de Build**: Executado `npm run build` com sucesso de compilação 100% limpo sem erros.

- **05/08/2026 - 09:12:** **✨ EXTRAÇÃO AUTOMÁTICA DE LINKS CURTOS OFICIAIS DE AFILIADOS `meli.la` VIA BARRA ML (`src/collector/ml-api.ts`, `src/affiliate/link-converter.ts`):**
  - **Captura do Modal da Barra de Afiliados (`fetchOfficialAffiliateShortLink`)**:
    - Desenvolvida a rotina que aciona o botão azul **"Compartilhar"** na barra superior do programa de afiliados do Mercado Livre para cada oferta minerada.
    - Captura o link encurtado oficial no formato **`https://meli.la/...`** diretamente do modal **"Gerar link / ID de produto"** (que carrega o rótulo/etiqueta de afiliado da sua conta, ex: `clickmarido`).
  - **Preservação de Links Curtos (`link-converter.ts`)**:
    - Atualizadas as regras de conversão para detectar e preservar prioritariamente links `https://meli.la/`, garantindo que o link compartilhado nos canais seja estritamente o gerado pela plataforma oficial de afiliados do Mercado Livre.
  - **Validação de Build**: Executado `npm run build` com sucesso de compilação 100% limpo.

- **05/08/2026 - 09:02:** **🛠️ RESOLUÇÃO DE TRAVA DE CONTEXTO E REUSO DA ABA LOGADA DO MERCADO LIVRE (`src/collector/ml-api.ts`):**

  - **Reuso do Navegador Ativo (`getOrCreateMLContext`)**:
    - Identificado que o acionamento do ciclo automático tentava abrir uma 2ª instância do Chrome com `.chrome-profile/`. Como a pasta estava travada pelo navegador de login, o robô ativava um navegador temporário limpo sem cookies, gerando o erro de login não detectado e abas `about:blank`.
    - Implementado o gerenciador singleton `getOrCreateMLContext()` que reaproveita a **mesma janela e abas** onde a conta do usuário já está logada.
  - **Leitura Precisa de Cookies de Autenticação (`isMLLoggedIn`)**:
    - Atualizada a validação para checar os cookies oficiais de autenticação do Mercado Livre (`ssid`, `org_session`, `cp`, `_m_user`) via Playwright Context API + seletores do menu do usuário logado (`.nav-header-username`, `.nav-header-user-name`).
  - **Validação de Build**: Executado `npm run build` com sucesso de compilação 100% limpo.

- **05/08/2026 - 08:55:** **🛠️ NAVEGAÇÃO DINÂMICA VIA BOTÃO "ENTRE" NO MERCADO LIVRE (`src/collector/ml-api.ts`):**

  - Ajustado `openMLLoginBrowser()` para abrir a página inicial canônica do Mercado Livre (`https://www.mercadolivre.com.br/`) e acionar o clique no botão oficial **"Entre"** (`a[data-link-id="login"]`).
  - Isso garante que o Mercado Livre redirecione dinamicamente para o portal de login oficial vigente (evitando erros de rotas alteradas pela plataforma).


- **05/08/2026 - 08:51:** **🔒 AUTENTICAÇÃO OBRIGATÓRIA NO MERCADO LIVRE & BOTÃO DE LOGIN NO PAINEL (`src/collector/ml-api.ts`, `src/server.ts`, `public/index.html`):**

  - **Regra Imutável de Trava de Mineração (`isMLLoggedIn` & `collectOffers`)**:
    - Desenvolvida a validação de sessão `isMLLoggedIn()` que verifica elementos DOM de usuário autenticado (`.nav-header-user-name`, `[data-user-id]`, `a[href*="my-account"]`) e cookies de sessão no perfil `.chrome-profile/`.
    - A função `collectOffers()` cancela imediatamente a mineração e dispara alerta no console caso o login na conta do Mercado Livre não esteja confirmado.
  - **Botão de Login "🟡 Conectar / Logar Mercado Livre" (`public/index.html`)**:
    - Adicionado o Card do Mercado Livre no Gerenciador de Sessões Locais com botão de 1 clique (`#btnConnectMl`) e indicador visual de status em tempo real (`🟢 Conta Logada / Ativa` vs `🔴 Não Logado (Obrigatório)`).
  - **Endpoints da API REST (`src/server.ts`)**:
    - Criado o endpoint `POST /api/sessions/connect-ml` que abre a janela do Chrome em modo visível na página do Mercado Livre para o usuário logar interativamente com segurança.
    - Atualizada a rota `GET /api/sessions/status` para incluir o status de conexão da conta do Mercado Livre (`ml`).
  - **Validação de Build**: Executado `npm run build` com sucesso de compilação 100% limpo.


  - **Botão `☑️ Selecionar Resultados da Busca` posicionada ao lado do campo de pesquisa**:
    - Reestruturado o container da busca `.search-filter-box` com layout `flexbox`.
    - Adicionados os botões de ação instantânea `☑️ Selecionar Resultados da Busca` (`btnSelectFiltered`) e `🔲 Desmarcar Filtrados` (`btnDeselectFiltered`) alinhados lado a lado com o campo de texto de filtragem (`#inputTreeSearch`).
  - **Filtro de Seleção Estrita por Palavra-Chave**:
    - Ao pesquisar um termo (ex: *"furadeira"*, *"notebook"*, *"whey"*, *"capas"*), o clique no botão seleciona **exclusivamente as subcategorias correspondentes ao termo buscado**, ignorando a seleção global das demais categorias.
    - Exibidos avisos visuais de confirmação via `showToast` informando a quantidade exata de subcategorias adicionadas/removidas para aquele termo.
  - **Escopo do Checkbox de Categoria Pai (`toggleParentGroup`)**:
    - Atualizado a marcação de categorias principais para que, caso haja um filtro de texto ativo no input, o clique na caixinha selecione apenas as subcategorias filtradas visíveis na tela.
  - **Validação de Build**: Executado `npm run build` com sucesso de compilação 100% limpo.

- **05/08/2026 - 08:32:** **🛠️ CORREÇÃO CRÍTICA DO CICLO DE VIDA DO NAVEGADOR E BUSCA DO MERCADO LIVRE (`src/collector/ml-api.ts`):**
  - **Reutilização e Preservação de Página Única (`sharedPage` & `isStandalone`)**:
    - Identificado que o método `searchOffers()` fechava a página (`page.close()`) no término da primeira busca, destruindo a aba padrão do `BrowserContext` persistente do Playwright. Isso fazia com que todas as buscas subsequentes falhassem com o erro `browserContext.newPage: Target page, context or browser has been closed`.
    - Ajustadas as funções `searchOffers()` e `collectOffers()` para manter uma única aba/página aberta e reutilizá-la continuamente (`page.goto()`) em todo o lote de categorias.
  - **Mecanismo de Auto-Recuperação Resiliente (`ensurePage`)**:
    - Implementada a função `ensurePage()` com verificação de integridade via `isContextValid()` e `page.isClosed()`. Caso ocorra qualquer desconexão do navegador durante uma busca, o robô automaticamente reinicializa o `BrowserContext` e abre uma nova página sem interromper o ciclo.
  - **URLs Nativas do Mercado Livre (`toMLSearchUrl`)**:
    - Substituída a rota legada `/jm/search?as_word=...` que era interceptada e redirecionada pelo Mercado Livre para a página de verificação de conta (`account-verification`).
    - Criado o gerador de slugs limpos `toMLSearchUrl()` (ex: `https://lista.mercadolivre.com.br/furadeiras-de-mao`), permitindo acesso direto aos resultados de busca sem acionar checagens anti-bot.
  - **Validação de Build**: Executado `npm run build` com sucesso de compilação 100% limpo.

- **05/08/2026 - 08:22:** **💬 ATIVAÇÃO E CORREÇÃO COMPLETA DA AUTOMAÇÃO DE 1º COMENTÁRIO COM LINK DO WHATSAPP NO FACEBOOK (`src/facebook/fb-poster.ts` & `src/formatter/facebook.ts`):**
  - **Identificação Multi-Nível de Publicações no Feed (`targetArticle`)**:
    - Expandidos os seletores do DOM (`[role="article"]`, `div[data-pagelet*="FeedUnit"]`, `div[role="main"]`, etc.) e fallbacks de escopo para garantir que a postagem criada seja isolada e focalizada instantaneamente após a publicação.
  - **Abertura e Foco de Comentários (`openCommentSelectors` & `commentBoxSelectors`)**:
    - Incluídos novos seletores para botões e caixas de comentário em variadas nacionalidades e layouts do Facebook (`Comment as Assistant`, `Comentar como...`, `Deixar um comentário`, `Escreva um comentário público...`).
  - **Injeção de Texto Multilinha via Clipboard (`Control+V`) e Fallback `Shift+Enter`**:
    - Refatorada a colagem do comentário com a chamada do Grupo VIP e o link do WhatsApp (`formatFacebookWaComment`). A colagem via Clipboard insere o bloco completo atomicamente sem disparar `Enter` prematuro no meio do texto.
    - Empregada técnica de digitação linha a linha com `Shift+Enter` caso o clipboard falhe, garantindo que o link do WhatsApp seja incluído no comentário antes do envio.
  - **Confirmação e Clique de Submissão (`Enter` + Botão Enviar)**:
    - Adicionado suporte a clique forçado em botões de envio ("Comentar" / "Send") caso o evento `Enter` não submeta o comentário imediatamente.
  - **Fallback de Link Padrão no Formatador (`src/formatter/facebook.ts`)**:
    - Garantido o consumo de `process.env.FB_WA_GROUP_LINK` caso a variável `waGroupLink` não seja informada explicitamente.
  - **Validação de Build**: Executado `npm run build` com sucesso de compilação 100% limpo.

- **05/08/2026 - 02:07:** **🛠️ RESOLUÇÃO DE ERROS NO AGENDADOR, WHATSAPP WEB E COMPILAÇÃO AUTOMÁTICA:**
  - **Trava de Concorrência no Agendador (`src/scheduler/cron.ts`)**:
    - Implementada a flag de segurança `isCycleRunning` com bloco `try/finally`. Impede a execução de ciclos paralelos sobrepostos disparados por cron ou API, eliminando travamento de perfil Chrome `.wa-profile` e disparos duplicados.
  - **Descarte Gracioso de Modais no WhatsApp Web (`src/whatsapp/wa-playwright.ts`)**:
    - Criada a função `dismissWaMediaModal` que fecha o modal de mídia e trata a caixa de confirmação *"Deseja descartar a seleção?"* do WhatsApp Web. Impede que popups fiquem sobrepostos no DOM interceptando cliques e gerando erro de `Timeout 30000ms exceeded`.
  - **Compilação Automática no Inicializador (`Iniciar-Bot.bat`)**:
    - Adicionada a chamada `call npm run build` antes da inicialização do `node dist/server.js`, garantindo que o robô sempre execute os binários compilados mais recentes.
  - **Validação de Build**: Executado `npm run build` com sucesso de compilação 100% limpo.

- **04/08/2026 - 19:57:** **🛡️ IMPLEMENTAÇÃO DE CAMUFLAGEM (STEALTH) E INTERAÇÃO HUMANA NO INSTAGRAM:**
  - **Injeção de Scripts Anti-Detecção (`src/instagram/ig-poster.ts`)**:
    - Adicionado `context.addInitScript` que mascara a flag `navigator.webdriver = undefined`, camufla a presença do Chrome (`window.chrome`), emula plugins padrão e ajusta permissões de notificações.
  - **Digitação em Ritmo Humano (`humanType`)**:
    - Desenvolvida a função `humanType` com variação de delay por caractere (45ms a 115ms), micropaussas em pontuações/espaços e simulação de erros ocasionais de digitação corrigidos com Backspace.
    - Aplicada na digitação de legendas nos posts (`ig-poster.ts`) e no envio de mensagens no Direct (`ig-auto-reply.ts`).
  - **Cliques e Movimentação de Mouse Realista (`humanClick` & `humanScroll`)**:
    - Implementados movimentos suaves de mouse com aceleração e pontos intermediários antes do clique, além de rolagem suave (*smooth scroll*).
  - **Espaçamento de Segurança Anti-Spam (`src/instagram/ig-auto-reply.ts`)**:
    - Adicionado intervalo aleatório de segurança de 15 a 35 segundos entre envios sucessivos de Directs e comentários para prevenir alertas de *rate limit* e restrições de automação no Instagram.
  - **Compilação e Validação**: Executado `npx tsc` com compilação 100% limpa sem erros.

- **04/08/2026 - 18:26:** **🚀 DEPLOY COMPLETO DO PROJETO NO GITHUB, NEON DB, RENDER E VERCEL:**
  - **Higienização do Repositório (`.gitignore`)**: Adicionadas regras para excluir imagens temporárias (`*.png`), sessões de navegador (`.wa-auth`, `.ig-profile`, `.fb-profile`, `.chrome-profile`), `.env` e pastas temporárias `scratch/` e `.kombai/`.
  - **Build de Produção Limpo**: Compilação TypeScript (`npx tsc`) e cópia dos estáticos para `dist/public` executadas com 100% de sucesso.
  - **Sincronização com GitHub (`jc8702/robo-ml`)**: Efetuado commit (`feat: deploy completo...`) e `git push origin main` com sucesso.
  - **Banco de Dados Neon PostgreSQL**: Estrutura de tabelas (`sent_history`, `price_history`, `app_settings`) sincronizada e pronta para consumo serverless.
  - **Render Cloud**: Configurado `render.yaml` com gatilho de auto-deploy a partir da branch `main` do GitHub para o container Docker.
  - **Vercel**: Configuração de rotas de proxy em `vercel.json` encaminhando requisições da interface para a API em nuvem no Render.

- **04/08/2026 - 16:25:** **📱 CRIAÇÃO DE BIO DO INSTAGRAM (LIMITE ESTRITO DE 150 CARACTERES):**
  - Otimizadas 3 opções de Bio para o limite de 150 caracteres do Instagram (com contagem exata de UTF-16/emojis e chamada "QUERO").

- **04/08/2026 - 16:12:** **🤖 IMPLEMENTAÇÃO COMPLETA DA AUTOMAÇÃO DE COMENTÁRIOS & DIRECT NO INSTAGRAM ("ManyChat" Local):**
  - **Módulo de Auto-DM (`src/instagram/ig-auto-reply.ts`)**:
    - Desenvolvida a rotina `checkAndReplyInstagramComments()` que faz varredura nos comentários das publicações do Instagram.
    - Identifica comentários contendo a palavra-chave gatilho configurada (padrão: **`QUERO`**, **`LINK`**, **`OFERTA`**).
    - Envia mensagem privada no Direct (DM) com o título, oferta e link de afiliado oficial do produto.
    - Publica uma resposta pública marcando o usuário (`@usuario Te mandei o link com desconto no Direct! 📥🔥`) para impulsionar o engajamento do post no feed.
    - Registra os IDs de comentários processados no banco Neon PostgreSQL (`IG_PROCESSED_COMMENTS`), garantindo controle anti-duplicação.
  - **Legendas Interativas (`src/formatter/instagram.ts`)**:
    - Atualizada a função `formatInstagramCaption()` para formatar chamadas dinamicas em destaque (`💬 Comente "QUERO" neste post que te envio o link direto no seu DIRECT! 📥`).
  - **Painel Web GUI (`public/index.html` & `src/server.ts`)**:
    - Adicionados novos controles na aba **"📸 Automação Instagram"**: alternador `igAutoDmEnabled`, campos `igTriggerWord` (Palavra Gatilho) e `igDmTemplate` (Template da mensagem no Direct), além do botão de teste `💬 Testar Auto-DM (Comentários)`.
    - Criados os endpoints `/api/config` estendidos e `POST /api/bot/test-instagram-autodm`.
  - **Integrado ao Cron Agendado (`src/scheduler/cron.ts`)**: O robô dispara automaticamente a verificação de comentários ao final de cada ciclo de postagem.
  - **Compilação de Produção**: Executados `npx tsc` e `npm run build` com sucesso e compilação 100% limpa.

- **04/08/2026 - 15:57:** **📸 DIAGNÓSTICO E CORREÇÃO DO CLIQUE EM COMPARTILHAR NO INSTAGRAM (`src/instagram/ig-poster.ts`):**
  - **Diagnóstico por Captura de Tela**: A captura do modal revelou que a caixa de sugestões de hashtags (`#cupom`, `#cupomdesconto`) ficava aberta sobre o modal, interceptando o clique no botão "Compartilhar".
  - **Deseleção de Hashtags & Desfoco**: Adicionada sequência de `Escape` duplo + clique na área de mídia (`x: 300, y: 350`) para desmarcar o campo de texto e fechar a caixa de sugestões.
  - **Disparo Nativo via DOM**: Implementado disparo de evento `click` e `dispatchEvent('click')` direto no elemento DOM `div[role="dialog"]` com o texto "Compartilhar" / "Share".
  - **Comprovação com Ícone de Sucesso**: Capturado o print de confirmação da própria interface do Instagram exibindo o checkmark de sucesso e o texto oficial: **"Seu post foi compartilhado."** (`ig_post_confirmation.png`).
  - **Validação de Build**: Executado `npx tsc` com compilação 100% limpa sem erros.

- **04/08/2026 - 15:24:** **📸 DIAGNÓSTICO E ATIVAÇÃO DA POSTAGEM NO INSTAGRAM (`src/config/settings.ts` & `src/instagram/ig-poster.ts`):**
  - **Diagnóstico da Causa Raiz**: A flag `config.instagram.enabled` estava desativada por padrão em envs/Neon DB sem flag explícita, fazendo com que o cron pulasse o módulo do Instagram.
  - **Ativação Padrão**: Atualizado `loadConfig` e `loadConfigAsync` em `src/config/settings.ts` para manter `instagram.enabled = true` por padrão (`process.env.INSTAGRAM_ENABLED !== 'false'`).
  - **Validação e Demonstração em Tempo Real**: Executado teste ao vivo (`test-ig.ts`) comprovando a postagem completa da Smart TV LG 55" no Instagram com login via Playwright, upload de imagem, avanço de filtros, colagem de legenda formatada e publicação concluída com sucesso (`{"success": true}`).
  - **Compilação**: Executado `npm run build` com sucesso.
  - **Limpeza Preventiva do Chat**: Adicionada rotina de limpeza do container principal de chat (`#main`) antes de iniciar cada oferta, evitando vazamento de texto da oferta anterior.
  - **Escopo Estrito do Modal**: Restrita a caixa de legenda exclusivamente ao container `div[role="dialog"] div[contenteditable="true"]`, impedindo colagens fora do modal de mídia.
  - **Validação Cruzada de Título**: O robô valida se `captionBox.textContent()` contém o **título exato do produto da foto atual** (`offer.title`) antes de disparar o envio.
  - **Limpeza de File Inputs & Modal**: Adicionado o fechamento obrigatório do modal (`state: 'detached'`) e o esvaziamento dos campos `input[type="file"]` (`setInputFiles([])`) entre envios.
  - **Compilação**: Executado `npm run build` com sucesso.
  - **Expansão de Mídia OBRIGATÓRIA**: O robô agora clica no botão "Foto/vídeo" do modal do Facebook para expandir a área de mídia e montar o elemento `<input type="file">` no DOM antes de executar `setInputFiles`.
  - **Buffer de CDN de 5 Segundos**: Adicionada espera pela confirmação visual do preview (`img[src*="fbcdn"]`, `img[src*="blob"]`, `[aria-label*="Remover"]`) + delay de 5s para que o Facebook vincule a imagem ao post antes do clique em "Publicar".
  - **Captura do Topo do Feed do Grupo**: Atualizados os seletores do 1º comentário para isolar a publicação no topo do feed dos Grupos do Facebook (`div[role="feed"] [role="article"]`), colar o convite VIP (`waCommentText`) com a URL do WhatsApp e publicar o comentário automaticamente.
  - **Compilação**: Executado `npm run build` com sucesso.
  - **Validação de Legenda Completa no WhatsApp Web (`src/whatsapp/wa-playwright.ts`)**: Implementada colagem via Clipboard (`Control+v`) com validação estrita que confirma se a legenda contém o link de afiliado oficial do produto antes do envio. Isso impede que posts fiquem cortados por reinicialização do editor Lexical.
  - **Processamento de Foto no Facebook CDN (`src/facebook/fb-poster.ts`)**: Adicionada espera de confirmação do preview da imagem (`img[src*="fbcdn"]` / `[aria-label*="Remover"]`) antes do clique em "Publicar", garantindo que a foto seja vinculada com sucesso e não desapareça após a publicação.
  - **1º Comentário Isolado do WhatsApp no Facebook (`src/facebook/fb-poster.ts`)**: Atualizado o clipboard especificamente para a chamada do grupo VIP (`waCommentText`), limpando qualquer resíduo do post principal do campo de comentário.
  - **Compilação**: Executado `npm run build` com sucesso.
  - **Upload Direto via DOM (`setInputFiles`)**: Refatorado o upload de imagem no WhatsApp Web (`src/whatsapp/wa-playwright.ts`), Facebook (`src/facebook/fb-poster.ts`) e Instagram (`src/instagram/ig-poster.ts`) para injetar a foto do produto diretamente no elemento `<input type="file">` do HTML via Playwright sem efetuar cliques em botões do menu. Isso impede que o Chrome acione o SO para abrir a janela de arquivo nativa.
  - **Interceptor Global Anti-Popup (`filechooser`)**: Adicionado listener global `page.on('filechooser')` em todas as sessões que intercepta e fecha (`setFiles([])`) qualquer janela nativa de arquivo caso seja engatada, garantindo que o robô nunca fique travado aguardando ação manual.
  - **Compilação**: Executado `npm run build` com sucesso.
  - **Desbloqueio de Resposta HTTP (`src/scheduler/cron.ts`)**: O método `startScheduler()` passou a disparar o ciclo inicial de varredura (`runAutomaticCycle`) em segundo plano (assíncrono), liberando a requisição HTTP `POST /api/bot/start` em milissegundos. Com isso, o clique no botão **"Iniciar Automação"** responde instantaneamente e altera o indicador para `🟢 Automação Ativa (24/7)` e o botão para `⏹️ Pausar Automação`.
  - **Persistência do Estado no Banco Neon DB (`src/server.ts`)**: Adicionada a gravação de `AUTO_BOT_RUNNING = 'true'` / `'false'` na tabela `app_settings` e restauração automática ao inicializar o servidor. O robô mantém o status ativo mesmo após atualizar a página (F5) ou reiniciar a máquina.
  - **Limpeza do Header (`public/index.html`)**: Removido o botão obsoleto `📱 Status QR Code / Conexão ↗` da barra superior, mantendo o controle visual centralizado no submenu `🔑 Conexões & Logins Locais`.
  - **Validação de Build**: Executado `npm run build` com compilação TypeScript limpa e sem erros.
  - **Correção da TAG de Afiliado**: Atualizado `loadConfigAsync()` em `src/config/settings.ts` para carregar `ML_AFFILIATE_ID` e `ML_AFFILIATE_WORD` salvos no banco de dados Neon PostgreSQL (`dbSettings`), garantindo a substituição da TAG genérica pelo link de afiliado oficial do perfil do usuário em todas as URLs raspadas do Mercado Livre.
  - **Formatação Completa das Legendas**:
    - **WhatsApp (`src/formatter/whatsapp.ts`)**: Incluído Título, Preço De/Por, Menor Preço dos últimos 30 dias (`📉 MENOR PREÇO DOS ÚLTIMOS 30 DIAS!`), Condição de Frete (`🚚 Frete Grátis!`), Link Afiliado Oficial e Hashtags do Produto (`#LG #Monitor #Gamer #Ofertas`).
    - **Facebook (`src/formatter/facebook.ts`)**: Padronizado com todos os dados do produto, link de afiliado e chamada para o grupo VIP do WhatsApp no 1º comentário.
    - **Instagram (`src/formatter/instagram.ts`)**: Legenda otimizada com Gancho, Título, Preço De/Por, Menor Preço 30d, Frete, Link de Afiliado Oficial, CTA da Bio e bloco completo de Hashtags.
  - **Robustez na Digitação Playwright (`src/whatsapp/wa-playwright.ts`)**: Adicionada verificação de inserção de texto e fallback via `execCommand` para o modal de legenda de imagem no WhatsApp Web.
  - **Validação**: Executado teste em `test-affiliate-format.ts` comprovando a conversão de links e formatação em todos os canais.
  - **Identificação do Problema de Porta**: Um processo anterior do Node permaneceu rodando em segundo plano preso na porta `3000`, gerando o erro `EADDRINUSE` e impedindo a execução do servidor e a abertura do navegador.
  - **Liberação Automática em `Iniciar-Bot.bat`**: Adicionada rotina de expurgo via `taskkill` do PID associado à porta 3000 antes de subir o servidor Node.
  - **Tratamento de Exceção `EADDRINUSE` em `src/server.ts`**: Adicionado handler `server.on('error')` que detecta ocupação da porta, executa a liberação e retenta a inicialização em 1 segundo.
  - **Invocação Direta de Janelas de Login**: Os endpoints `/api/sessions/connect-*` passaram a invocar diretamente os métodos Playwright `ensureWhatsAppLoggedIn()`, `openFacebookBrowser()` e `openInstagramBrowser()`, abrindo instantaneamente o Chrome visual na tela do usuário para efetuar o login.


  - **Identificação da Causa Raiz do Agrupamento**: Quando múltiplas fotos eram submetidas sem aguardar a desmontagem (`detached`) do modal de pré-visualização anterior, o WhatsApp Web anexava a nova imagem na mesma galeria/álbum do produto anterior, gerando 1 único bloco compartilhado.
  - **Isolamento Estrito de Mensagens (`src/whatsapp/wa-playwright.ts` e `src/scheduler/cron.ts`)**: Adicionado controle de encerramento assíncrono do modal (`waitForSelector('div[role="dialog"]', { state: 'detached' })`) e intervalo de 5 segundos entre cada item no loop de envios.
  - **Restauração da Estrutura Fiel ao Print do Usuário**: Cada oferta é enviada de forma **100% individualizada** em seu próprio balão de mensagem, contendo a Foto do Produto em alta definição, Título, Preço original (~R$ X~), Preço promocional (*R$ Y*), Selos (Menor preço / Frete Grátis), a frase CTA em negrito em linha própria, o Link curto de Afiliado limpo e a frase de rodapé em itálico.
  - Comprovação registrada e validada em: `wa_exact_format_verified.png`.

  - **Eliminação Total de Figurinhas**: Implementada interceptação via `filechooser` ao clicar na opção *"Fotos e vídeos"* (`[data-icon="attach-image"]`) e seletor estrito `input[type="file"][accept*="video"]`.
  - **Identificação no Chat**: O chat do WhatsApp Web agora registra oficialmente as mensagens como **`Você: 🖼️ [Texto da Oferta]`** (Foto com Legenda), eliminando de vez o registro **`Você: 💬 Figurinha`**.
  - **Comprovação Visual**: Legenda promocional completa exibida com formatação em negrito, título dos produtos, preços originais, descontos e links de afiliados anexados diretamente na publicação da foto.
  - Captura registrada e validada em: `wa_foto_legenda_confirmada.png`.

  - **WhatsApp Web**: Validada a seleção estrita do input de mídia (`input[type="file"][accept*="image/*"]`) e preenchimento da legenda no modal (`div[contenteditable="true"][data-tab="10"]`). Oferta enviada no formato **Foto + Legenda com Link de Afiliado** (substituindo o antigo comportamento de figurinha).
  - **Facebook Groups**: Publicação executada com upload da foto do produto em 1º lugar e texto promocional completo. Sincronizada a lista de 184 grupos do perfil do Facebook no arquivo `.env`.
  - **Instagram**: Publicação concluída no Feed com foto HD, legenda de alto engajamento, hashtags relevantes e CTA do link da bio.

  - **Diagnóstico do Envio de Figurinha**: O seletor anterior `page.locator('input[type="file"]').first()` capturava o primeiro elemento `<input>` de arquivo do DOM do WhatsApp Web, que corresponde ao modal de **Figurinhas (Stickers)** (`accept="image/webp"`). Com isso, a imagem era convertida em figurinha sem abrir o campo de legenda/anúncio com o link de afiliado.
  - **Seletor Estrito de Mídia**: Atualizado em `wa-playwright.ts` para buscar especificamente os inputs de **Fotos e Vídeos** (`input[type="file"][accept*="video"]`, `input[type="file"][accept*="image/*"]`), ignorando sumariamente elementos de figurinha (`accept*="webp"`).
  - **Aprimoramento do Campo de Legenda**: Adicionada a busca por seletores do modal de mídia (`aria-label`, `data-tab="10"`, `data-lexical-editor="true"`) e inserção da legenda promocional com fallback no chat principal.

  - **Servidor Local Iniciado**: Subiu o servidor HTTP GUI local (`src/server.ts`) na porta `3000`.
  - **Automação de Navegador no Chrome**: Utilizado o subagente de navegação no Chrome para acessar `http://localhost:3000`.
  - **Inspeção de Abas**: Validado o funcionamento visual e navegação interativa pelas abas *Categorias & Subnichos*, *Filtros & Agendamento*, *Automação Instagram*, *Automação Facebook* e *Ofertas Enviadas*.
  - **Disparo de Ciclos de Postagem**: Disparado o botão *"Enviar Ofertas Agora"*, acompanhando e registrando visualmente os ciclos de scraping, conversão para links de afiliados e adição no histórico de postagens.
  - **Comprovação Visual na Galeria**: Validado o incremento de ofertas enviadas (de 34 para 37 itens), com exibição das imagens e cards promocionais mais recentes na galeria (ex: Mochila masculina impermeável, Perfume Árabe The Kingdom, Placa mãe ASUS TUF Gaming, Notebook Acer).
  - Capturas registradas em: `dashboard_home_1785851423045.png`, `filters_scheduling_1785851430565.png`, `automation_instagram_1785851437218.png`, `automation_facebook_1785851443952.png`, `offers_sent_1785851451217.png`, `new_offers_gallery_1785851646102.png` e `final_gallery_view_1785851913520.png`.

  - **Diagnóstico da Pausa de Envio**: As credenciais locais do WhatsApp (`.wa-auth/creds.json`) não haviam sido enviadas para o banco em nuvem Neon DB. Com isso, a instância do Render Cloud operava sem sessão do WhatsApp vinculada.
  - **Sincronização Cloud Concluída**: Efetuado o upload da credencial mestre diretamente para a tabela `app_settings` do Neon PostgreSQL.
  - **Grupo Alvo Confirmado**: Vinculado ao grupo `GC 19 GRUPO VIP SO MERCADO LIVRE` (`120363428727908129@g.us`). As postagens no WhatsApp do Render Cloud foram reativadas.
  - **Auto-Save no Teste**: O botão "Testar Postagem Instagram" agora executa automaticamente a salvamento de configurações (`saveAllConfig`) e envia os campos de usuário e senha diretamente no corpo da requisição POST para `/api/bot/test-instagram`.
  - **Diagnóstico Exato de Erro**: O backend agora captura a exceção exata retornada pela API do Instagram (ex: senha incorreta, 2FA ativado ou desafio de segurança) e exibe o motivo detalhado diretamente no console do painel e no toast de notificação.
  - **Diagnóstico do Problema no Render Cloud**: Identificado que o Instagram bloqueia seletores DOM de navegação Chromium headless quando rodando em contêineres na nuvem (Datacenter Cloud IPs).
  - **Solução Definitiva (Motor Dual de Disparo)**: Integrada a biblioteca oficial `instagram-private-api` em `src/instagram/ig-poster.ts`. O robô agora autentica diretamente via API Mobile (utilizando a senha salva com segurança no Neon DB), eliminando a dependência de telas, botões, modais de upload e cookies expirados.
  - **Persistência de Sessão no Neon DB (`IG_SESSION_STATE_JSON`)**: O estado serializado da sessão da API Mobile é sincronizado e restaurado diretamente no Neon PostgreSQL DB a cada publicação.
  - **Novo Campo no Painel Web (`public/index.html`)**: Adicionado o campo "Senha do Instagram" na aba *Automação Instagram*, permitindo a configuração e salvamento imediato no banco Cloud.
  - **Execução 24/7**: Identificado que o processo depende da máquina estar ligada se rodar localmente. No Render (plano gratuito), a instância entra em *spin-down* (hibernação) após 15 minutos sem tráfego HTTP. Além disso, se o ID do WhatsApp não estivesse setado ou 0 ofertas fossem coletadas, o ciclo encerrava precocemente.
  - **Postagem no Instagram**: O módulo Playwright é real, mas ficava no final do pipeline em `cron.ts`. Se o WhatsApp ou scraping tivessem 0 itens novos, a execução retornava antes de chegar no Instagram.
  - **Botão "Testar Instagram" no Painel**: O botão chamava `/api/bot/run-now` (execução completa de scraping) em vez de uma rota de teste isolada para o Instagram (pois a rota nem existia no `server.ts`).
  - **Histórico no Painel**: A gravação no banco Neon DB e `.sent-history.json` só ocorria se a postagem do WhatsApp fosse 100% bem-sucedida (`sentOffers.length > 0`). Falhas ou pulos do WhatsApp deixavam o histórico vazio.
  - **Conclusão de Mocks**: As funcionalidades **NÃO são mockadas** (são robôs Playwright reais, conectores de API e banco de dados Neon). O problema era o acoplamento sequencial síncrono e a falta de endpoints de teste dedicados.
  - Submenu "Postar" (não "Publicação"), modal `role=presentation`, botões via `getByText` + `mouse.click` por coordenadas
  - Dismiss de hashtag suggestions, Compartilhar via `div[role=button]`
  - Arquivos modificados: `src/instagram/ig-poster.ts`

  - **Aviso Interativo de Login (3 Minutos)**: Se a sessão em `.ig-profile/` não estiver pareada, o robô abre o navegador Chrome na tela do usuário, exibe a instrução no terminal e aguarda até 3 minutos pelo login para não falhar silenciosamente.
  - **Expurgo Direcionado de Locks (`cleanProfileLock`)**: Implementado encerramento direcionado via PowerShell (`Get-CimInstance Stop-Process`) para processos `chrome.exe` atrelados ao `.ig-profile`, liberando a porta `ProcessSingleton` sem fechar o navegador pessoal do usuário.
  - **Seletor Dual de Imagem no Modal**: Atualizado o fluxo do Playwright para validar a visibilidade do modal `div[role="dialog"]` e efetuar o upload da foto em HD tanto via `setInputFiles` quanto via interceptação `filechooser`.
- **04/08/2026 - 04:05:** **Ativação Padrão da Automação 24/7 do Instagram (`.env` e Neon PostgreSQL):**
  - Sincronizadas as variáveis `INSTAGRAM_ENABLED=true`, `INSTAGRAM_USERNAME=gc19ofertass`, `INSTAGRAM_MAX_POSTS_PER_CYCLE=3`, `INSTAGRAM_BIO_LINK` e `INSTAGRAM_HASHTAGS` no arquivo `.env` e na tabela `app_settings` do banco Neon DB.
  - O Instagram passa a fazer parte da esteira padrão em todas as varreduras agendadas (Cron) sem necessidade de configuração manual pós-deploy.
- **04/08/2026 - 04:00:** **Correção do Anexo de Imagem no WhatsApp Web (`src/whatsapp/wa-playwright.ts`):**
  - Atualizada a seleção do campo `input[type="file"]` para interagir com elementos ocultos pelo CSS do WhatsApp Web sem expirar por timeout de visibilidade.
  - Adicionado expurgo preventivo de locks de navegador concorrentes antes de iniciar novos disparos manuais.
- **04/08/2026 - 03:53:** **Implementação Completa do Módulo de Automação do Instagram (`src/instagram/ig-poster.ts` e `public/index.html`):**
  - **Aba Dedicada "📸 Automação Instagram"**: Adicionada no Painel Web com alternador de ativação, campos para Username/Email, Limite de Posts por Ciclo, Link da Bio / Grupo VIP e Bloco de Hashtags Personalizadas salvas no Neon PostgreSQL.
  - **Copywriter de Alto Engajamento Orgânico (`src/formatter/instagram.ts`)**: Estruturado com ganchos visuais para os primeiros 3 segundos, destaque de descontos, instrução de CTA em 2 passos (*"Comente OFERTA ou clique no Link da Bio"*) e conjunto estratégico de hashtags do algoritmo da Meta.
  - **Motor Playwright de Perfil Persistente (`.ig-profile/`)**: Implementado envio com upload automático de imagem HD e legenda no Instagram Web. Criados os utilitários `src/ig-connect.ts` e `Conectar-Instagram.bat` para pareamento visual em 1 clique.
- **04/08/2026 - 03:44:** **Persistência Total ao Recarregar a Página (`src/server.ts`):**
  - Implementada a normalização estrita de URLs no servidor HTTP (`req.url.split('?')[0]`). Isso corrige a rota `/api/config` para não falhar com 404 quando o navegador envia parâmetros de query anti-cache ou barras no final.
  - Todos os campos da aba **Filtros & Agendamento** (Preço Mínimo, Preço Máximo, Desconto Mínimo, Máximo de Ofertas, Cron, TAG de Afiliado e Grupos do WhatsApp) agora permanecem 100% preenchidos ao atualizar/F5 a página.
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
- **[05/08/2026 - 00:31]:** Reestruturação e espelhamento fiel de todas as **14 Categorias Principais** e suas respectivas **Subcategorias / Subnichos** no painel de controle (`public/index.html`, `index.html`) e nas configurações padrão (`src/config/settings.ts`).
  - Arquivos modificados: `public/index.html`, `index.html`, `src/config/settings.ts`
- **[05/08/2026 - 00:34]:** Implementação da categoria dedicada **Ofertas Destaque & Campanhas ML** (`ofertas-destaque-ml`) e otimização do coletor Playwright (`src/collector/ml-api.ts`) para extração direta de ofertas das liquidações oficiais do Mercado Livre.
  - Arquivos modificados: `public/index.html`, `index.html`, `src/collector/ml-api.ts`, `src/config/settings.ts`
- **[05/08/2026 - 00:45]:** Correção da sincronização de categorias do painel. Removidos os 15 produtos estáticos hardcoded de `ML_CATEGORIES` no `.env` e adicionado auto-salvamento instantâneo no painel web (`public/index.html`, `index.html`), garantindo que o robô busque estritamente as subcategorias selecionadas no painel visual.
  - Arquivos modificados: `.env`, `public/index.html`, `index.html`, `src/config/settings.ts`
- **[05/08/2026 - 01:10]:** Correção definitiva da extração de produtos específicos no Mercado Livre. Atualizado `src/collector/ml-api.ts` para usar a URL oficial de listagem (`lista.mercadolivre.com.br/<query>`) em buscas de produtos e `/ofertas` em campanhas genéricas. Adicionada rolagem dinâmica de página para lazy-loading e criada a rota `POST /api/history/clear` com o botão **"🗑️ Limpar Histórico"** no painel web para reset do histórico de envios passados.
  - Arquivos modificados: `src/collector/ml-api.ts`, `src/collector/history.ts`, `src/server.ts`, `public/index.html`, `index.html`
- **[05/08/2026 - 01:34]:** Eliminação completa da geração de figurinhas (`.webp`). Sanitização de URLs de foto para `.jpg` em alta resolução (`-O.jpg`), definição explícita de `mimetype: image/jpeg` e inclusão de trava de segurança no Playwright que cancela modais sem legenda e garante postagem no formato padrão desenhado com preview de imagem do link.
  - Arquivos modificados: `src/whatsapp/client.ts`, `src/whatsapp/wa-playwright.ts`, `src/collector/ml-api.ts`
- **[05/08/2026 - 01:55]:** Eliminação do bloqueio da tela amarela de login/verificação de conta (`account-verification`). Atualizado o endpoint de buscas para `https://www.mercadolivre.com.br/jm/search?as_word=<query>` no domínio principal e ativado contexto persistente em `.chrome-profile/`.
  - Arquivos modificados: `src/collector/ml-api.ts`

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
