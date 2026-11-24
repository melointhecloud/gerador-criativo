# Modo script: um comando gera o criativo inteiro

Validado em 2026-11-24 (cena 2 do teste, 2 personagens): envio, espera, coleta dos links e download, sozinhos, em 84 s e com 0 chamadas do modelo durante a geração. O usuário só aprova o custo uma vez.

## Para o usuário (uma vez só)

```bash
cd .claude/skills/criativo-tiktok-flow/scripts/flow && npm install     # Node 18 ou maior
node flow.mjs login                                                     # abre o Chrome do Flow; entre na conta Google
```

O script abre sozinho um Chrome com perfil dedicado (`~/.chrome-flow`, porta de depuração 9333; funciona em Windows, macOS e Linux). **O login fica salvo nesse perfil**; não precisa repetir nem deixar nada aberto. Não use esse perfil/Chrome para outra coisa enquanto o script roda. Se o Chrome não abrir, feche todas as janelas dele e rode de novo (`FLOW_CHROME` aponta para um Chrome em outro lugar; `FLOW_CDP`, para outra porta). Crie um projeto no Flow para o criativo (*Novo projeto*) e copie a URL (`https://flow.google.com/project/<id>`).

## Fluxo do Claude (o dia a dia)

Pré-condições: `roteiro.json` aprovado, `prompts/cena-NN.txt` prontos, imagens dos personagens já no projeto do Flow e **`flowRef` preenchido em cada personagem do `roteiro.json`** (ver abaixo).

1. **Plano (não gasta nada):**
   ```bash
   node flow.mjs criativo ../../../../../criativos/<pasta> --projeto <url> [--cenas 1-6]
   ```
   Mostra cenas pendentes e créditos. Também valida prompts e `flowRef` e para antes de gastar se faltar algo.
2. **Mostre o custo ao usuário e peça o ok** (regra da skill).
3. **Gerar (gasta créditos):** o mesmo comando com `--sim`, e `--baixar` se o usuário autorizou o download. Rode em background (`run_in_background`), porque leva ~1 a 2 min por cena, e **não faça nada no meio**: o comando avisa quando termina.
   ```bash
   node flow.mjs criativo ... --cenas 1-6 --sim --baixar
   ```
4. Resultado em JSON: links das 2 saídas de cada cena, saldo inicial/final e gasto. O estado fica em `<pasta>/flow-estado.json` e as notas em `notas.md`.

**Retomar:** se der erro ou a sessão acabar, rode o mesmo comando de novo. Cenas já prontas são puladas; uma cena enviada que não terminou de coletar **não é reenviada** (não gasta duas vezes): para refazer uma cena, apague a entrada dela em `flow-estado.json`.

**Lotes:** faça no máximo 6 cenas por comando/sessão (`--cenas 1-6`, depois `7-12`, ...). Cada comando é independente e barato em contexto.

## `flowRef` no roteiro

Cada personagem do `roteiro.json` precisa de `"flowRef": "Nome da imagem no Flow#K"`: o nome que o Flow deu à imagem aprovada e a posição K na busca (**do mais recente para o mais antigo**; as 2 saídas de uma geração têm o mesmo nome e a última gerada é `#1`). Descubra com `node flow.mjs imagens --projeto <url>` (lista os `flowRef` possíveis na ordem certa) e **confira a foto** com `enviar --dry-run` olhando `ref-N.png` (o comando imprime o caminho em `conferir`; pasta padrão: `flow-cli` dentro da pasta temporária do sistema, ou `FLOW_OUT`). Exemplo do teste: Marina = `Woman with tired expression#1`, Carla = `Woman smiling in red blouse#1`.

## Downloads

Com `--baixar`: a saída 1 vai para `cenas/cena-NN.mp4` e a saída 2 para `cenas/alternativas/cena-NN-b.mp4`, sempre em **720p "Tamanho original"** (grátis). O script nunca escolhe as opções "Aprimorada" (1080p/4K). Depois rode `scripts/checar-cenas.sh`. Sem `--baixar`, só devolve links (regra: download exige ok do usuário).

## Comandos soltos

```bash
node flow.mjs enviar  --projeto <url> --prompt <txt> --ref "Nome#1" [--ref ...] [--duracao 8] [--x 2] [--dry-run]
node flow.mjs coletar --projeto <url> --n 2     # links das N saídas mais novas
node flow.mjs saldo
```

Saída em JSON numa linha; erro vira `{"ok":false,"erro":"..."}` com código 1. Fotos de conferência na pasta `flow-cli` do diretório temporário (o JSON informa o caminho).

## O que o script confere antes de cada envio

Vídeo, Elementos, 9:16, 720p, xN, modelo Omni 1.2 Flash e duração. Lê "A geração vai usar N créditos" e **aborta se N for diferente de 3 x duração x x**. No `criativo`, confere também que o saldo cobre o total.

## Limites

- Só Elementos, 9:16, 720p. Frames não está automatizado.
- Depende dos rótulos em português do Flow; se mudarem, o comando falha com erro claro (não clica errado em silêncio).
- A cena e as miniaturas novas são detectadas pela imagem de capa (única por mídia); não rode dois `criativo` ao mesmo tempo no mesmo projeto.
- Automação por script pode ser vista pelo Google de forma diferente do uso manual. Ritmo normal: uma cena por vez, como o comando já faz.
- Só pode haver um Chrome com o perfil `~/.chrome-flow` aberto, e ele precisa ter sido aberto pelo script (com a porta 9333). Se esse perfil já está aberto sem a porta, feche-o antes.
- Testado em Linux. Windows e macOS: a busca do Chrome está implementada mas ainda não foi exercitada; se falhar, defina `FLOW_CHROME`.
