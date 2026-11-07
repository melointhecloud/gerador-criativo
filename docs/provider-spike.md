# Spike do provider de vídeo

> **NÃO PREENCHIDO — aguardando execução autorizada.**
> O script está pronto (`scripts/spike-video.ts`), mas ainda não rodou contra a API. Rodar de verdade gasta crédito da chave Gemini; só com autorização explícita do dono da chave, e uma vez só.

## Como rodar

Os comandos abaixo usam os dois retratos de personagens já recortados em `spike-out/` (pasta ignorada pelo Git). `pnpm spike:video` carrega o `.env` (`tsx --env-file-if-exists=.env`), então a chave vem de lá; ela nunca é impressa.

1. **Dry-run (sem custo, sem rede).** Mostra modelo, prompts, imagens com tamanho, o corpo exato de `interactions.create` (com o base64 omitido) e quantas gerações seriam pagas:

   ```bash
   REF_CHAR1=spike-out/personagem1-esquerda.png REF_CHAR2=spike-out/personagem2-direita.png pnpm spike:video --dry-run
   ```

2. **Execução real (paga: 2 gerações).** Só depois de conferir o dry-run e com autorização:

   ```bash
   SPIKE_CONFIRM=sim REF_CHAR1=spike-out/personagem1-esquerda.png REF_CHAR2=spike-out/personagem2-direita.png pnpm spike:video
   ```

   Sem `SPIKE_CONFIRM=sim` o script imprime o resumo e sai sem enviar nada (código 2). **Não coloque `SPIKE_CONFIRM` no `.env`**: a confirmação tem de ser digitada a cada execução. Sem `REF_CHAR1`/`REF_CHAR2`, só o teste A roda (1 geração paga).

Variáveis opcionais: `GEMINI_VIDEO_MODEL` (padrão `gemini-omni-1.1-flash`), `SPIKE_DURATION_SECONDS` (padrão 8; a doc aceita 3 a 15), `SPIKE_TIMEOUT_MINUTES` (padrão 20, timeout total), `SPIKE_DRY_RUN=1` (igual a `--dry-run`).

O que o script garante:
- no máximo uma chamada paga por teste, em sequência, e para no primeiro erro (bloqueio de segurança, cota, 4xx/5xx, timeout), imprimindo o motivo do provider;
- retries automáticos do SDK desligados (`retries: { strategy: "none" }`; o padrão do SDK refaz até 4 vezes em 408/409/429/5xx) e continuação automática desligada (`automatic_continuation: false`);
- imagens validadas e lidas antes da primeira chamada, para não pagar o A e falhar no B por caminho errado;
- chave só de `process.env`, nunca em log nem em disco (também é removida de mensagens de erro);
- grava em `spike-out/`: `<teste>.mp4` e `<teste>.json` (id, status, uso de tokens; sem input nem base64) e imprime uma tabela com espera, duração, resolução, 9:16, áudio e tokens de saída (via `ffprobe`).

Se o download falhar depois da geração, o vídeo já foi cobrado: **não rode de novo**. Recupere com `interactions.get(<id do .json>)`, que segundo a doc devolve o vídeo inline.

## Custo esperado

Página de preços (`https://aistudio.google.com/docs/pricing`, consultada em 2026-11-07), sem free tier para o Omni:

| Modelo | 720p | 2 clipes de 8s |
|---|---|---|
| `gemini-omni-1.1-flash` (padrão do script) | ~US$ 0,10/s | ~US$ 1,60 |
| `gemini-omni-1.2-flash` | ~US$ 0,07/s | ~US$ 1,12 |

São valores aproximados: a cobrança é por tokens de saída, e a página não lista preço separado para o áudio. Um timeout do lado do cliente não cancela a geração no servidor, que pode ser cobrada mesmo assim.

## Correções feitas no rascunho do plano

Fontes: `https://aistudio.google.com/docs/omni`, `https://aistudio.google.com/docs/deprecations` e `https://aistudio.google.com/docs/pricing` (todas consultadas em 2026-11-07), além dos tipos do `@google/genai` 2.32.0 instalado.

1. **Tags `<IMAGE_REF_N>` removidas.** A doc diz que elas estão "deprecated and unsupported in future models" e manda descrever em linguagem natural como cada imagem deve ser usada. O prompt B associa os nomes à ordem das imagens ("Rafael é o rapaz da primeira imagem de referência..."). O bloco `image` do SDK não tem campo `name` (o bloco `video` tem). A doc não traz exemplo com duas pessoas nem uma convenção para nomear as imagens.
2. **Retries desligados.** O SDK refaz `interactions.create` até 4 vezes por padrão em 408/409/429/5xx; cada nova tentativa seria outra geração paga.
3. **Sem cast.** O SDK 2.32 tipa `ai.interactions.create` (`Interaction.output_video` com `uri`/`data`/`mime_type`). O cast `as unknown as` do rascunho saiu.
4. **Duração explícita.** `response_format.duration` existe ("3s" a "15s", padrão "10s"; acima de 15s dá erro de argumento inválido). O spike pede 8s, para custar menos e ficar alinhado com o `SCENE_MAX_SECONDS=8` atual.
5. **Ordem do input.** Imagens antes do bloco de texto, como no exemplo de referência da doc.
6. **Vídeo inline também é aceito.** Com `delivery: "uri"`, a URI vem na criação (é o único momento garantido) e o arquivo é consultado com `files.get` até ficar `ACTIVE` antes de `files.download`, como no rascunho. Se a resposta trouxer `data` em base64, o script grava direto.
7. **Falhas sem exceção.** Se a interação voltar com `status` diferente de `completed`, com `errors` ou com erro no passo `model_output`, o script para e mostra o motivo. O rascunho só checava a URI.
8. **Teste B virou novelinha.** Duas imagens de personagens (`REF_CHAR1`/`REF_CHAR2`, nomes Rafael e Marina), uma fala de cada, no lugar de pessoa + produto (`REF_PERSON`/`REF_PRODUCT`).

## O que a doc diz (e não diz) sobre os gates

- **Fala:** "Generating spoken dialogue or speech is supported when extending previously generated videos via multi-turn (`previous_interaction_id`)." A doc não diz se há fala numa única geração. Esse é exatamente o Gate 2.
- **Idioma:** "English (EN) is fully supported, but other languages have not been evaluated, so they may work but results can vary."
- **Referências:** "up to 6 reference images per request (up to 3 images per character for up to 2 characters)". A doc não diz como o modelo associa cada imagem a um personagem além da descrição em texto.
- **Restrições:** filtros de segurança no prompt e no vídeo (variam por região). Não aceita editar imagens com "certain recognizable people". No EEA, Suíça e Reino Unido, não aceita imagens com menores. A doc não dá códigos de erro de bloqueio.
- **Tempo de geração:** "varies based on duration, resolution, and current API load". Sem números.
- **Modelo:** `gemini-omni-1.2-flash` saiu em 2026-11-05 (depois da decisão de 2026-11-03). O `gemini-omni-1.1-flash` desliga em 2026-12-03, quando as chamadas passam a ir automaticamente para o 1.2. O script mantém o 1.1, que é a decisão do Lucas; trocar exige falar com ele.

---

<!-- Preencher abaixo depois da execução autorizada. -->

Data: <data da execução>
Modelo: <GEMINI_VIDEO_MODEL usado>
Chamada que funcionou: <colar o corpo do dry-run, se a API aceitou sem mudanças; senão, a forma corrigida>

## Resultados

<colar a tabela impressa pelo script>

- Duração de um clipe gerado (A): <s>   (B): <s>   (pedido: <SPIKE_DURATION_SECONDS>s)
- Tempo de espera até o vídeo pronto (A): <s>   (B): <s>
- Resolução recebida: <WxH>
- Tem faixa de áudio: <sim/não>
- Tokens de saída (A): <n>   (B): <n>

## Gates

- [ ] **Gate 1:** saída vertical 9:16 com faixa de áudio (tabela: "9:16 = sim", "Áudio = sim").
- [ ] **Gate 2:** no A, a mulher **fala a frase em pt-BR** numa única geração (sem extensão), com a fala inteligível. No B, Rafael e Marina falam uma frase cada, também em pt-BR.
- [ ] **Gate 3:** no B, com 2 imagens de referência de personagens, **cada pessoa continua reconhecível** no vídeo (rosto, cabelo, roupa) e Rafael e Marina não trocam de aparência entre si.
- [ ] **Gate 4:** a duração entregue bate com a pedida, o que define o `SCENE_MAX_SECONDS`. A doc permite até 15s.

## Decisão

- **Gates 1 a 4 passaram:** seguir com o Omni como definido no Plano 2, Task 11, usando a forma de chamada acima.
- **Gate 2 falhou (sem fala em pt-BR numa única geração): PARAR.** Não escolher alternativa sozinho. Avisar o Guilherme e o Lucas. As opções são (a) o fluxo de extensão multi-turn do Omni (`previous_interaction_id`), que é como a doc diz que a fala é suportada, ou (b) o Veo 3.1 GA na Gemini Enterprise Agent Platform (Vertex). As duas mudam custo e UX. Só o `VideoModel` real muda, e os Planos 1 e 2 (até a Task 10) e o Plano 3 continuam com providers falsos.
- **Gate 3 falhou de forma que inviabiliza a novelinha: PARAR** e avisar o Lucas.
- **Gate 3 falhou parcialmente:** registrar quantas referências funcionam bem e ajustar `MAX_SCENE_REFERENCES`. A doc limita a 2 personagens por requisição.
- **Erro antes de gerar** (bloqueio, cota, 4xx): registrar o motivo impresso e não rodar de novo sem nova autorização.

## Valores para o .env

```
GEMINI_VIDEO_MODEL=<modelo usado>
MAX_SCENE_REFERENCES=<n>
SCENE_MAX_SECONDS=<n>
```
