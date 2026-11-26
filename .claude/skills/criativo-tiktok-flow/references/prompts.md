# Modelos de prompt e formato do roteiro

Adaptados dos módulos `script-planner`, `character-designer` e `prompt` do SaaS (branch `plano-2-pipeline`).

## roteiro.json

```json
{
  "oferta": "nome-da-oferta",
  "modo": "novelinha",
  "personagens": [
    { "id": "ana", "nome": "Ana", "descricao": "mulher de ~40 anos, cabelo castanho preso, camiseta cinza, olhar cansado", "imagem": "personagens/ana.png" }
  ],
  "cenas": [
    {
      "n": 1,
      "segundos": 8,
      "fala": "Fala exata da cena, em português do Brasil. Vazio se não houver.",
      "acao": "Ação, enquadramento, cenário e luz. Sem descrever a aparência dos personagens.",
      "personagens": ["ana"],
      "keyframeInicio": "keyframes/cena-01-inicio.png",
      "keyframeFim": null
    }
  ]
}
```

## Regras do roteiro

- Cenas de 3 a 10 segundos (8 é o ponto de partida). Cabem ~2,5 palavras faladas por segundo.
- No Grok a tela só tem 6s, 10s e 15s. O script mede a fala e escolhe a menor dessas em que o texto cabe sem pressa. Frase curta fica em 6s. Fala que não cabe em 15s (~42 palavras, ou menos se houver mais de uma pessoa) precisa ser dividida em duas cenas.
- A cena 1 abre com gancho nos primeiros 1 a 2 segundos. A última fecha com a chamada para ação da copy.
- Cada cena avança a história (novelinha) ou continua a mesma pessoa e cenário (UGC).
- Preferir poucos personagens por cena. Se houver mais de 2 em destaque, avise o usuário: aumenta o risco de o rosto derivar.
- `keyframeFim` só quando a cena tem muita ação (ex.: começa fazendo careta, termina sorrindo).
- No Grok, `grokRef` é o título da referência no Imagine. O script insere o chip `@`. `imagem` guarda o retrato usado para criar essa referência. O prompt de vídeo não descreve a aparência.

## Prompt de personagem (imagem, grátis)

> Retrato de corpo inteiro de um personagem, fundo neutro liso, luz suave de estúdio, enquadramento vertical 9:16, imagem de referência para manter o mesmo personagem em várias cenas. Personagem: {nome}. {descricao}

Gere pelo menos 2 saídas e deixe o usuário escolher.

## Prompt de keyframe (imagem, grátis)

> Quadro vertical 9:16 de uma novela dramática, estilo cinematográfico, mesmo personagem da imagem de referência. Cena: {acao}. Momento: {início | fim} da cena.

Use as imagens de `personagens/` como referência. Aprove a sequência inteira lado a lado: mesma roupa, mesma luz, mesmo rosto.

## Prompt de vídeo (Omni, cena n)

Salvar em `prompts/cena-NN.txt`.

> Vídeo vertical 9:16 em estilo {UGC: filmado com celular, luz natural, câmera na mão, aparência real e sem retoque | novelinha: cinematográfico de novela dramática, iluminação de cena, interpretação expressiva}. Duração: {segundos} segundos.
> {acao}
> Fala em português do Brasil, dita em voz alta, com a boca sincronizada: "{fala}"
> (sem fala: "Sem fala nesta cena.")

Primeiro teste: se o Omni ignorar a fala ou errar o idioma, anote em `references/flow.md` (perguntas abertas) e ajuste a redação antes de regerar.
