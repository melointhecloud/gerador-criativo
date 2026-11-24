# Gerador de Criativos para TikTok Ads

Ferramenta do time para gerar criativos em vídeo (**novelinha** e **UGC**) com o Claude e o Google Flow. Você manda a copy, aprova o roteiro e recebe as cenas em vídeo vertical (9:16).

## Começar (2 minutos, sem mexer em código)

**Antes, tenha:** o Claude com Claude Code (Claude Desktop → aba **Code**, ou VS Code), o **Google Chrome** e uma **conta Google com plano do Flow** e créditos.

1. Abra o Claude Code em uma pasta qualquer (por exemplo, `Documentos`).
2. Cole o texto abaixo e deixe o Claude trabalhar. Ele pergunta antes de instalar qualquer coisa.

```text
Quero usar o gerador de criativos para TikTok Ads. Eu não sou técnico: fale em português simples, uma coisa por vez, e peça o meu ok antes de instalar qualquer programa. Não gaste nenhum crédito do Flow nesta etapa.

1. Baixe o projeto com: git clone https://github.com/melointhecloud/gerador-criativo.git
   (se o git não estiver instalado, me ajude a instalar e tente de novo).
2. Entre na pasta gerador-criativo, leia os arquivos .claude/commands/setup-criativos.md e docs/SETUP-CRIATIVOS.md e execute o setup descrito neles, aqui mesmo nesta conversa: conferir o meu computador, instalar o que faltar (Node.js, ffmpeg, jq), rodar o npm install do script, me guiar no login da minha conta do Flow e mostrar uma demonstração sem custo.
3. No final, me diga exatamente como abrir a pasta gerador-criativo no Claude (como pasta do projeto, em uma conversa nova) para eu pedir o meu primeiro criativo.
```

3. Siga o que o Claude pedir (ele vai abrir uma janela do Chrome para você entrar na conta do Flow, uma vez só).
4. Depois, abra a pasta `gerador-criativo` no Claude e peça: *"Criar um criativo de novelinha com esta copy: ..."*

O Claude **sempre mostra quantos créditos vai gastar e só gasta com o seu ok**. Comece com 1 a 3 cenas.

## Mais informações

- Guia completo, passo a passo e problemas comuns: [docs/SETUP-CRIATIVOS.md](docs/SETUP-CRIATIVOS.md)
- Como o Claude gera as cenas: [.claude/skills/criativo-tiktok-flow/references/flow-script.md](.claude/skills/criativo-tiktok-flow/references/flow-script.md)
- Custos (Flow e limite do Claude): [docs/CUSTOS-CLAUDE-CODE.md](docs/CUSTOS-CLAUDE-CODE.md)
- Exemplo completo: [criativos/emagrecimento-teste-20261119/](criativos/emagrecimento-teste-20261119/)
- Para quem desenvolve: [CLAUDE.md](CLAUDE.md)

> Este repositório está público por enquanto. Nunca suba chaves, senhas, vídeos nem dados reais de clientes.
