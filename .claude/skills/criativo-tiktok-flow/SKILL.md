---
name: criativo-tiktok-flow
description: Use quando o usuário quiser criar um criativo em vídeo para TikTok Ads (novelinha ou UGC) a partir de uma copy, gerando personagens, keyframes e cenas no Google Flow (Omni) em vez de API paga. Também ao retomar um criativo já iniciado na pasta criativos/.
---

# Criativo TikTok via Google Flow (semi-manual)

## Visão geral

Claude faz o trabalho de texto e de organização: briefing, roteiro, prompts, contas de crédito, checagem dos arquivos. A geração acontece no Flow (https://flow.google.com), em um de dois modos:

- **Manual (padrão):** o usuário gera no Flow e baixa os arquivos para a pasta do criativo. Claude não clica em "gerar".
- **Assistido (só quando o usuário pedir):** Claude opera o Flow pelo Chrome na conta logada do usuário. Siga `references/flow-assistido.md`.

Nunca gere vídeo por API paga.

Princípio: **tudo que é imagem é grátis no Flow, vídeo custa crédito.** Por isso a consistência se resolve em imagem (personagens e keyframes) antes de gastar um crédito de vídeo.

## Regras fixas

- Cada etapa só avança com aprovação explícita do usuário.
- Antes de pedir qualquer geração de vídeo, mostre o custo: rode `scripts/estimar-creditos.sh` e compare com o saldo que o usuário informar. Se não couber, proponha cortar cenas ou testar só algumas.
- Vídeo sempre com **variação x2** (1 prompt, 2 saídas). O usuário escolhe a melhor e salva como a cena aprovada.
- Textos para o usuário e prompts em português do Brasil.
- Não invente ofertas, preços ou promessas que não estejam na copy.

## Pasta de trabalho

Crie `criativos/<oferta>-<AAAAMMDD>/`. Se já existir, **leia `roteiro.json` e veja o que falta**; não recomece.

```
briefing.md            copy, modo (novelinha|ugc), duração alvo, saldo de créditos
roteiro.json           personagens + cenas (formato em references/prompts.md)
personagens/           uma imagem aprovada por personagem
keyframes/             cena-NN-inicio.png (e cena-NN-fim.png quando houver)
prompts/               cena-NN.txt, o prompt de vídeo pronto para colar
cenas/                 cena-NN.mp4, só as aprovadas
```

## Etapas

1. **Briefing.** Peça: copy, modo, duração alvo, saldo atual de créditos do Flow (menu da conta). Grave em `briefing.md`. Se a duração alvo passar de ~1 minuto, avise do custo antes de seguir (`references/flow.md`).
2. **Personagens** (só novelinha). Proponha elenco; gere os prompts de imagem (`references/prompts.md`). O usuário gera no Flow (Nano Banana, 9:16), baixa a melhor de cada para `personagens/` e aprova.
3. **Roteiro.** Divida a copy em cenas. Itere em linguagem natural até aprovar. Grave `roteiro.json`.
4. **Keyframes.** Um prompt de imagem por cena (início, e fim quando a cena tem muita ação). Usuário gera no Flow usando os personagens como referência, baixa para `keyframes/`, aprova a sequência inteira antes de qualquer vídeo.
5. **Prompts de vídeo + custo.** Um `prompts/cena-NN.txt` por cena, mais a estimativa de créditos. Aguarde o ok.
6. **Geração no Flow.** Manual: entregue o passo a passo curto de `references/flow.md` e a ordem das cenas; o usuário gera, escolhe a melhor das 2 saídas e baixa como `cenas/cena-NN.mp4`. Assistido: gere as cenas pelo Chrome, entregue os links das 2 saídas de cada cena e peça a escolha. Baixe só com ok explícito.
7. **Checagem.** Rode `scripts/checar-cenas.sh criativos/<pasta>`. Reporte o que falta, o que não é 9:16, o que está sem áudio ou com duração fora do planejado. Cena ruim volta ao passo 5 (ajuste o prompt, não repita igual).
8. **Fechamento.** Com todas as cenas aprovadas, resuma o que ficou pronto. A edição (legenda, efeitos, montagem) usa as skills de edição locais, ainda não integradas: não improvise montagem aqui.

## Erros comuns

- Gerar vídeo antes de aprovar os keyframes: gasta crédito para descobrir problema que a imagem mostraria de graça.
- Descrever a aparência dos personagens no prompt de vídeo: a imagem de referência define isso; o prompt descreve ação, câmera e fala.
- Confiar numa tabela de preço velha: o Flow mostra "A geração vai usar N créditos" antes de gerar. Peça ao usuário para conferir e atualize `references/flow.md` se divergir.
- Mais de 10s por clipe: acima disso só em plano pago e com custo maior por segundo.
