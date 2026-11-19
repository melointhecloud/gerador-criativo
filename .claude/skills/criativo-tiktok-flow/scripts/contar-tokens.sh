#!/usr/bin/env bash
# Soma os tokens de uma sessão do Claude Code a partir do log .jsonl.
# Uso: contar-tokens.sh <sessão.jsonl>
# O log fica em ~/.claude/projects/<projeto>/<id-da-sessão>.jsonl. O log não registra a % do limite de 5h: use /usage antes e depois.
set -euo pipefail

arq="${1:?uso: contar-tokens.sh <sessão.jsonl>}"
[[ -f "$arq" ]] || { echo "Arquivo não encontrado: $arq"; exit 2; }

# Uma resposta pode aparecer em várias linhas (um bloco por linha): fica a última de cada message.id.
jq -rs '
  [ .[] | select(.type == "assistant" and (.message.usage != null))
    | {id: (.message.id // .uuid), u: .message.usage, t: .timestamp} ]
  | group_by(.id) | map(last) | sort_by(.t) as $r
  | {
      respostas: ($r | length),
      inicio: ($r | first.t), fim: ($r | last.t),
      saida: ($r | map(.u.output_tokens // 0) | add),
      entrada_sem_cache: ($r | map(.u.input_tokens // 0) | add),
      cache_escrito: ($r | map(.u.cache_creation_input_tokens // 0) | add),
      cache_lido: ($r | map(.u.cache_read_input_tokens // 0) | add)
    }
  | to_entries[] | "\(.key)\t\(.value)"
' "$arq" | column -t -s $'\t'
