# Kickoff: começando a implementação

Guia para o Guilherme. Leva uns 10 minutos até o agente estar trabalhando.

## 1. Pré-requisitos

- Node 22 ou maior, pnpm, Docker, `ffmpeg` e `ffprobe` (`ffmpeg -version`)
- [Claude Code](https://claude.com/claude-code)
- Recomendado: plugin **superpowers** no Claude Code (instale pelo `/plugin`). Os planos foram escritos para as skills dele (`subagent-driven-development`, `executing-plans`). Sem o plugin, o prompt abaixo funciona do mesmo jeito, executando as tasks à mão.
- Chave da Gemini API (`GEMINI_API_KEY`), que o Lucas fornece. **Só é necessária no spike e nos testes ao vivo**; todo o resto roda sem ela.

## 2. Clonar e abrir

```bash
git clone https://github.com/melointhecloud/gerador-criativo.git
cd gerador-criativo
claude
```

O Claude Code carrega o `CLAUDE.md` da raiz sozinho: ele já traz o contexto, as decisões fechadas e as regras de custo e de segurança.

## 3. Prompt de partida

Cole no Claude Code:

````text
Você vai implementar o Gerador de Criativos TikTok neste repositório. Eu sou o Guilherme, o desenvolvedor; o Lucas é o dono do produto.

Comece lendo, nesta ordem:
1. CLAUDE.md
2. docs/superpowers/specs/2026-11-03-gerador-criativos-tiktok-design.md
3. docs/superpowers/plans/2026-11-03-gerador-criativos-00-index.md

Depois execute o Plano 1 (docs/superpowers/plans/2026-11-03-gerador-criativos-01-fundacao.md), task por task, na ordem, seguindo cada passo (teste falhando, implementação, teste passando, commit). Use a skill superpowers:subagent-driven-development se estiver disponível; senão, superpowers:executing-plans.

Regras:
- Crie o branch plano-1-fundacao e trabalhe nele. Um commit por task.
- O código dos planos nunca foi executado. Se algo divergir da realidade (tipo, API de biblioteca, teste), confirme na documentação oficial, corrija o código E o plano no mesmo commit e me avise.
- NÃO rode a Task 3 (spike do provider de vídeo) nem testes ao vivo sem me perguntar antes: eles gastam crédito da Gemini. Pule a Task 3, continue com as demais e me diga quando chegar a hora de rodá-la.
- Antes de dar cada task por concluída, rode pnpm test e pnpm typecheck.
- Ao terminar o plano, abra um PR para main e me resuma: o que foi feito, divergências dos planos e o que ficou pendente.

Comece agora pela Task 1.
````

## 4. Depois do Plano 1

Repita o prompt trocando "Plano 1" e o branch pelos do próximo plano:

| Ordem | Plano | Branch |
|---|---|---|
| 1 | `…-01-fundacao.md` | `plano-1-fundacao` |
| 2 | `…-02-pipeline.md` | `plano-2-pipeline` |
| 3 | `…-03-web-e-deploy.md` | `plano-3-web-deploy` |

Antes da **Task 11 do Plano 2** (provider de vídeo real), rode o spike (Plano 1, Task 3) com a chave da Gemini e preencha `docs/provider-spike.md`. Se o Gate 2 (fala em pt-BR numa única geração) falhar, pare e avise o Lucas.

## 5. Checklist de entrega

- [ ] `pnpm test` e `pnpm typecheck` verdes
- [ ] Teste de fumaça local com `PROVIDER=fake` (Plano 3, Task 6, Steps 1–4)
- [ ] `docs/provider-spike.md` preenchido com os 4 gates
- [ ] Deploy no Railway: `web` e `worker` (1 réplica), com as variáveis do README
- [ ] Teste de fumaça de produção com o provider real (Plano 3, Task 6, Step 6), 2 cenas só
- [ ] Senha do time e `SESSION_SECRET` definidos no Railway; nada de segredo no repositório
