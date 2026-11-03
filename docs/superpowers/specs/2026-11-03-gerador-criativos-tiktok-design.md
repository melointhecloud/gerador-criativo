# Gerador de Criativos TikTok Ads — Design

Data: 2026-11-03
Status: aprovado em brainstorming. Planos de implementação em `docs/superpowers/plans/`. Atualizado após a escrita dos planos: provider de vídeo mudou (ver §10).

## 1. Objetivo

Ferramenta interna para gerar criativos em vídeo para TikTok Ads, especializada em dois formatos:

- **UGC**: pessoa falando para a câmera sobre um produto
- **Novelinha**: história em cenas com um ou mais personagens

O usuário escolhe o modo, envia a copy/storytelling, e a ferramenta conduz um fluxo com aprovação humana em cada etapa: roteiro em cenas, geração das cenas, revisão, montagem do MP4 final.

## 2. Escopo

### Dentro
- Dois modos: UGC e novelinha
- Geração de roteiro em cenas a partir da copy, com iteração até aprovação
- Geração de personagens (novelinha), com imagem aprovada por personagem
- Geração de clipes por cena via Gemini API (modelo definido na §10), vertical 9:16
- Revisão por cena: aprovar, regerar uma, regerar todas, voltar a tentativa anterior
- Montagem final: concatenação simples das cenas aprovadas em um MP4
- Acesso por senha única compartilhada (time de 2 a 3 pessoas)

### Fora (YAGNI)
- Contas de usuário, permissões, isolamento entre usuários
- Legendas queimadas, trilha sonora, transições, logo, CTA automático (edição fina fica no editor externo)
- Limite de gasto automático (apenas estimativa de segundos antes de gerar)
- Publicação direta no TikTok Ads Manager
- Duração-alvo fixa: o número de cenas decorre da copy e das aprovações do usuário

## 3. Decisões de produto

| Decisão | Escolha |
|---|---|
| Motor de vídeo | Gemini Omni (`gemini-omni-1.1-flash`) via Gemini API, sujeito ao spike da §10 (o Veo 3.x preview foi desligado em 22/10/2026) |
| Referências UGC | Usuário envia imagens (produto, pessoa) |
| Referências novelinha | Ferramenta gera os personagens, usuário aprova; cada cena usa as imagens dos personagens que aparecem nela |
| Usuários | 2 a 3 pessoas, workspace compartilhado, senha única |
| Montagem | Apenas concatenar cenas em um MP4 |
| Duração | Livre, definida pelo roteiro aprovado |
| Clipes | Duração máxima por cena vem do provider (`SCENE_MAX_SECONDS`, medida no spike); a duração real do clipe é medida com ffprobe |

## 4. Arquitetura

Um repositório TypeScript, dois processos, hospedados no Railway.

- **web** (Next.js): UI e API. Lê e escreve no banco e enfileira jobs. Nunca chama Veo diretamente
- **worker** (Node + ffmpeg, Docker): consome a fila, chama Gemini/Veo, faz polling das operações, baixa clipes, monta o MP4 final
- **Postgres** (Railway): estado do domínio e fila de jobs
- **Bucket S3-compatível**: imagens de referência, imagens de personagem, clipes, MP4 final
- **Acesso**: senha única do time, cookie de sessão assinado

### Módulos

| Módulo | Responsabilidade | Depende de |
|---|---|---|
| `script-planner` | Copy em lista de cenas (fala, descrição visual, duração, referências usadas) via Gemini texto com saída estruturada | Gemini |
| `character-designer` | Novelinha: copy em personagens e imagem de cada um | Gemini imagem |
| `scene-generator` | Cena mais imagens de referência em um clipe vertical 9:16, via `VideoModel` | provider de vídeo, storage |
| `assembler` | Clipes aprovados em ordem, concatenados em um MP4 | ffmpeg, storage |
| `job-queue` | Enfileirar, executar, retentar, expor status | Postgres |
| `storage` | Upload e download. Arquivos chegam ao navegador por uma rota autenticada da web, com suporte a `Range` (sem URL pública do bucket) | bucket |

Os modelos do Gemini ficam atrás de interfaces (`TextModel`, `ImageModel`, `VideoModel`). A implementação real e uma implementação falsa para testes são intercambiáveis. Trocar o provider de vídeo não afeta o resto do sistema.

Planejamento de roteiro e proposta de personagens (só texto, poucos segundos) rodam na web, dentro dos serviços. Imagem, vídeo e montagem passam pela fila e pelo worker.

### Limite de referências

O provider de vídeo aceita um número limitado de imagens de referência por clipe (`MAX_SCENE_REFERENCES`, definido pelo spike da §10). Se uma cena exigir mais, o `script-planner` prioriza quem aparece em destaque e sinaliza o corte no roteiro, para o usuário ver.

## 5. Fluxo e máquina de estados

Cada etapa só avança com aprovação do usuário.

1. **Briefing**: modo, copy. UGC: upload das imagens de referência
2. **Personagens** (só novelinha): Gemini propõe personagens e gera uma imagem de cada. Usuário aprova, edita descrição, regera por personagem, adiciona ou remove
3. **Roteiro**: Gemini divide a copy em cenas. Usuário pede ajustes em linguagem natural ou edita à mão, quantas vezes quiser, e aprova
4. **Geração das cenas**: antes de iniciar, mostra o total de segundos. Worker gera clipes em paralelo. Status por cena: na fila, gerando, pronta, falhou
5. **Revisão das cenas**: por cena, aprovar ou regerar (com ajuste opcional de prompt). Ação "regerar todas". Tentativas anteriores ficam guardadas e podem ser restauradas
6. **Montagem**: com todas as cenas aprovadas, worker concatena e disponibiliza o MP4 para download

Regras:
- Voltar a uma etapa anterior é permitido. Editar uma cena invalida só o clipe dela
- Cena que falha mostra o erro e oferece regerar, sem travar as demais
- Cada tentativa guarda prompt, referências e clipe resultante

## 6. Modelo de dados (Postgres)

- `projects`: id, nome, modo, copy, etapa atual, timestamps
- `characters` (novelinha): id, project_id, nome, descrição, asset aprovado
- `scenes`: id, project_id, posição, fala, prompt visual, duração em segundos, tentativa aprovada
- `scene_references`: scene_id, asset_id (quais imagens a cena usa)
- `scene_attempts`: id, scene_id, prompt, status, id da operação Veo, asset do clipe, erro, timestamps
- `assets`: id, project_id, tipo (referência, personagem, clipe, final), chave no bucket, metadados
- `jobs`: id, tipo, payload, status, tentativas, run_at, trava, erro

A fila usa `SELECT ... FOR UPDATE SKIP LOCKED`.

## 7. Tratamento de erros

- A geração de vídeo é longa. O worker persiste a referência da operação/arquivo (`providerRef`), então um reinício retoma o polling sem gerar (e cobrar) de novo
- Falha transitória (rede, 5xx, rate limit): retry com backoff e limite de tentativas
- Bloqueio por filtro de segurança do provider: sem retry automático. Mostra o motivo e deixa o usuário ajustar o prompt
- Jobs idempotentes: reexecutar não duplica clipe nem cobrança
- Saída do `script-planner` validada por schema (zod). Saída inválida gera retry limitado, depois erro visível

## 8. Testes

- Provider falso de Gemini/Veo devolve clipes de fixture: o fluxo inteiro roda sem gastar crédito
- Unitários: validação do roteiro, regra de máximo de referências por cena, transições de estado do projeto e da fila
- Assembler testado com clipes curtos gerados pelo próprio ffmpeg
- Um teste manual de fumaça com o provider real antes de liberar para o time

## 9. Segredos e configuração

Variáveis de ambiente no Railway: chave da Gemini API, credenciais do banco e do bucket, senha de acesso, segredo de sessão. Nada disso entra no repositório.

## 10. Riscos e decisões pendentes

### Provider de vídeo

**Decisão do Lucas (2026-11-03): usar o Gemini Omni.** O spike abaixo continua obrigatório, mas como verificação, não como escolha entre providers; quem o executa é o desenvolvedor (Guilherme), com a chave Gemini fornecida pelo Lucas.

A decisão original foi "Veo 3 via Gemini". Em 2026-11-03, a documentação oficial (`https://aistudio.google.com/docs/deprecations`) lista `veo-3.1-generate-preview`, `veo-3.1-fast-generate-preview` e `veo-3.1-lite-generate-preview` como **desligados em 22/10/2026**, e `veo-3.0-*` em 30/06/2026. O substituto recomendado é `gemini-omni-1.1-flash`, que usa a Interactions API (não mais operações longas de `generateVideos`), aceita 9:16, gera áudio e aceita imagens de referência por tags (`<IMAGE_REF_N>`).

Risco principal: a mesma documentação diz que fala/diálogo "é suportada ao estender vídeos gerados anteriormente (multi-turn)". Se não for possível gerar uma cena com fala numa única chamada, o formato UGC (pessoa falando) fica comprometido.

Por isso o primeiro passo da implementação é um spike curto e barato (`scripts/spike-video.ts`, resultado em `docs/provider-spike.md`) com quatro critérios de aceite:

1. saída 9:16 com áudio;
2. fala em pt-BR numa única geração;
3. identidade preservada com 2 imagens de referência;
4. duração do clipe medida (define `SCENE_MAX_SECONDS`).

Se o critério 2 falhar, as alternativas são o fluxo de extensão multi-turn do Omni ou o Veo 3.1 GA na Gemini Enterprise Agent Platform (Vertex). Só o `VideoModel` real muda; o resto do sistema continua igual. Nesse caso o dono do projeto decide antes de seguir.

### Outras decisões de implementação

- IDs de modelo de texto e de imagem do Gemini não estão fixados no código: vêm de variáveis de ambiente, para não envelhecerem.
- Um único worker em produção. O reaproveitamento de jobs travados assume uma réplica.
- Sem política de retenção de arquivos por enquanto: clipes e imagens ficam no bucket até o projeto ser apagado.
