# Modo script no Grok Imagine

Medido em 2026-11-25 na conta logada, em português, em https://grok.com/imagine. O script não chama a API paga. Ele usa um Chrome separado, com perfil `~/.chrome-grok` (porta 9334).

## O que a tela oferece

- Modo **Vídeo**, áudio ligado (a fala da cena sai no mesmo vídeo).
- Proporção **9:16**.
- Resolução **480p**, **720p** ou **1080p**. O padrão do script é 720p.
- Duração só **6s**, **10s** ou **15s**. Com fala, o script escolhe a menor opção em que a frase cabe a um ritmo natural (~2,5 palavras por segundo, no máximo ~2,8). Uma frase curta vai para 6s, para a cena não continuar depois que a pessoa já terminou de falar. Duas falas ou um texto longo sobem para 10s ou 15s, para ninguém falar acelerado. Acima disso o plano para e pede para dividir a cena. Sem fala, usa o `segundos` do roteiro e sobe para a opção que cobre (8s vira 10s).
- Um envio gera **um** vídeo. `--x 2` manda de novo e gasta a cota outra vez. O padrão é `--x 1`.
- A imagem de `keyframeInicio` entra como primeiro quadro. `keyframeFim` entra como último quadro. Sem keyframe, o Grok cria o quadro a partir do texto.
- O rosto consistente **não** é esse primeiro quadro. É uma referência nomeada no Imagine: no roteiro, `grokRef` (o título, ex.: `Marina`). O script digita `@` e escolhe esse nome, e o chip entra no prompt. O retrato de `imagem` fica em `personagens/` e serve para criar a referência uma vez (aba Referências → Novidades, categoria Personagem). Sem `grokRef`, cada cena inventa outro rosto. Usar o retrato como primeiro quadro trava a cena na foto de estúdio.
- A tela **não mostra saldo**. Cada envio gasta a cota do plano. Sem `--sim`, o comando só imprime o plano.

## Uma vez só

```bash
cd .claude/skills/criativo-tiktok-flow/scripts/flow && npm install   # se o doctor ainda não passou
node grok.mjs login                                                  # abre o Chrome; entre na conta do Grok
```

O login fica nesse perfil. Não use esse Chrome para outra coisa enquanto o script roda. `GROK_CHROME` aponta para outro Chrome; `GROK_CDP`, para outra porta; `GROK_PERFIL`, para outro perfil.

## Dia a dia

Pré-condições: `roteiro.json` aprovado e `prompts/cena-NN.txt` prontos. Para o rosto não mudar entre cenas, cada personagem da cena precisa de `grokRef` igual ao título já criado em Referências. Keyframes continuam opcionais e só definem o quadro de início ou de fim.

1. Plano (não gasta):

   ```bash
   node grok.mjs criativo ../../../../../criativos/<pasta> [--cenas 1-6]
   ```

2. Mostre os envios e as durações ajustadas. Peça o ok.
3. Gerar, em background (cerca de 1 a 2 min por vídeo). Não faça outra coisa no Chrome do Grok no meio.

   ```bash
   node grok.mjs criativo ... --cenas 1-6 --sim --baixar
   ```

4. O estado fica em `grok-estado.json` (separado do `flow-estado.json`). Com `--baixar`, a saída 1 vai para `cenas/cena-NN.mp4`. A variação 2, se `--x 2`, vai para `cenas/alternativas/cena-NN-b.mp4`.

**Retomar:** rode o mesmo comando. Cena com link é pulada. Cena enviada sem link **não é reenviada**. Para refazer, apague a entrada dela em `grok-estado.json`.

## Comandos soltos

```bash
node grok.mjs enviar --prompt <txt> --duracao 8 --mencoes Marina,Carla --imagem quadro.png [--imagem-fim quadro.png] [--resolucao 720p] [--dry-run]
node grok.mjs saldo
node grok.mjs self-test
```

`enviar` sem `--sim` não manda o vídeo. Saída em JSON numa linha. Erro vira `{"ok":false,"erro":"..."}`.

## Se a tela mudar

O script confere os rótulos em português (Vídeo, 9:16, 720p, 6s/10s/15s) e para se não achar. Não chuta outro botão. Atualize este arquivo e o `grok.mjs` juntos.
