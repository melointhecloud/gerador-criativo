#!/usr/bin/env bash
# Verifica o ambiente da skill criativo-tiktok-flow e roda uma demonstração sem custo.
# Uso: .claude/skills/criativo-tiktok-flow/scripts/doctor.sh   (a partir da raiz do repositório)
set -uo pipefail

aqui="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
raiz="$(cd "$aqui/../../../.." && pwd)"
exemplo="$raiz/criativos/emagrecimento-teste-20261119"
falhas=0

ok()    { printf "  [ok]    %s\n" "$1"; }
falta() { printf "  [FALTA] %s\n         %s\n" "$1" "$2"; falhas=$((falhas + 1)); }

echo "1) Ferramentas"
for cmd in ffmpeg ffprobe jq column awk; do
  if command -v "$cmd" >/dev/null 2>&1; then ok "$cmd"; else
    case "$cmd" in
      ffmpeg|ffprobe) dica="Instale o ffmpeg (Ubuntu: sudo apt install ffmpeg | macOS: brew install ffmpeg)" ;;
      jq)             dica="Instale o jq (Ubuntu: sudo apt install jq | macOS: brew install jq)" ;;
      column)         dica="Instale bsdmainutils/util-linux (Ubuntu: sudo apt install bsdmainutils)" ;;
      *)              dica="Instale $cmd" ;;
    esac
    falta "$cmd" "$dica"
  fi
done

echo "1b) Modo script (gera as cenas sozinho no Flow)"
if command -v node >/dev/null 2>&1; then
  nv=$(node -p "process.versions.node.split('.')[0]")
  if (( nv >= 18 )); then ok "node v$(node -v | tr -d v)"; else falta "node muito antigo (v$nv)" "Instale o Node.js LTS em https://nodejs.org (versão 18 ou maior)."; fi
else
  falta "node" "Instale o Node.js LTS em https://nodejs.org (baixe o instalador, avance até o fim e reabra o terminal)."
fi
if [[ -d "$aqui/flow/node_modules/playwright-core" ]]; then ok "dependências do script (npm install)"; else
  falta "dependências do script" "Rode: cd .claude/skills/criativo-tiktok-flow/scripts/flow && npm install"
fi
if command -v node >/dev/null 2>&1 && [[ -d "$aqui/flow/node_modules/playwright-core" ]]; then
  if node "$aqui/flow/flow.mjs" chrome >/dev/null 2>&1; then ok "Google Chrome encontrado"; else
    falta "Google Chrome" "Instale em https://www.google.com/chrome (o script abre o Chrome sozinho)."
  fi
fi

echo "2) Arquivos da skill"
for f in SKILL.md references/flow.md references/prompts.md references/flow-assistido.md references/flow-script.md scripts/estimar-creditos.sh scripts/checar-cenas.sh scripts/flow/flow.mjs scripts/flow/package.json; do
  [[ -f "$aqui/../$f" ]] && ok "$f" || falta "$f" "Arquivo ausente: confira se o clone está completo (git status)."
done
[[ -f "$exemplo/roteiro.json" ]] && ok "criativo de exemplo" || falta "criativo de exemplo" "Esperado em $exemplo"

echo "3) Demonstração (sem custo)"
if (( falhas == 0 )); then
  echo "   Estimativa de créditos do criativo de exemplo (saldo 250):"
  "$aqui/estimar-creditos.sh" "$exemplo/roteiro.json" 250 | sed 's/^/     /' && ok "estimar-creditos.sh" || falta "estimar-creditos.sh" "Falhou com o exemplo."

  tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
  mkdir -p "$tmp/cenas"; cp "$exemplo/roteiro.json" "$tmp/roteiro.json"
  for n in 01 02 03; do
    ffmpeg -v error -f lavfi -i "color=c=blue:s=720x1280:d=8" -f lavfi -i "sine=d=8" -shortest -c:v libx264 -c:a aac "$tmp/cenas/cena-$n.mp4"
  done
  echo "   Checagem de 3 cenas de teste geradas pelo ffmpeg:"
  "$aqui/checar-cenas.sh" "$tmp" | sed 's/^/     /' && ok "checar-cenas.sh" || falta "checar-cenas.sh" "Falhou com cenas de teste."
fi

echo
echo "4) Passos manuais (o script não consegue conferir)"
echo "   - Entrar na conta do Flow UMA vez no Chrome do script:  node .claude/skills/criativo-tiktok-flow/scripts/flow/flow.mjs login"
echo "     (abre uma janela do Chrome; entre com a conta Google que vai gastar os créditos; o login fica salvo)."
echo "   - Ver o saldo: avatar no canto superior direito do Flow."
echo "   - Modo assistido (opcional): extensão Claude in Chrome conectada ao Claude Code."

echo
if (( falhas )); then echo "Resultado: $falhas problema(s). Corrija e rode de novo."; exit 1; fi
echo "Resultado: tudo certo. Próximo passo: peça 'criar um criativo' ao Claude (skill criativo-tiktok-flow)."
