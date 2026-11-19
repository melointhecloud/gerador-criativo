#!/usr/bin/env bash
# Confere as cenas baixadas do Flow contra o roteiro.
# Uso: checar-cenas.sh <pasta-do-criativo>
# Espera cenas/cena-NN.mp4 para cada cena do roteiro.json. Sai com código 1 se algo falta ou está fora do esperado.
set -uo pipefail

pasta="${1:?uso: checar-cenas.sh <pasta-do-criativo>}"
roteiro="$pasta/roteiro.json"
[[ -f "$roteiro" ]] || { echo "Sem $roteiro"; exit 2; }

problemas=0
printf "%-8s %-9s %-11s %-6s %s\n" "cena" "duração" "tamanho" "áudio" "status"

while IFS=$'\t' read -r n planejado; do
  nn=$(printf "%02d" "$n")
  arq="$pasta/cenas/cena-$nn.mp4"
  if [[ ! -f "$arq" ]]; then
    printf "%-8s %-9s %-11s %-6s %s\n" "$nn" "-" "-" "-" "FALTA"
    problemas=$((problemas + 1)); continue
  fi
  dur=$(ffprobe -v error -select_streams v:0 -show_entries format=duration -of csv=p=0 "$arq" 2>/dev/null)
  tam=$(ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=s=x:p=0 "$arq" 2>/dev/null)
  audio=$(ffprobe -v error -select_streams a -show_entries stream=codec_type -of csv=p=0 "$arq" 2>/dev/null | head -1)
  w=${tam%x*}; h=${tam#*x}
  notas=()
  [[ -z "$dur" || -z "$tam" ]] && notas+=("arquivo ilegível")
  if [[ -n "$w" && -n "$h" && "$w" =~ ^[0-9]+$ && "$h" =~ ^[0-9]+$ ]]; then
    (( w * 16 != h * 9 )) && notas+=("não é 9:16")
  fi
  [[ -z "$audio" ]] && notas+=("sem áudio")
  if [[ -n "$dur" ]] && awk -v d="$dur" -v p="$planejado" 'BEGIN { exit !((d - p > 2) || (p - d > 2)) }'; then
    notas+=("duração difere do plano (${planejado}s)")
  fi
  if (( ${#notas[@]} )); then
    status="CONFERIR: $(printf '%s; ' "${notas[@]}")"; status="${status%; }"; problemas=$((problemas + 1))
  else
    status="ok"
  fi
  tem_audio="não"; [[ -n "$audio" ]] && tem_audio="sim"
  printf "%-8s %-9s %-11s %-6s %s\n" "$nn" "$(LC_ALL=C printf '%.1fs' "${dur:-0}")" "${tam:--}" "$tem_audio" "$status"
done < <(jq -r '.cenas[] | "\(.n)\t\(.segundos)"' "$roteiro")

echo
if (( problemas )); then echo "$problemas cena(s) com problema."; exit 1; fi
echo "Todas as cenas conferem com o roteiro."
