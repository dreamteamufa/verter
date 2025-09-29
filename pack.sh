#!/usr/bin/env bash
set -euo pipefail

SRC="src/Verter.user.js"
if [[ ! -f "$SRC" ]]; then
  echo "ERR: not found $SRC" >&2
  exit 1
fi

APPV=$(sed -n 's/.*appversion *= *"\(.*\)".*/\1/p' "$SRC" | head -1)
if [[ -z "$APPV" ]]; then
  echo "ERR: appversion not found in $SRC" >&2
  exit 2
fi

VER=${APPV##*ver. }
APP=${APPV%% ver*}
LABEL="OrderGate+VirtFix+VirtUI"
STAMP=$(date +%Y%m%d-%H%M)

README_SRC="README.md"
CLEANUP_README=0
if [[ ! -f "$README_SRC" ]]; then
  if [[ -f "README_snippet.md" ]]; then
    cp "README_snippet.md" "$README_SRC"
    CLEANUP_README=1
  else
    echo "ERR: README.md not found" >&2
    exit 3
  fi
fi

OUTDIR="build"
NAME="${APP}_ver_${VER}_(${LABEL})_${STAMP}.zip"

mkdir -p "$OUTDIR"
zip -r "${OUTDIR}/${NAME}" "$SRC" "$README_SRC" >/dev/null

if [[ $CLEANUP_README -eq 1 ]]; then
  rm "$README_SRC"
fi

# совместимый алиас
cp "${OUTDIR}/${NAME}" "${OUTDIR}/Verter_SAFE.zip"

# метаданные для релиза
printf '%s\n' "$NAME" > "${OUTDIR}/ARTIFACT_NAME.txt"
printf 'v%s\n' "$VER" > "${OUTDIR}/RELEASE_TAG.txt"
printf '%s — %s\n' "$APPV" "$LABEL" > "${OUTDIR}/RELEASE_TITLE.txt"

echo "Built: ${OUTDIR}/${NAME}"
echo "Alias: ${OUTDIR}/Verter_SAFE.zip"
