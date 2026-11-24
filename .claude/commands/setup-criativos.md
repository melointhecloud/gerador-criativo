---
description: Configura o ambiente do gerador de criativos (Flow), faz o login no Chrome do script, roda uma demonstração sem custo e explica como usar
---

Você vai deixar o ambiente da skill `criativo-tiktok-flow` pronto para esta pessoa (provavelmente não técnica) e guiá-la no primeiro uso. Fale em português do Brasil, com frases curtas, uma coisa por vez. O guia completo está em `docs/SETUP-CRIATIVOS.md`.

## 1. Verificar o ambiente

Rode `bash .claude/skills/criativo-tiktok-flow/scripts/doctor.sh` a partir da raiz do repositório e mostre o resultado em poucas linhas.

- Se faltar ferramenta (node, ffmpeg, jq, Chrome...), diga o comando de instalação para o sistema dela (veja a seção 2 de `docs/SETUP-CRIATIVOS.md`: winget no Windows, brew no macOS, apt no Linux) e **pergunte antes de instalar**. Lembre que, depois de instalar, ela pode precisar fechar e abrir o terminal/app.
- Se faltar só "dependências do script", rode `npm install` em `.claude/skills/criativo-tiktok-flow/scripts/flow` (pode rodar sem perguntar: só baixa a biblioteca do script).
- Rode o doctor de novo até passar. Não avance com ele falhando.

## 2. Login no Flow (uma vez)

Explique em duas frases: o script usa um Chrome separado, só para o Flow, e o login fica salvo nele. Peça para ela **ficar de olho na janela que vai abrir**. Rode:

`node .claude/skills/criativo-tiktok-flow/scripts/flow/flow.mjs login`

(É um comando que espera até 10 minutos; rode em segundo plano e avise quando ela puder entrar.) Ela deve entrar com a conta Google que tem o plano e os créditos do Flow. Quando o comando devolver o saldo, confirme o valor com ela e pergunte qual plano é. Se falhar, use a tabela "Problemas comuns" do guia.

## 3. Demonstração sem custo

Mostre a estimativa de créditos do criativo de exemplo (`criativos/emagrecimento-teste-20261119/`) contra o saldo real dela e explique em duas linhas: uma novelinha de 3 cenas, 48 créditos por cena de 8s no x2, imagens grátis. **Não gere nada no Flow nesta etapa.**

## 4. Como usar daqui para frente

Diga a ela, em poucas linhas:
- Para criar um criativo: "criar um criativo de novelinha (ou UGC) com esta copy: ..." ou invocar a skill `criativo-tiktok-flow`.
- Cada criativo precisa de um **projeto no Flow**: no Chrome do script, abrir https://flow.google.com, clicar em *Novo projeto* e copiar a URL da barra de endereço.
- Etapas com a aprovação dela: briefing, personagens (novelinha; imagens são grátis e ela as gera no Flow com o prompt que você escrever), roteiro, prompts e custo, geração (um comando gera todas as cenas sozinho), checagem.
- Regras de custo: vídeo sempre em x2; imagens grátis; você sempre mostra os créditos antes de qualquer geração e só gasta com o ok dela. O download dos vídeos também só com o ok dela.
- Primeiro criativo: comece com 1 a 3 cenas; depois, lotes de até 6 cenas.
- A edição final (legenda, efeitos) ainda não está integrada.
- Se o script quebrar (o Flow muda a tela de vez em quando), você pode usar o modo assistido e ela deve avisar o Lucas.

Termine perguntando se ela quer começar um criativo agora.
