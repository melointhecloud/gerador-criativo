---
description: Configura o ambiente do gerador de criativos (Flow), roda uma demonstração sem custo e explica como usar
---

Você vai deixar o ambiente da skill `criativo-tiktok-flow` pronto para esta pessoa e guiá-la no primeiro uso. Fale em português do Brasil, com frases curtas.

## 1. Verificar o ambiente

Rode `.claude/skills/criativo-tiktok-flow/scripts/doctor.sh` a partir da raiz do repositório e mostre o resultado.

- Se faltar ferramenta (ffmpeg, jq...), diga o comando de instalação para o sistema dela e **pergunte antes de instalar** (pode exigir sudo). Depois rode o doctor de novo até passar.
- Não avance com o doctor falhando.

## 2. Conferir os passos manuais

Pergunte, uma coisa por vez:
1. Ela está logada em https://flow.google.com com a conta que vai gastar créditos? Qual plano e quantos créditos tem agora (avatar, canto superior direito)?
2. Quer usar o modo **manual** (ela gera no Flow, você escreve os prompts) ou o **assistido** (você opera o Flow pelo Chrome)? Se assistido, confirme que a extensão Claude in Chrome está conectada. Explique em uma frase que o assistido gasta mais do limite do Claude Code (ver `docs/CUSTOS-CLAUDE-CODE.md`).

## 3. Demonstração sem custo

Com o doctor passando, mostre a estimativa de créditos do criativo de exemplo (`criativos/emagrecimento-teste-20261119/`) contra o saldo dela e explique em duas linhas o que é: uma novelinha de 3 cenas, 48 créditos por cena de 8s no x2, imagens grátis. Não gere nada no Flow nesta etapa.

## 4. Como usar daqui para frente

Diga a ela, em poucas linhas:
- Para criar um criativo: peça "criar um criativo de novelinha (ou UGC) com esta copy: ..." ou invoque a skill `criativo-tiktok-flow`.
- O fluxo tem aprovação em cada etapa: briefing, personagens (novelinha), roteiro, prompts e custo, geração das cenas, checagem.
- Regras de custo: vídeo sempre em x2; imagens são grátis; o Claude sempre mostra os créditos antes de qualquer geração de vídeo e só gasta com autorização dela.
- Primeiro criativo: comece com 1 a 3 cenas para ver como sai.
- A edição final (legenda, efeitos) ainda não está integrada.

Termine perguntando se ela quer começar um criativo agora.
