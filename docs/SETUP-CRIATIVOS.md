# Setup do gerador de criativos (skill local + Google Flow)

Para quem acabou de clonar o repositório. Leva uns 5 minutos.

## O que você precisa

| Item | Para quê |
|---|---|
| [Claude Code](https://claude.com/claude-code) | roda a skill |
| Conta Google com plano do [Flow](https://flow.google.com) e créditos | gera personagens (grátis) e vídeos (gastam créditos) |
| `ffmpeg`, `jq` e `bash` | checagens dos vídeos e cálculo de custo |
| Extensão **Claude in Chrome** (opcional) | só para o modo assistido, em que o Claude opera o Flow por você |

## Passo a passo

1. Clone o repositório e abra a pasta no Claude Code.
2. Rode o comando de setup:

   ```
   /setup-criativos
   ```

   Ele roda `scripts/doctor.sh`, ajuda a instalar o que faltar, confere sua conta do Flow, mostra uma demonstração sem custo e explica como usar.

3. Se preferir não usar o comando, **cole este prompt** no Claude Code:

   > Configure este repositório para eu usar o gerador de criativos. Rode `.claude/skills/criativo-tiktok-flow/scripts/doctor.sh`, me ajude a corrigir o que falhar, pergunte se estou logado no Flow e quantos créditos tenho, mostre a estimativa de créditos do criativo de exemplo e me explique como criar meu primeiro criativo com a skill `criativo-tiktok-flow`. Não gere nada no Flow nem gaste créditos nesta etapa.

4. Só rodar o doctor, sem o Claude:

   ```bash
   .claude/skills/criativo-tiktok-flow/scripts/doctor.sh
   ```

## Como usar depois do setup

Peça em linguagem natural, por exemplo:

> Criar um criativo de novelinha com esta copy: ...

O fluxo, com a sua aprovação em cada etapa: briefing, personagens, roteiro, prompts com custo em créditos, geração das cenas, checagem dos arquivos. Cada criativo fica em `criativos/<oferta>-<data>/`.

Regras de custo:
- Vídeo sempre com **x2** (1 prompt, 2 saídas); você escolhe a melhor.
- Imagens (personagens, keyframes) não gastam crédito.
- O Claude mostra os créditos antes de cada geração de vídeo e só gasta com a sua autorização.
- Comece com 1 a 3 cenas antes de gerar um criativo inteiro.

Leia também:
- `.claude/skills/criativo-tiktok-flow/references/flow.md`: tabela de custos e passo a passo do Flow.
- `.claude/skills/criativo-tiktok-flow/references/flow-assistido.md`: como o Claude opera o Flow pelo Chrome.
- `docs/CUSTOS-CLAUDE-CODE.md`: quanto do limite do Claude Code cada modo consome.
- `criativos/emagrecimento-teste-20261119/`: um criativo de exemplo completo (briefing, roteiro, prompts, notas).

## Problemas comuns

- **Doctor reclama de `column`:** instale `bsdmainutils` (Ubuntu) ou `util-linux`.
- **O Flow mostrou outro custo:** confie na tela ("A geração vai usar N créditos") e atualize `references/flow.md`.
- **Vídeos sumindo do Flow:** ele expira criações antigas; baixe as cenas aprovadas no mesmo dia.
