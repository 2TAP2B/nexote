#!/usr/bin/env bash
# Builds the Go engine of the Android app into
# android/app/libs/nexote-engine.aar: the frontend's static export, embedded
# into backend/mobile (web/), bound with gomobile for arm64 phones and the
# x86_64 emulator. Needs Go, Node + pnpm, ANDROID_HOME and ANDROID_NDK_HOME;
# `nix develop .#android` has all of them. NEXOTE_VERSION / NEXOTE_COMMIT,
# when set, reach the frontend build (Settings › About) through the
# environment.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
frontend="$root/frontend"
web="$root/backend/mobile/web"
aar="$root/android/app/libs/nexote-engine.aar"

if [[ -z "${ANDROID_HOME:-}" || ! -d "$ANDROID_HOME" ]]; then
  echo "build-engine.sh: set ANDROID_HOME to the Android SDK (nix develop .#android does)" >&2
  exit 1
fi
if [[ -z "${ANDROID_NDK_HOME:-}" || ! -d "$ANDROID_NDK_HOME" ]]; then
  echo "build-engine.sh: set ANDROID_NDK_HOME to an Android NDK (nix develop .#android does)" >&2
  exit 1
fi

# backend/mobile/web is committed holding only its .gitignore; the export
# lives there just for the bind. Emptied again on every exit, failures too.
clear_web() {
  if [[ -d "$web" ]]; then
    find "$web" -mindepth 1 -maxdepth 1 ! -name .gitignore -exec rm -rf {} +
  fi
}

# next build rewrites frontend/next-env.d.ts. Put it back afterwards, but
# only when it had no uncommitted changes of its own.
restore_env_types=0
if git -C "$root" ls-files --error-unmatch frontend/next-env.d.ts >/dev/null 2>&1 &&
  git -C "$root" diff --quiet -- frontend/next-env.d.ts; then
  restore_env_types=1
fi

tools="$(mktemp -d)"
cleanup() {
  clear_web
  rm -rf "$tools"
  if [[ $restore_env_types == 1 ]]; then
    git -C "$root" checkout -- frontend/next-env.d.ts
  fi
}
trap cleanup EXIT

echo "==> Frontend export"
cd "$frontend"
if [[ ! -d node_modules ]]; then
  # Same as the Dockerfile: approve the dependencies' build scripts.
  pnpm install --frozen-lockfile --config.dangerouslyAllowAllBuilds=true
fi
rm -rf out
NEXOTE_EXPORT=1 pnpm build
if [[ ! -f out/index.html ]]; then
  echo "build-engine.sh: the export produced no frontend/out/index.html" >&2
  exit 1
fi

echo "==> Embedding the export"
mkdir -p "$web"
clear_web
cp -R out/. "$web/"

echo "==> gomobile bind"
cd "$root/backend"
# The gomobile/gobind versions pinned in go.mod, not whatever is installed.
GOBIN="$tools" go install golang.org/x/mobile/cmd/gomobile golang.org/x/mobile/cmd/gobind
export PATH="$tools:$PATH"
mkdir -p "$(dirname "$aar")"
gomobile bind \
  -target=android/arm64,android/amd64 \
  -androidapi 26 \
  -javapkg app.nexote \
  -trimpath \
  -ldflags="-s -w" \
  -o "$aar" \
  ./mobile

echo "==> $aar"
