# Gerador de Criativos TikTok

Ferramenta interna (2 a 3 pessoas) para gerar criativos em vídeo vertical 9:16 para TikTok Ads, em dois formatos: UGC (pessoa falando para a câmera) e novelinha (história com personagens). O fluxo é briefing, personagens (só novelinha), roteiro em cenas, geração das cenas, revisão e montagem em um MP4; cada etapa só avança com a aprovação do usuário.

Docs: `docs/superpowers/specs/` (design) e `docs/superpowers/plans/` (planos de implementação).

## Rodar localmente (sem custo, providers falsos)

Requisitos: Node 22 ou maior, pnpm (versão fixada em `packageManager`, use `corepack enable`), Docker e ffmpeg (o worker usa `ffmpeg` e `ffprobe`).

```bash
cp .env.example .env              # PROVIDER=fake já é o padrão do exemplo
docker compose up -d              # Postgres em localhost:5433
pnpm install
pnpm db:migrate
pnpm worker                       # terminal 1
pnpm dev                          # terminal 2: http://localhost:3000
```

Se a porta 5433 já estiver em uso, escolha outra: `POSTGRES_PORT=5434 docker compose up -d` e ajuste a porta em `DATABASE_URL` no `.env` (e em `TEST_DATABASE_URL`, se usar). A senha de acesso é o valor de `ACCESS_PASSWORD` no `.env`.

- `next start` (produção) grava o cookie de sessão com `Secure`: funciona em HTTPS e em `localhost`, mas não em `http://` por IP da rede. Para testar na rede local, use `pnpm dev`.
- No modo fake, o texto de teste nunca cita personagens por rótulo; por isso as cenas não mostram referências por cena nem o aviso de corte.
- `agentRules` desligado em `next.config.ts` para o `next dev` não criar arquivos (como `AGENTS.md`) no repositório.
- Voltar ao roteiro e gerar de novo só gera as cenas sem tentativa aprovada (cenas editadas e novas); se todas estiverem aprovadas, vai direto à revisão sem custo.

## Testes

```bash
docker compose up -d
pnpm test                         # usa o banco gerador_test
pnpm typecheck
```

O banco de teste vem de `TEST_DATABASE_URL` (padrão `postgres://postgres:postgres@localhost:5433/gerador_test`; pode ficar no `.env` ou no ambiente). Com outra porta: `TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5434/gerador_test pnpm test`.

Atenção, custo: os testes `tests/live` (`LIVE=1`) e qualquer geração com provider real gastam crédito da chave Gemini. Só rode com o aval do dono do produto, e uma vez só.

## Variáveis de ambiente

Validadas em `src/config/env.ts`. O processo falha na partida se alguma obrigatória faltar.

| Variável | Obrigatória | Padrão | Significado |
|---|---|---|---|
| `DATABASE_URL` | sim | | URL do Postgres. |
| `PROVIDER` | não | `gemini` | `gemini` ou `fake`. O padrão é `gemini` de propósito (em produção exige chave); o `.env.example` usa `fake`. |
| `GEMINI_API_KEY` | se `PROVIDER=gemini` | | Chave da API Gemini. |
| `GEMINI_TEXT_MODEL` | se `PROVIDER=gemini` | | ID do modelo de texto. |
| `GEMINI_IMAGE_MODEL` | se `PROVIDER=gemini` | | ID do modelo de imagem (personagens). |
| `GEMINI_VIDEO_MODEL` | não | `gemini-omni-1.1-flash` | ID do modelo de vídeo. |
| `MAX_SCENE_REFERENCES` | não | `3` | Máximo de imagens de referência por cena (inteiro, mínimo 1). |
| `SCENE_MAX_SECONDS` | não | `8` | Duração máxima de uma cena em segundos (inteiro, mínimo 3). |
| `STORAGE` | não | `fs` | `fs` (disco local, dev) ou `s3` (produção). |
| `LOCAL_STORAGE_DIR` | não | `./storage-data` | Pasta usada quando `STORAGE=fs`. |
| `S3_ENDPOINT` | se `STORAGE=s3` | | Endpoint do Bucket S3-compatível. |
| `S3_REGION` | não | `auto` | Região do Bucket. |
| `S3_BUCKET` | se `STORAGE=s3` | | Nome do Bucket. |
| `S3_ACCESS_KEY_ID` | se `STORAGE=s3` | | Chave de acesso do Bucket. |
| `S3_SECRET_ACCESS_KEY` | se `STORAGE=s3` | | Segredo do Bucket. |
| `ACCESS_PASSWORD` | sim | | Senha única do time. Use uma senha forte, de pelo menos 12 caracteres. |
| `SESSION_SECRET` | sim | | Segredo de assinatura do cookie de sessão, aleatório, com pelo menos 32 caracteres (o código exige 32). |
| `WORKER_CONCURRENCY` | não | `4` | Jobs simultâneos no worker (só o worker usa). |
| `TEST_DATABASE_URL` | não | `postgres://postgres:postgres@localhost:5433/gerador_test` | Só para os testes; não faz parte do schema de produção. |

## Estado do provider Gemini

O provider real **ainda não está implementado**: depende do spike do provider de vídeo (Plano 1, Task 3 / Plano 2, Task 11). Com `PROVIDER=gemini` o worker e o web falham com uma mensagem clara ("Provider Gemini ainda não implementado"). Enquanto isso, só `PROVIDER=fake` funciona, inclusive no Railway para validar a infraestrutura.

## Produção (Railway)

Dois serviços do mesmo repositório, mais o plugin Postgres e um Bucket S3-compatível:

| Serviço | Dockerfile | Comando de início | Observações |
|---|---|---|---|
| `web` | `Dockerfile.web` | padrão da imagem (`next start`, escuta em `$PORT`, que o Railway injeta; localmente, porta 3000) | domínio público; **Pre-deploy command:** `pnpm db:migrate` |
| `worker` | `Dockerfile.worker` | padrão da imagem (`tsx src/worker/main.ts`) | sem domínio; **exatamente 1 réplica** |

Pontos importantes:

- **O worker precisa ser uma única réplica.** O reaproveitamento de jobs travados assume um só worker; duas réplicas disputariam e reexecutariam jobs. O `web` também deve ficar com 1 réplica (o limitador de login é em memória).
- **Redeploy do worker (verificar nas configurações do Railway):** por padrão o Railway pode sobrepor o deploy novo ao antigo, então duas instâncias do worker podem rodar por um tempo curto. A sobreposição é segura no sentido de que o worker novo só pega jobs `queued`, e o reaproveitamento só mexe em jobs `running` travados há mais de 30 min; nenhum job em andamento no worker antigo é tomado. Os handlers não duplicam linhas de domínio (assets, tentativas, vídeo final), mas uma queda entre uma chamada paga ao Gemini e a gravação do resultado pode repetir essa chamada, o que pode gerar cobrança dupla de uma geração (janela conhecida e aceita). O tempo de drenagem padrão pode ser curto: o Railway pode encerrar o worker antigo antes de ele terminar os jobs em andamento; esses jobs são reaproveitados depois de 30 min. Pode haver variáveis do Railway para ajustar a sobreposição e o tempo de drenagem (por exemplo `RAILWAY_DEPLOYMENT_OVERLAP_SECONDS` e `RAILWAY_DEPLOYMENT_DRAINING_SECONDS`; nomes a confirmar na documentação do Railway). Confirme os valores e o comportamento atuais na documentação do Railway antes de depender deles.
- **Migrações:** o `drizzle/` vai dentro da imagem do `web`. Configure `pnpm db:migrate` como Pre-deploy command do `web` (alternativa: comando de início `sh -c "pnpm db:migrate && pnpm start"`). O migrador do Drizzle só aplica o que ainda não foi aplicado, então rodar de novo a cada deploy é seguro. O worker não migra; faça o deploy do `web` antes (ou ao mesmo tempo). O worker não precisa esperar o `web`: se o banco ainda não estiver migrado, ele registra erros nos logs e tenta de novo a cada 2 s até as tabelas existirem. Variáveis inválidas ou `PROVIDER=gemini` (ainda não implementado) fazem o processo encerrar na partida; nesse caso, a política de reinício do Railway (configuração do serviço, não definida pelo Dockerfile) pode reiniciá-lo em loop até a configuração ser corrigida.
- **Postgres:** adicione o plugin e use a `DATABASE_URL` dele nos dois serviços (referência de variável do Railway).
- **Bucket:** crie um Bucket S3-compatível e copie `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID` e `S3_SECRET_ACCESS_KEY` para os dois serviços, com `STORAGE=s3`. Tanto o web (upload e leitura) quanto o worker (geração e montagem) acessam o Bucket.
- **Variáveis nos dois serviços:** `DATABASE_URL`, `PROVIDER`, `STORAGE` e as `S3_*`, `ACCESS_PASSWORD`, `SESSION_SECRET` e, quando o provider real existir, `GEMINI_*`, `MAX_SCENE_REFERENCES`, `SCENE_MAX_SECONDS` (valores do spike). Só o worker usa `WORKER_CONCURRENCY`. Nenhum segredo entra na imagem; tudo vem do ambiente.
- **Login atrás do proxy do Railway:** os endpoints que alteram estado conferem que `Origin` bate com o host da requisição (`X-Forwarded-Host`, ou `Host` se ausente). Se o login pelo navegador responder 403, verifique se o proxy está enviando `X-Forwarded-Host` com o domínio público.

Checklist do primeiro deploy:

1. Criar o projeto no Railway, o plugin Postgres e o Bucket.
2. Criar os serviços `web` (`Dockerfile.web`) e `worker` (`Dockerfile.worker`) e fixar o worker em 1 réplica.
3. Definir as variáveis acima nos dois serviços (comece com `PROVIDER=fake` para validar a infraestrutura).
4. Definir o Pre-deploy command do `web` como `pnpm db:migrate` e gerar o domínio público do `web`.
5. Fazer o deploy; abrir o domínio, entrar com `ACCESS_PASSWORD` e criar um projeto de teste.
6. Conferir nos logs do worker que ele iniciou e processou o job.

## Segurança e operação

- Escolha `ACCESS_PASSWORD` forte (12 caracteres ou mais) e `SESSION_SECRET` aleatório (32 caracteres ou mais, por exemplo `openssl rand -base64 48`). Nunca commite `.env`, chaves ou o conteúdo de `storage-data/` e `spike-out/`.
- O limitador de tentativas de login é em memória e global (30 falhas por 15 minutos, não por IP). Zera quando o `web` reinicia e só vale para uma única réplica do `web`.
- Sair (logout) apenas apaga o cookie: o token é sem estado e continua válido por até 14 dias. Para revogar todas as sessões, troque o `SESSION_SECRET`. Trocar apenas o `ACCESS_PASSWORD` **não** invalida as sessões existentes.
- Os arquivos (imagens, vídeos) só são servidos pela rota autenticada; não há URL pública do Bucket.
- Jobs travados (worker que caiu no meio) são reaproveitados após 30 minutos. `MAX_GENERATION_WAIT_MS` (30 min) e `FFMPEG_TIMEOUT_MS` (10 min) são constantes no código, não variáveis de ambiente; os valores ainda aguardam confirmação do dono do produto.
- Arquivos de imagem substituídos ou removidos (troca da imagem de um personagem, remoção de personagem ou referência, nova proposta de personagens) continuam no Bucket: a interface `Storage` não tem remoção e o spec não define retenção. Limpeza manual por enquanto.
- Remover uma referência ou um personagem depois que o roteiro existe não apaga o roteiro: as cenas que usavam a imagem recebem um aviso na própria cena.
- Custo: gerações reais, testes `LIVE=1` e o teste de fumaça com provider real consomem crédito Gemini. Peça o aval do dono antes.
