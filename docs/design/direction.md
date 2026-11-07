# Direção visual: escuro de estúdio

Documento de design do redesenho da interface (Fase A: fundação, shell, login e lista; Fase B: telas do fluxo).
Explicações em português; nomes de tokens e classes CSS em inglês, como no código (`src/app/globals.css`).

## 1. Assunto, público e trabalho principal

- **Assunto:** uma ilha de edição para anúncios verticais. O material de trabalho são clipes 9:16 de poucos segundos, um roteiro dividido em cenas e um vídeo final em MP4.
- **Público:** 2 a 3 pessoas do time de criativos, em sessões longas, quase sempre no desktop, às vezes conferindo no celular. Conhecem o produto; não precisam ser convencidas, precisam de clareza e ritmo.
- **Trabalho principal:** julgar vídeo. A pessoa assiste a um clipe vertical, decide (aprovar, ajustar o prompt, regerar) e passa ao próximo. Tudo o que não é o clipe ou a decisão sobre ele é coadjuvante.

Consequências diretas:

1. O vídeo fica sobre preto puro (o "palco"), como no monitor de uma ilha de edição; a interface ao redor é um cinza neutro mais claro (o "console"). Dois pretos com funções diferentes, não um preto qualquer tingido.
2. As superfícies são **neutras, sem matiz**: numa sala de cor o entorno é cinza neutro para não enviesar o julgamento de pele e produto. Nada de fundo azulado ou esverdeado competindo com o clipe.
3. A cor só aparece para dizer **de quem é a vez** (ver a regra das duas temperaturas, abaixo).

## 2. Paleta

### Base (6 cores nomeadas)

| Nome | Hex | Papel |
|---|---|---|
| Palco | `#000000` | Fundo de vídeo, imagens 9:16 e miniaturas. Só a mídia usa preto puro. |
| Console | `#1C1D20` | Fundo da página (cinza neutro escuro, levemente frio). |
| Papel | `#ECECE8` | Texto principal; branco levemente quente, como papel de roteiro sob luz. |
| Tungstênio | `#FFB35C` | Acento: a luz de 3200 K. Marca o que **depende de você** (ação principal, etapa atual, foco, avisos). |
| Luz do dia | `#8FC1F0` | A luz de 5600 K. Marca o que **a máquina está fazendo** (na fila, gerando, montando). |
| Aprovado | `#6CCB8F` | Concluído / aprovado. |

Mais um vermelho funcional, **Corte** `#FF7A85`, só para erro e ação destrutiva.

**Regra das duas temperaturas.** Estúdios trabalham com duas temperaturas de cor padrão: tungstênio (3200 K, quente) e luz do dia (5600 K, fria). A interface usa as duas como semântica: quente = sua vez de agir; fria = processamento em andamento, espere. Isso transforma a escolha do acento em informação, e não em enfeite.

### Tokens semânticos (implementados em `:root`)

| Token | Valor | Uso |
|---|---|---|
| `--color-stage` | `#000000` | Fundo de vídeo/mídia |
| `--color-bg` | `#1C1D20` | Fundo da página |
| `--color-surface` | `#26272B` | Painéis |
| `--color-surface-raised` | `#303136` | Hover de linhas, painel dentro de painel, botão secundário |
| `--color-field` | `#16171A` | Campos de formulário (rebaixados em relação ao painel) |
| `--color-border` | `#3C3E43` | Divisórias e borda de painel (decorativa) |
| `--color-border-control` | `#7A7C84` | Borda de campos e controles (precisa ≥ 3:1) |
| `--color-text` | `#ECECE8` | Texto principal |
| `--color-text-muted` | `#A9AAB0` | Texto secundário, metadados |
| `--color-text-disabled` | `#7E8087` | Texto de controle desabilitado |
| `--color-accent` | `#FFB35C` | Botão principal, etapa atual, marcas de enquadramento |
| `--color-accent-hover` | `#FFC27D` | Hover do botão principal |
| `--color-accent-contrast` | `#1C1D20` | Texto sobre o acento |
| `--color-accent-soft` | `#3A2E1F` | Fundo de selo "sua vez" e de aviso |
| `--color-progress` | `#8FC1F0` | Estados de processamento |
| `--color-progress-soft` | `#1F2B38` | Fundo de selo de processamento |
| `--color-success` | `#6CCB8F` | Aprovado / pronto |
| `--color-success-soft` | `#1F3328` | Fundo de selo de sucesso |
| `--color-success-ink` | `#1F6B3D` | Visto de aprovado sobre Papel (segmento escolhido) |
| `--color-danger` | `#FF7A85` | Erro, ação destrutiva |
| `--color-danger-soft` | `#3B2327` | Fundo de alerta de erro |
| `--color-focus` | `#FFB35C` | Anel de foco (2 px sólido + 2 px de afastamento) |

### Contrastes verificados (WCAG 2.x, calculados com a fórmula de luminância relativa)

| Par | Razão | Exigência |
|---|---|---|
| Papel sobre Console | 14,23 | texto 4,5 |
| Papel sobre surface | 12,60 | texto 4,5 |
| Papel sobre surface-raised | 10,96 | texto 4,5 |
| Papel sobre Palco | 17,73 | texto 4,5 |
| text-muted sobre Console | 7,27 | texto 4,5 |
| text-muted sobre surface | 6,44 | texto 4,5 |
| text-muted sobre surface-raised | 5,60 | texto 4,5 |
| accent-contrast sobre Tungstênio (botão) | 9,51 | texto 4,5 |
| accent-contrast sobre accent-hover | 10,65 | texto 4,5 |
| Tungstênio sobre Console / surface / raised | 9,51 / 8,42 / 7,33 | texto 4,5 |
| Tungstênio sobre accent-soft (selo) | 7,45 | texto 4,5 |
| Luz do dia sobre Console / surface | 8,87 / 7,85 | texto 4,5 |
| Luz do dia sobre progress-soft (selo) | 7,57 | texto 4,5 |
| Aprovado sobre Console / surface | 8,49 / 7,51 | texto 4,5 |
| Aprovado sobre success-soft (selo) | 6,77 | texto 4,5 |
| Corte sobre Console / surface | 6,72 / 5,95 | texto 4,5 |
| Corte sobre danger-soft (alerta) | 5,75 | texto 4,5 |
| border-control sobre Console / surface | 4,05 / 3,58 | UI 3,0 |
| Foco (Tungstênio) sobre Console / surface / Palco | 9,51 / 8,42 / 11,85 | UI 3,0 |
| text-disabled sobre surface | 3,78 | (isento; ainda legível) |
| accent-contrast sobre Papel (segmento de versão escolhido) | 14,23 | texto 4,5 |
| success-ink `#1F6B3D` sobre Papel (visto da versão aprovada no segmento escolhido) | 5,49 | UI 3,0 |
| text-disabled sobre field (segmento sem vídeo) | 4,54 | (isento) |
| Luz do dia / Corte / text-muted sobre Palco (estado escrito no palco) | 11,05 / 8,37 / 9,06 | texto 4,5 |
| Papel sobre danger-soft (falha da tentativa) | 12,18 | texto 4,5 |

`--color-border` (1,7–2,0:1) é usado só em divisórias e contornos de painel, que não carregam informação; controles usam `--color-border-control`.

## 3. Tipografia

- **Uma família só: Archivo** (Omnibus-Type), variável em peso (100–900) e **largura (62–125)**, servida pelo `next/font/google`: o arquivo é baixado no build e servido pelo próprio app; nenhuma requisição a terceiros em tempo de execução. Fallback: `system-ui, sans-serif`.
- **O tratamento tipográfico ativo é a largura.** Títulos usam Archivo condensada (`wdth` 72, peso 640): letras altas e estreitas, como os créditos de um filme e como o próprio quadro 9:16. O corpo usa largura normal (`wdth` 100, peso 400). Mesma voz, duas posturas.
- **Escala modular 1,25** (terça maior) sobre 16 px: 13 · 16 · 20 · 25 · 31 · 39 px.

| Papel | Tamanho / altura de linha | Peso / largura |
|---|---|---|
| `h1` (título da página) | 39/1,05 desktop, 31/1,1 abaixo de 600 px | 640, `wdth` 72 |
| `h2` (seção) | 25/1,15 | 620, `wdth` 76 |
| `h3` (título de cartão) | 20/1,25 | 600, `wdth` 86 |
| Corpo | 16/1,55 | 400, `wdth` 100 |
| Rótulo de campo | 15/1,35 | 600 |
| Meta, ajuda, selos | 13/1,4 | 500 |

- Números com `font-variant-numeric: tabular-nums` (contadores de cenas, duração, horário) para não "pular" quando mudam.
- Medida: parágrafos com `max-width: 68ch`; textos de ajuda com `60ch`.
- Sempre caixa normal (sentence case). Nada de rótulos em caixa alta espaçada; nada de monoespaçada para metadados.

## 4. Layout

**Conceito em uma frase:** um console cinza e silencioso, alinhado à esquerda, em que o único elemento enquadrado é o que importa agora: a mídia 9:16 sobre o palco preto, ou o formulário que abre o trabalho.

- Coluna de conteúdo com `max-width: 1120px` e margens de 16 px (mobile) a 32 px (desktop). Texto sempre alinhado à esquerda; só a mídia é centralizada dentro do seu palco.
- Ritmo de espaçamento em múltiplos de 4: 4, 8, 12, 16, 24, 32, 48, 64.
- Raio de borda por hierarquia: painel 12 px, controles 8 px, selos 4 px, mídia 6 px. Sem sombras: a elevação vem da luminosidade (console → surface → surface-raised), como em editores de vídeo.
- **Mídia 9:16:** sempre `aspect-ratio: 9 / 16`, `object-fit: contain` sobre `--color-stage`. O palco reserva o espaço antes de o vídeo carregar (sem salto de layout). Larguras: 280 px na revisão, grade de no mínimo 220 px na geração, até 360 px no vídeo final, 100% da coluna no celular (limitado a 70% da altura da tela).

### Wireframes (desktop)

```
LOGIN
+--------------------------------------------------------------------------------+
| [▯] Gerador de Criativos                                                        |
+--------------------------------------------------------------------------------+
|                                                                                |
|                       ⌜                                ⌝                       |
|                         Entrar                                                 |
|                         Ferramenta interna do time de criativos.               |
|                                                                                |
|                         Senha do time                                          |
|                         [••••••••••••••••••••••••••]                           |
|                         ! Senha incorreta  (erro junto do campo)               |
|                         A senha é a mesma para todo o time...                  |
|                                                                                |
|                         [        Entrar         ]                              |
|                       ⌞                                ⌟                       |
+--------------------------------------------------------------------------------+

LISTA DE PROJETOS (com projetos)
+--------------------------------------------------------------------------------+
| [▯] Gerador de Criativos   Projetos                                      Sair  |
+--------------------------------------------------------------------------------+
| Projetos                                                                       |
| 4 criativos, do mais recente ao mais antigo.                                   |
|                                                                                |
| +----------------------------------------------+  +--------------------------+ |
| | ▮ Lançamento sérum C          [Revisão]       |  | Novo criativo            | |
| | ▮ UGC    Etapa 4 de 6   Atualizado 5 nov 14:32|  | Nome do projeto          | |
| |----------------------------------------------|  | [                      ] | |
| | ▯ Caso da vizinha            [Gerando cenas]  |  | Tipo de criativo         | |
| |   Novelinha  Etapa 4 de 7  Atualizado ...     |  | (•) UGC                  | |
| |----------------------------------------------|  |     Uma pessoa fala...   | |
| | ...                                           |  | ( ) Novelinha            | |
| +----------------------------------------------+  |     Uma história...      | |
|                                                   | [Criar e abrir briefing] | |
|   ▮ = medidor 9:16 com as etapas empilhadas       +--------------------------+ |
+--------------------------------------------------------------------------------+

LISTA DE PROJETOS (vazia): o formulário vira o próprio convite
+--------------------------------------------------------------------------------+
| Projetos                                                                       |
|        ⌜                                                    ⌝                  |
|          Nenhum criativo ainda                                                 |
|          Dê um nome, escolha o formato e siga as etapas até o MP4.             |
|          Nome do projeto [                         ]                           |
|          Tipo de criativo  ( ) UGC ...   ( ) Novelinha ...                     |
|          [Criar e abrir o briefing]                                            |
|        ⌞                                                    ⌟                  |
+--------------------------------------------------------------------------------+

BRIEFING
+--------------------------------------------------------------------------------+
| ← Projetos / Lançamento sérum C                                         [UGC]  |
| [1 Briefing]━━[2 Roteiro]──[3 Gerando]──[4 Revisão]──[5 Montando]──[6 Pronto]   |
|  ▲ cabeçote na etapa atual                                                     |
| +---------------------------------------------+ +----------------------------+ |
| | Nome [                                    ] | | Imagens de referência      | |
| | Copy / storytelling                         | | ▯ ▯ ▯  (9:16 sobre palco)  | |
| | [                                         ] | | [arquivo] [rótulo] [Enviar]| |
| | [                                         ] | +----------------------------+ |
| | 1.240 caracteres                            |                                |
| +---------------------------------------------+                                |
|                                         [Continuar para o roteiro]  (barra)    |
+--------------------------------------------------------------------------------+

PERSONAGENS (novelinha)
+--------------------------------------------------------------------------------+
| (cabeçalho do projeto + linha do tempo)                                        |
| 2 de 3 personagens aprovados                         [Sugerir de novo]         |
| +-----------+  +-----------+  +-----------+  +-----------+                     |
| | ▯ 9:16    |  | ▯ 9:16    |  | ▯ gerando |  | + Adicionar|                    |
| | Marina    |  | Rafael    |  | Dona Célia|  |  personagem|                    |
| | aparência |  | aparência |  | aparência |  |            |                    |
| | [Aprovar] |  | Aprovado  |  | [Regerar] |  |            |                    |
| +-----------+  +-----------+  +-----------+  +-----------+                     |
|                                         [Continuar para o roteiro]             |
+--------------------------------------------------------------------------------+

ROTEIRO
+--------------------------------------------------------------------------------+
| (cabeçalho do projeto + linha do tempo)                                        |
| +-------------------------------+  +------------------------------------------+ |
| | Pedir ajustes ao roteiro      |  | Cena 1                  Usa: produto     | |
| | [ajustes...              ]    |  | Fala       [                          ]  | |
| | [Reescrever com estes ajustes]|  | Descrição  [                          ]  | |
| | (fixo ao rolar)               |  | Duração [ 6 ] s          [Salvar cena]   | |
| +-------------------------------+  |------------------------------------------| |
|                                    | Cena 2 ...                               | |
|                                    +------------------------------------------+ |
| 3 de 3 cenas a gerar  18 s de vídeo          [Aprovar roteiro e gerar cenas]   |
+--------------------------------------------------------------------------------+

GERAÇÃO (contato das cenas em grade)
+--------------------------------------------------------------------------------+
| (cabeçalho do projeto + linha do tempo)                                        |
| +----------------------------------------------------------------------------+ |
| | 1 de 3 cenas prontas   (aria-live)                                         | |
| | [■■■■■■■■□□□□□□□□]  <progress>     A tela muda sozinha para a revisão...   | |
| +----------------------------------------------------------------------------+ |
| +-----------+  +-----------+  +-----------+                                    |
| | ▯ clipe   |  | ▯ gerando |  | ▯ na fila |                                    |
| | Cena 1    |  | Cena 2    |  | Cena 3    |                                    |
| | [Pronta]  |  | [Gerando…]|  | [Na fila] |                                    |
| | 3 s       |  | Gerando   |  | Na fila   |                                    |
| |           |  | desde 9:27|  | desde 9:27|                                    |
| |           |  | ━━━ barra |  | ─── fixa  |                                    |
| +-----------+  +-----------+  +-----------+                                    |
+--------------------------------------------------------------------------------+

REVISÃO
+--------------------------------------------------------------------------------+
| (cabeçalho do projeto + linha do tempo)                                        |
| [! A montagem falhou: ...]  (só quando o último job de montagem falhou)        |
| +------------------------------------------------------------------------+     |
| | ⌜‾‾‾‾‾‾‾‾⌝  Cena 1                                         [Pronta]   |     |
| | |  9:16  |  “Fala da cena entre aspas...”                              |     |
| | | palco  |  3 s   No palco: versão 2 (5 de nov. 14:32)                 |     |
| | |  preto |  Versões [v1 ✓ 5 nov 14:20 | v2 5 nov 14:32]  (segmentado)  |     |
| | ⌞________⌟  [Aprovar esta versão] [Ajustar prompt] [Regerar]           |     |
| +------------------------------------------------------------------------+     |
| | Cena 2 ...  (cantos só na próxima cena que depende de você)            |     |
| +------------------------------------------------------------------------+     |
| 2 de 4 cenas aprovadas  Aprove todas... faltam 2 cenas. [Regerar todas] [Montar]|
|                                              (fixa no pé da tela no desktop)   |
+--------------------------------------------------------------------------------+

VÍDEO FINAL
+--------------------------------------------------------------------------------+
| (cabeçalho do projeto + linha do tempo, tudo concluído)                        |
|         ⌜‾‾‾‾‾‾‾‾‾‾‾‾⌝      Vídeo final                                        |
|         |            |      Duração 18,4 s   Cenas 4   Formato MP4 720×1280   |
|         |   9:16     |                                                       |
|         |   player   |      [Baixar MP4]                                     |
|         |            |      [Voltar para a revisão]                          |
|         ⌞____________⌟                                                       |
+--------------------------------------------------------------------------------+
```

### Wireframe (mobile, 390 px): lista de projetos

```
+------------------------------+
| [▯]  Projetos          Sair  |
+------------------------------+
| Projetos                     |
| 4 criativos...               |
| [Novo criativo]  (âncora)    |
| +--------------------------+ |
| | ▮ Lançamento sérum C     | |
| |   [Revisão]              | |
| |   UGC  Etapa 4 de 6      | |
| |   Atualizado 5 nov 14:32 | |
| |--------------------------| |
| | ▯ Caso da vizinha  ...   | |
| +--------------------------+ |
| Novo criativo                |
| Nome do projeto [          ] |
| ( ) UGC  ...                 |
| ( ) Novelinha ...            |
| [Criar e abrir o briefing]   |
+------------------------------+
```

No celular, a revisão empilha: palco 9:16 em largura total (no máximo 70% da altura da tela), depois o texto da cena e os botões em largura total.

## 5. Navegação e linha do tempo das etapas

- **Shell:** `<header>` com a marca (quadro 9:16 com cantos de enquadramento e uma barra de tungstênio, o "cabeçote"), `<nav aria-label="Principal">` com "Projetos" e o botão "Sair" separado à direita. Link "Pular para o conteúdo" visível ao receber foco, levando a `<main id="conteudo">`. No `/login` só aparece a marca.
- **Linha do tempo (Fase B):** o `<nav aria-label="Etapas do projeto">` vira uma régua de timeline. Cada etapa é um segmento com número (a sequência é real) e nome.
  - **Atual:** o cabeçote (barra vertical de tungstênio) sobre o segmento, texto em Papel com peso 600, `aria-current="step"`.
  - **Concluída:** ícone de visto + texto em Papel; quando dá para voltar, é um botão com hover e foco.
  - **Travada:** ícone de cadeado no segmento + o motivo **escrito** logo abaixo da régua ("Aguarde as gerações terminarem para voltar a uma etapa anterior."; a próxima etapa diz o que a libera: "Roteiro: disponível depois de aprovar todos os personagens."), não só cinza nem só `title`. O botão segue `disabled` (comportamento atual) e aponta para o motivo com `aria-describedby`. As linhas de motivo são só texto: o cadeado fica no segmento.
  - **Futura:** contorno tracejado, texto secundário, não focável.
- O link "← Projetos" vira uma trilha "Projetos / Nome do projeto" dentro de um `<nav aria-label="Trilha">`.

## 6. Sistema de estados (um tratamento para cada)

| Estado | Tratamento |
|---|---|
| Carregando / progresso | Texto que diz o que está acontecendo ("Gerando cena 2 de 4") + barra fina em Luz do dia (indeterminada só enquanto houver trabalho; com movimento reduzido, fica estática). Uma única região `aria-live="polite"` (a frase `sr-only` do projeto) anuncia o progresso; os contadores visíveis não anunciam de novo. Botão em ação mostra o verbo no gerúndio ("Criando…") e fica `disabled`. |
| Vazio | Painel enquadrado (cantos de tungstênio) com uma frase do que falta e a ação para resolver ali mesmo. Nunca "Nenhum dado". |
| Erro | Bloco com fundo `danger-soft`, borda esquerda em Corte, ícone e texto que diz o que aconteceu e o que fazer; `role="alert"`; junto do campo ou da ação que falhou (`aria-describedby` + `aria-invalid` nos campos). |
| Sucesso | Selo verde com ícone de visto e o mesmo verbo da ação ("Aprovar esta versão" → "Aprovada"). Sem toasts que somem. |
| Desabilitado | `disabled` nativo, fundo neutro (`surface-raised`), texto `text-disabled`, cursor `not-allowed` (não um tungstênio apagado, que parece defeito); quando o motivo não é óbvio, um texto de ajuda ao lado explica o que falta ("Aprove todas as cenas para montar"). |
| Aviso (ex.: cena perdeu referência) | Texto com ícone de triângulo em Tungstênio: é algo que depende de você. |

Selos de etapa seguem as duas temperaturas: etapas em que a pessoa trabalha (Briefing, Personagens, Roteiro, Revisão) em Tungstênio; etapas da máquina (Gerando cenas, Montando) em Luz do dia; Pronto em Aprovado.

## 7. Movimento

- Só se move o que mudou de estado: hover/pressão de botões e linhas (cor, 120 ms), abertura de painéis de edição (opacidade, 180 ms), barra de progresso indeterminada (linear, 1,4 s, só enquanto há trabalho).
- Curvas: entrada `cubic-bezier(0.2, 0, 0, 1)` (desacelera); saída 60% da duração de entrada.
- Nada de entradas em cascata, parallax ou animação de carregamento da página.
- `prefers-reduced-motion: reduce`: transições viram 0 ms e a barra indeterminada vira uma faixa estática; a informação continua no texto.
- Animar só `opacity`, `color`, `background-color`, `border-color` e `transform`.

## 8. Voz e texto

- Caixa normal em tudo (sentence case). Português do Brasil, frases curtas, sem jargão de sistema ("projeto", "cena", "versão"; nunca "job", "attempt", "asset").
- Botões dizem a ação e o objeto: "Criar e abrir o briefing", "Aprovar esta versão", "Baixar MP4". Nada de "OK", "Enviar" genérico quando houver um verbo melhor. Nada de "→" no texto do botão.
- O verbo se mantém no fluxo: "Aprovar" → selo "Aprovada"; "Montar vídeo final" → etapa "Montando".
- Erros dizem o que aconteceu e o que fazer, sem pedir desculpas: "Sem conexão com o servidor. Verifique a internet e tente de novo."
- Mensagens de erro do provedor terminam em ponto antes de qualquer instrução ("A versão 2 falhou: Cota esgotada. Use “Regerar” para tentar de novo."); `endSentence` em `src/lib/text.ts`.
- Ações pagas mostram o custo antes (número de cenas e segundos de vídeo) e pedem confirmação explícita; o texto atual dos `confirm()` é mantido palavra por palavra. Também pede confirmação "Salvar" de um personagem cuja aparência mudou (gera nova imagem e tira a aprovação); salvar só o nome não pergunta.
- Metadados separados por espaço e rótulo, não por "·".

## 9. Revisão do plano contra os padrões genéricos

O primeiro rascunho, e o que mudou:

1. **Acento.** Rascunho: âmbar amarelado `#F2B544` como "cor de destaque". Isso é "fundo escuro + um acento vibrante" sem motivo. Revisado para Tungstênio `#FFB35C` (a cor de uma lâmpada de 3200 K) **pareado** com Luz do dia `#8FC1F0` (5600 K), e as duas viraram semântica (sua vez / máquina trabalhando). O acento passou a carregar informação.
2. **Fundo.** Rascunho: um quase-preto tingido único. Revisado para dois níveis com função: preto puro só para mídia (palco) e cinza neutro `#1C1D20` para o console, inspirado no entorno neutro de salas de cor.
3. **Cartões.** Rascunho: grade de cartões arredondados iguais com sombra. Revisado: lista em linhas contínuas dentro de um painel, raio por hierarquia, sem sombras (elevação por luminosidade).
4. **Tipografia.** Rascunho: uma sans geométrica qualquer. Revisado para Archivo com o eixo de largura: condensada nos títulos (ecoa o quadro vertical e os créditos de cinema), normal no corpo. Uma família, duas posturas.
5. **Rótulos e metadados.** Cortados os rótulos de seção em caixa alta, o "·" entre metadados e a monoespaçada que eu tinha posto em horários e contagens (trocada por algarismos tabulares da própria Archivo).
6. **Ousadia em um lugar só: o enquadramento 9:16.** Cantos de visor (marcas de enquadramento em Tungstênio) aparecem só em volta do que é protagonista na tela: o formulário do login, o convite da lista vazia e, na Fase B, o palco do clipe em revisão e o vídeo final. O medidor 9:16 de cada projeto na lista é a versão miniatura do mesmo quadro. O resto fica quieto.
7. **Espelho (tirar um acessório).** Depois das primeiras capturas: (a) saiu o sublinhado em tungstênio do item "Projetos" no cabeçalho (competia com as marcas de enquadramento e com a ação principal; o item atual agora só fica em Papel com peso 600); (b) o botão principal desabilitado deixou de ser um tungstênio translúcido (parecia quebrado) e virou neutro.
8. **Espelho na Fase B1 (stepper, briefing, personagens, roteiro).** Depois das capturas: (a) saiu o cadeado repetido nas linhas de motivo abaixo da régua (o segmento já tem o cadeado; três cadeados e mais dois nas notas viravam ruído); (b) o cartão de personagem deixou de mostrar o selo "Gerando imagem"/"Imagem falhou", que repetia o texto já escrito sobre a imagem: o selo agora só diz a aprovação ("Para aprovar"/"Aprovado"); (c) a imagem antiga fica apagada (20%) enquanto gera de novo ou depois de falhar, porque o texto em Corte sobre uma imagem vermelha ficava ilegível; (d) os botões do cartão ficaram no tamanho compacto (36 px) para não empilhar um por linha na coluna de 250 px.

9. **Espelho na Fase B2 (geração, revisão, final).** Depois das capturas: (a) o cabeçalho do cartão deixou de repetir "Aprovada" quando a versão no palco é a aprovada (o selo "Versão aprovada" junto das ações e o visto no segmento já dizem; vendo outra versão, o cabeçalho volta a lembrar que a cena segue aprovada); (b) "Pronta" na revisão usa um olho em Tungstênio (sua vez de assistir), não o visto verde, que confundia com "Aprovada"; (c) os cantos de visor saíram de "cena com a versão mais recente pronta" para "primeira cena sem aprovação e sem geração em andamento", porque uma cena que falhou também depende de você; (d) sem versão para aprovar, o botão "Aprovar" desabilitado sumiu e "Regerar" virou a ação principal; (e) a tela "Montando" deixou de repetir o título ("Montando", "Montando o vídeo final…", "Montando…" no palco): o palco reservado mostra só a barra, e o texto diz quantas cenas estão sendo juntadas.
10. **Revisão de acessibilidade da Fase B3.** (a) A barra de ações fixa do desktop (≥ 720 px) cobria o controle focado por Tab (WCAG 2.4.11): `html` ganhou `scroll-padding-bottom: var(--review-bar-clearance)` (96 px = barra de 78 px medidos + 12 px do rodapé + folga). (b) O foco não cai mais no `<body>` quando a ação desabilita o botão: depois de "Aprovar esta versão" o foco vai para o selo "Versão aprovada" (`tabIndex={-1}`), e depois de "Regerar" para o título da cena (ou, se o botão voltou a ficar habilitado, para ele); só quando o foco estava no botão ao clicar, nunca no carregamento nem nas consultas periódicas; se a ação falhar, o foco volta ao botão. (c) Uma só região viva: a frase `sr-only` do `ProjectView` (`progressMessage`) é a única fonte de anúncios; os contadores visíveis e a tela "Montando" não têm `aria-live` nem `role="status"`. (d) Com versão aprovada, o selo da cena é só "Aprovada", mesmo com tentativa mais nova falha, bloqueada ou gerando; a falha e a nota "Gerando a versão N… A versão aprovada continua valendo." aparecem no corpo do cartão e no seletor de versões. O contador da geração ("prontas") segue a tentativa mais recente.

## 10. Melhorias de usabilidade para a Fase B

1. Linha do tempo das etapas como descrita na seção 5, com o motivo de "travada" escrito na tela.
2. Trilha "Projetos / nome" no lugar de "← Projetos", e o modo (UGC/Novelinha) como selo ao lado do título.
3. Revisão: palco 9:16 com cantos de enquadramento, selo de estado com ícone, alternância de versões como controle segmentado (`aria-pressed`) e o rótulo "v1, v2" com data/hora.
4. Barra de ações fixa na revisão ("2 de 4 cenas aprovadas", "Regerar todas", "Montar vídeo final") com o motivo quando "Montar" está desabilitado.
5. Geração: contador (sem `aria-live`; o anúncio vem da região única do projeto) e barra de progresso em Luz do dia por cena; o polling continua só enquanto há trabalho.
6. Substituir `confirm()` por um diálogo modal acessível (`<dialog>` com foco preso e Esc) **bloqueante**, mantendo o texto exato do custo; até lá, `confirm()` fica.
7. Editores (roteiro, personagens): indicador "Alterações não salvas" junto do botão "Salvar", sem mudar as chaves de remontagem.
8. Briefing: copy e referências lado a lado no desktop, contagem de caracteres da copy, upload com prévia e erro do rótulo junto do campo.
9. Personagens: cartões com a imagem 9:16 no palco, estado da imagem ("Gerando imagem…", "Falhou: …" com ação "Regerar imagem") e aprovação com selo.
10. Vídeo final: player grande com cantos de enquadramento, "Baixar MP4" como ação principal e metadados rotulados.
11. Trocar "✓" e "←" de texto por ícones SVG com `aria-hidden` e texto visível.
12. Ao mudar de etapa, mover o foco para o título da etapa (leitores de tela) sem rolar a página bruscamente.
13. Remover os `style={{}}` restantes dos componentes do fluxo, trocando por classes do sistema.
