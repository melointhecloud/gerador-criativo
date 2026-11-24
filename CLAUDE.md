# CLAUDE.md — Gerador de Criativos TikTok

Contexto para qualquer agente (ou pessoa) que trabalhe neste repositório. Leia inteiro antes de mexer em código.

## O que é

Ferramenta interna, para 2–3 pessoas, que gera criativos em vídeo para TikTok Ads em dois formatos: **UGC** (pessoa falando para a câmera) e **novelinha** (história com personagens). O usuário escolhe o modo, envia a copy, aprova o roteiro dividido em cenas, aprova (ou regera) cada cena gerada e recebe um MP4 vertical 9:16 com as cenas concatenadas.

- **Dono do produto:** Lucas (decide escopo e provider).
- **Desenvolvedor:** Guilherme (implementa).
- **Idiomas:** textos da interface e prompts em português do Brasil; identificadores de código em inglês.

## Caminho atual (2026-11-19): skill local + Google Flow

Por causa do custo da API (~R$ 5 por segundo de vídeo), o Lucas pausou o SaaS descrito abaixo e adotou uma **skill local** que gera pelo Google Flow (assinatura com créditos). A skill está em `.claude/skills/criativo-tiktok-flow/` e foi validada com um teste de 3 cenas de novelinha (fala em pt-BR, lip sync e rosto aprovados pelo Lucas).

- **Quem clonou agora:** rode `/setup-criativos` (guia em `docs/SETUP-CRIATIVOS.md`).
- **Modo script (2026-11-24):** `scripts/flow/flow.mjs criativo <pasta> --projeto <url> --sim` gera todas as cenas pelo Chrome (Playwright via CDP), coleta links, baixa com `--baixar` e retoma por `flow-estado.json`. Guia: `.claude/skills/criativo-tiktok-flow/references/flow-script.md`. Setup para o time: `docs/SETUP-CRIATIVOS.md`.
- **Regras da skill:** vídeo sempre em x2; imagens são grátis no Flow; mostrar os créditos antes de gerar; download só com ok do usuário.
- **Custos:** Flow em `.claude/skills/criativo-tiktok-flow/references/flow.md`; Claude Code em `docs/CUSTOS-CLAUDE-CODE.md`.
- **SaaS:** as branches `plano-2-pipeline` e `plano-3-web-deploy` ficam congeladas como alternativa. As seções abaixo descrevem esse SaaS e **não são o caminho atual** (a decisão "Omni via API" está suspensa).
- **Próximo passo:** gerar um criativo completo (2 a 4 minutos) e depois integrar as skills de edição de vídeo.

## Estado atual (do SaaS)

Só existe documentação. **Não há código ainda.** Comece pelo Plano 1.

| O quê | Onde |
|---|---|
| Design aprovado | `docs/superpowers/specs/2026-11-03-gerador-criativos-tiktok-design.md` |
| Índice dos planos | `docs/superpowers/plans/2026-11-03-gerador-criativos-00-index.md` |
| Plano 1: fundação | `docs/superpowers/plans/2026-11-03-gerador-criativos-01-fundacao.md` |
| Plano 2: pipeline | `docs/superpowers/plans/2026-11-03-gerador-criativos-02-pipeline.md` |
| Plano 3: web e deploy | `docs/superpowers/plans/2026-11-03-gerador-criativos-03-web-e-deploy.md` |
| Como começar | `docs/KICKOFF.md` |

## Decisões fechadas (não reabrir sem falar com o Lucas)

- **Fluxo:** briefing → (personagens, só novelinha) → roteiro em cenas → geração das cenas → revisão → montagem. Cada etapa só avança com aprovação do usuário.
- **UGC:** o usuário envia imagens de referência (produto, pessoa). **Novelinha:** a ferramenta gera os personagens, o usuário aprova, e cada cena usa as imagens dos personagens que aparecem nela.
- **Provider de vídeo: Gemini Omni (`gemini-omni-1.1-flash`)**, decidido pelo Lucas em 2026-11-03. O Veo 3.x preview foi desligado em 22/10/2026 e não deve ser usado.
- **Montagem:** só concatenar as cenas aprovadas em um MP4. Sem legendas, trilha ou transições.
- **Duração:** livre; o número de cenas vem do roteiro aprovado.
- **Acesso:** senha única do time, sem contas de usuário.
- **Stack:** TypeScript, Next.js (App Router), Postgres + Drizzle, Zod v4, Vitest, ffmpeg, Docker. Deploy no Railway: serviço `web`, serviço `worker` (1 réplica), Postgres e Bucket S3-compatível.
- **Arquitetura:** `web` nunca gera vídeo; enfileira jobs no Postgres e o `worker` executa. Gemini fica atrás das interfaces `TextModel`/`ImageModel`/`VideoModel`, com implementação falsa para testes.

## Como trabalhar

1. Execute os planos **em ordem** (1 → 2 → 3), **task por task**, seguindo os passos de cada uma (teste falhando → implementação mínima → teste passando → commit). Os planos têm código completo; use-o como ponto de partida.
2. Se a skill `superpowers:subagent-driven-development` estiver disponível, use-a; senão, `superpowers:executing-plans`; senão, siga o plano à mão.
3. Um branch por plano (`plano-1-fundacao`, `plano-2-pipeline`, `plano-3-web-deploy`) e um PR para `main` ao final de cada um, para o Lucas revisar. Commits pequenos, um por task.
4. Antes de dar uma task por concluída, rode `pnpm test` e `pnpm typecheck`.

## Os planos nunca foram executados

O código dos planos foi escrito sem rodar. Espere erros de tipo, API de biblioteca diferente da documentada ou testes que precisem de ajuste. Quando acontecer:

- confirme o comportamento real na documentação oficial da biblioteca ou do Gemini (`https://aistudio.google.com/docs/omni` para o Omni);
- corrija o código **e o plano** no mesmo commit, para o próximo leitor não tropeçar;
- registre divergências relevantes na descrição do PR.

## Custo: peça confirmação antes

Duas coisas gastam crédito da chave Gemini. **Pergunte ao Guilherme antes de rodar**, e rode uma vez só:

- o spike do provider de vídeo (Plano 1, Task 3): 2 gerações de vídeo;
- testes `tests/live` (`LIVE=1`) e o teste de fumaça com provider real (Plano 3, Task 6, Step 6).

Todo o resto roda com providers falsos (`PROVIDER=fake`), sem custo.

## Quando parar e avisar o Lucas

- O spike mostrar que o Omni **não fala em português numa única geração** (Gate 2). Não escolha alternativa sozinho: as opções são o fluxo de extensão multi-turn do Omni ou o Veo 3.1 GA na Vertex, e a escolha muda custo e UX. Os Planos 1 e 2 (até a Task 10) e o Plano 3 continuam possíveis com providers falsos enquanto isso.
- O Gate 3 (referências preservam a identidade) falhar de forma que inviabilize a novelinha.
- Qualquer mudança de escopo: nova etapa, edição de vídeo, contas de usuário, outro provider.

## Regras de segurança

- Nunca commitar `.env`, chaves, senhas ou arquivos de `storage-data/` ou `spike-out/` (já estão no `.gitignore`).
- Segredos só em variáveis de ambiente (`.env` local, variáveis do Railway em produção).
- Todo endpoint e todo arquivo servido exigem a sessão (cookie assinado); não criar rota pública.
- **O repositório está público desde 2026-11-24** (decisão do Lucas, "por enquanto", para os sócios clonarem sem convite). Por isso: nada de chaves, senhas, links de projetos do Flow nem dados de clientes/ofertas reais em arquivos versionados (`flow-estado.json` e vídeos já estão no `.gitignore`). Voltar a privado ou adicionar colaboradores só com o Lucas.

## Convenções de código

- Imports com alias `@/` (= `src/`); exceção: `src/db/*` e `tests/helpers/global-setup.ts` usam caminhos relativos.
- Regras de negócio ficam em `src/services`; route handlers só validam entrada (Zod) e chamam serviços; módulos em `src/modules` fazem uma coisa cada e recebem dependências por parâmetro (`Deps`).
- IDs de modelo do Gemini (texto, imagem) vêm de variáveis de ambiente; não fixar no código.
- Textos para o usuário e mensagens de erro de negócio em português do Brasil.
