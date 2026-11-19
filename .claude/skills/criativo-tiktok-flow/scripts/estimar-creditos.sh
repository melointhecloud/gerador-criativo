#!/usr/bin/env bash
# Estima os créditos do Flow para as cenas de um roteiro.json.
# Uso: estimar-creditos.sh <roteiro.json> [saldo] [variacoes=2]
# Tabela: Omni 1.2 Flash 720p medido em 2026-11-19 (references/flow.md). Confira "A geração vai usar N créditos" na tela.
set -euo pipefail

roteiro="${1:?uso: estimar-creditos.sh <roteiro.json> [saldo] [variacoes]}"
saldo="${2:-}"
variacoes="${3:-2}"

jq -r --argjson v "$variacoes" '
  def porsegundo: if . <= 10 then 3 else 4 end;  # acima de 10s: 15s medido em 4/s; 11-14s não medido
  def custo: (.segundos * (.segundos | porsegundo) * $v);
  ( .cenas[] | "cena \(.n | tostring | if length < 2 then "0" + . else . end)\t\(.segundos)s\t\(custo) créditos" ),
  "---",
  "TOTAL\t\([.cenas[].segundos] | add)s de roteiro\t\([.cenas[] | custo] | add) créditos (x\($v), sem regenerações)"
' "$roteiro" | column -t -s $'\t'

if [[ -n "$saldo" ]]; then
  total=$(jq --argjson v "$variacoes" '[.cenas[] | (.segundos * (if .segundos <= 10 then 3 else 4 end) * $v)] | add' "$roteiro")
  if (( total > saldo )); then
    echo "ATENÇÃO: ${total} créditos > saldo ${saldo}. Faltam $(( total - saldo ))."
    exit 1
  fi
  echo "Cabe no saldo (${saldo}); sobram $(( saldo - total )) para regenerar."
fi
