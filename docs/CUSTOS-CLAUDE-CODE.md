# Custo do Claude Code no fluxo de criativos

O Flow gasta créditos (ver `.claude/skills/criativo-tiktok-flow/references/flow.md`). Este documento cobre o **outro custo**: quanto do limite do Claude Code o trabalho consome.

## O que foi medido

Fonte: log da sessão do Claude Code (`~/.claude/projects/<projeto>/<sessão>.jsonl`), campo `usage` de cada resposta. Sessão de 2026-11-19, modelo Sonnet 5.5, cerca de 2h20, **91 respostas do modelo**.

| Tipo de token | Total |
|---|---|
| Saída (texto e comandos que o modelo escreveu) | 79.598 |
| Entrada nova, sem cache | 184 |
| Escrita de cache (contexto novo gravado) | 316.237 |
| Leitura de cache (contexto relido a cada chamada) | 16.679.418 |

Por fase (mesma sessão):

| Fase | Respostas | Saída | Cache novo | Cache lido |
|---|---|---|---|---|
| Conferir branches e discutir estratégia (3 mensagens) | 4 | ~7 mil | ~4 mil | ~0,3 M |
| Medir custos no Flow + montar a skill, scripts e exemplo | 30 | 27 mil | 145 mil | 4,0 M |
| Cena 1 pelo Chrome (Marina + vídeo + links + saldo) | 25 | 12 mil | 45 mil | 5,1 M |
| Carla + cenas 2 e 3 pelo Chrome (+ links + saldo) | 24 | 17 mil | 50 mil | 5,9 M |
| Fechamento (docs, setup, commit) | 3 até aqui | 9 mil | 9 mil | 0,8 M |

## Como ler esses números

- **O que pesa não é o que o Claude escreve, é o que ele relê.** Cada chamada ao modelo (inclusive cada clique no Chrome) reenvia o contexto inteiro da conversa. Nesta sessão o contexto ficou entre 80 mil e 250 mil tokens, então cada resposta releu isso de novo. Por isso 91 respostas viraram 16,7 M de leitura de cache.
- Leitura de cache é bem mais barata que token comum, mas **não dá para converter tokens em "% do limite de 5h" por conta**: o Claude Code não grava essa porcentagem no log e o peso exato depende do plano. Qualquer número em % sem medir seria chute.
- **Modo assistido (Chrome) é o caro.** Cada cena ocupa de 8 a 12 respostas (abrir seletor, anexar referência, digitar, conferir custo, enviar, esperar, abrir links), e cada print de tela entra no contexto. Os dois blocos de Chrome gastaram cada um mais de 5 M de leitura de cache para gerar 1 cena e 2 cenas.
- **Modo manual é quase de graça no Claude Code.** O usuário gera no Flow e o Claude só escreve prompts, calcula créditos e confere arquivos (a fase de montar a skill gastou 4 M mesmo escrevendo muito código).

## Projeção para um criativo completo (estimativa, não medição)

Premissas: 23 cenas (3 minutos de 8s), cada uma gerada pelo Chrome, sessão nova começando com ~80 mil de contexto e crescendo.

| Cenário | Respostas | Leitura de cache aproximada | Saída aproximada |
|---|---|---|---|
| Assistido, 10 respostas por cena, contexto médio de 150 mil | ~230 | ~35 M | ~150 mil |
| Assistido, otimizado (6 respostas por cena, contexto de 100 mil) | ~140 | ~14 M | ~90 mil |
| Manual (só texto, checagens) | ~40 | ~4 M | ~40 mil |

Em comparação, o teste de 3 cenas gastou ~11 M de leitura de cache. Um criativo de 23 cenas no modo assistido sem otimizar fica na faixa de **3 vezes** isso.

## Como reduzir

1. **Sessão nova para cada criativo ou lote** (por exemplo, 6 cenas por sessão). O contexto reinicia pequeno e cada chamada fica mais barata.
2. **Gere em lote:** enfileire a cena N+1 enquanto a cena N renderiza (foi o que funcionou) e agrupe cliques e esperas na mesma chamada.
3. **Menos prints:** use screenshot só para decidir onde clicar; leia o texto da página quando der.
4. **Use o manual para cenas fáceis** e o assistido só quando o tempo do usuário valer mais.
5. **Menos plugins carregados** reduz o contexto inicial: nesta sessão, o contexto já começava em torno de 80 mil.

## Como medir a porcentagem real do seu limite (2 minutos)

1. No Claude Code, rode `/usage` (ou `/status`) e anote o percentual da janela de 5h.
2. Gere **1 cena** no modo assistido numa sessão nova.
3. Rode `/usage` de novo. A diferença é o custo de 1 cena no seu plano. Multiplique pelo número de cenas.
4. Faça o mesmo com um criativo manual (só prompts e checagens) para ter o outro extremo.

Para recontar tokens de uma sessão, use o script `contar-tokens.sh` desta mesma pasta de scripts da skill:
`.claude/skills/criativo-tiktok-flow/scripts/contar-tokens.sh <arquivo-da-sessão.jsonl>`
