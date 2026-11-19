# Google Flow: custos e passo a passo

Medido na interface em **2026-11-19**, conta com plano Google AI Plus. O Flow muda rápido; a tela mostra "A geração vai usar N créditos" antes de gerar e vale mais que esta tabela.

## Custo em créditos (Omni 1.2 Flash, 9:16)

| Resolução | Duração | Saídas | Créditos |
|---|---|---|---|
| 720p | 5s | x2 | 30 |
| 720p | 8s | x1 | 24 |
| 720p | 8s | x2 | **48** |
| 720p | 10s | x2 | 60 |
| 720p | 15s | x2 | 120 (60 por clipe) |
| 360p | 8s | x1 | 8 |
| 360p | 8s | x2 | 16 |
| Veo 3.1 Lite, 720p | 8s | x2 | 20 |
| Imagem (Nano Banana 2.1, 2 Lite, Pro) | qualquer | x2 | **0** |

Regra prática: **Omni 720p ≈ 3 créditos por segundo gerado**, multiplicado pelas saídas (x2 dobra). Acima de 10s o custo por segundo sobe (15s = 4/s). 360p custa um terço, serve para testar prompt, não para o criativo final.

## Planos e saldo (Brasil, 2026-11-19)

| Plano | Preço | Créditos/mês | Cenas de 8s em x2 |
|---|---|---|---|
| AI Plus (atual) | R$ 0 | 250 (renova em 25/nov) | 5 |
| AI Pro | R$ 96,99/mês | 1.000 | 20 |
| AI Ultra | a partir de R$ 779,90/mês | 10.000 | 208 |

Duração acima de 10s, extensão e upscale 1K/4K: só plano pago. O saldo aparece ao clicar no avatar, canto superior direito do Flow.

Omni 1.1, Veo 3.1 Fast e Veo 3.1 Quality saem do ar em **5 de dezembro de 2026**. Use Omni 1.2 Flash (padrão) ou Veo 3.1 Lite.

## Passo a passo (interface)

Na caixa de prompt, o botão de configuração (ex.: "Vídeo · 720p · 8s · x2") abre as opções:

1. **Imagem ou Vídeo.** Personagens e keyframes: Imagem. Cenas: Vídeo.
2. **Proporção 9:16.**
3. **Modelo.** Imagem: Nano Banana 2.1 (ou Pro se a consistência pedir). Vídeo: Omni 1.2 Flash.
4. **Vídeo: 720p, duração da cena (controle deslizante), x2.**
5. **Frames ou Elementos.** Frames: o clipe parte do keyframe de início (e termina no de fim); mostra ao modelo como a cena começa e termina e dá saídas mais consistentes. Elementos: imagens de personagem entram como referência. **Decisão do Lucas (2026-11-19):** o primeiro teste usa Elementos; Frames é o ideal para consistência, mas não é sempre a melhor opção. Qual usar depende do caso e se aprende com o tempo: registre aqui o que funcionou em cada situação.
6. Conferir "A geração vai usar N créditos", colar o prompt, gerar.
7. Das 2 saídas, baixar a melhor como `cenas/cena-NN.mp4`.

O Flow guarda as criações por tempo limitado (aviso "Suas criações mais antigas vão expirar"). **Baixe cada cena aprovada no mesmo dia.**

## Requisitos do Lucas

- A fala em português do Brasil vai **embutida no prompt de vídeo**; a saída já deve vir com vídeo e fala, sem dublagem depois.
- O rosto dos personagens deve se manter entre as cenas.
- Criativo real: 2 a 4 minutos. Testes: poucas cenas, só para ver como as gerações saem.

## Perguntas abertas (preencher no primeiro teste)

- Fala em pt-BR sai numa geração só, com boca sincronizada? (Cena com dois falantes: as falas saem na ordem e com vozes diferentes?)
- Personagem mantém o rosto entre cenas: melhor com Frames, Elementos ou os dois?
- A voz do personagem se mantém entre cenas? (Omni 1.2 aceita referência de voz na extensão.)
- Quantos créditos um criativo de N cenas realmente gastou, com regenerações?

## Achados da primeira geração (2026-11-19)

- Custo confirmado: Omni 1.2 Flash, 720p, 8s, x2 = 48 créditos (saldo caiu 250 -> 202). Imagem Nano Banana Pro x2 = 0.
- Geração de 2 vídeos de 8s leva cerca de 1 minuto; imagens, cerca de 20 segundos.
- **Armadilha:** o seletor de modelo e a duração ficam com o último valor usado (ficou Veo 3.1 Lite e 5s). Confira modelo, duração, x2 e o texto "A geração vai usar N créditos" antes de enviar.
- Elementos: "+" na caixa de prompt abre o seletor de recursos do projeto, escolha a imagem e "Incluir no comando".
- Prompt digitado numa linha só: Enter envia o comando.
- Cada saída abre numa página própria (/edit/...), com as duas saídas nas miniaturas do topo e o botão de download.

## Resultados do teste da novelinha (2026-11-19)

- **Aprovado pelo Lucas (cena 1, Elementos, 1 personagem):** fala em pt-BR perfeita numa geração só, lip sync e movimento bons. Gate de fala resolvido.
- 3 cenas de 8s em x2 gastaram 144 créditos, igual à estimativa (48 por cena, sem regenerar). Imagens: 0.
- Cena com 2 falantes: marcar quem é quem pela roupa no prompt ("Carla (a mulher de blusa vermelha)"), porque as referências não têm nome.
- Elementos não segura cenário entre cenas (a cozinha da 2 e da 3 saem diferentes). Para continuidade de cenário, usar Frames ou Extend.
