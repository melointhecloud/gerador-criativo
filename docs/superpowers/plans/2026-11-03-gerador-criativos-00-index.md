# Gerador de Criativos TikTok — Índice dos planos

Spec: `docs/superpowers/specs/2026-11-03-gerador-criativos-tiktok-design.md`

Execute na ordem. Cada plano termina com software testável.

| # | Plano | Entrega | Pré-requisito |
|---|---|---|---|
| 1 | `2026-11-03-gerador-criativos-01-fundacao.md` | Tooling, config, **spike do provider de vídeo**, banco, estados, domínio do roteiro, providers fake, storage, fila | — |
| 2 | `2026-11-03-gerador-criativos-02-pipeline.md` | ffmpeg, planejador de roteiro, personagens, serviços, handlers de cena/personagem/montagem, runner do worker, providers reais | Plano 1 |
| 3 | `2026-11-03-gerador-criativos-03-web-e-deploy.md` | Auth, API, UI, imagens Docker, deploy Railway, teste de fumaça | Plano 2 |

## Atenção antes de começar

A **Task 3 do Plano 1** (spike) valida se o provider de vídeo atende ao produto. O Veo 3.x preview da Gemini API foi desligado em 22/10/2026; o substituto (`gemini-omni-1.1-flash`) só documenta fala em vídeo ao *estender* um vídeo anterior. Se a fala numa única geração falhar no spike, **pare e decida com o dono do projeto** antes da Task 11 do Plano 2. Os Planos 1 e 2 (até a Task 10) e o Plano 3 não dependem do resultado: usam providers falsos.

## Como executar

Skill recomendada: `superpowers:subagent-driven-development` (um subagente por task, revisão entre tasks). Alternativa: `superpowers:executing-plans`.
