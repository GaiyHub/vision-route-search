#!/usr/bin/env bash
set -euo pipefail

# Rebuild assets used by shell_execute. Network is only used by this explicit
# developer script; application runtime never downloads executable code.
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
RUNTIME_TMP="$(mktemp -d)"
trap 'rm -rf "$RUNTIME_TMP"' EXIT

BUSYBOX_VERSION="1.37.0"
BUSYBOX_SHA256="3311dff32e746499f4df0d5df04d7eb396382d7e108bb9250e7b519b837043a4"

ASSET_DIR="$PROJECT_DIR/assets/shell"
JNI_DIR="$PROJECT_DIR/plugins/android/jniLibs/arm64-v8a"
mkdir -p "$ASSET_DIR" "$JNI_DIR"

NDK_ROOT="${ANDROID_NDK_HOME:-${ANDROID_NDK_ROOT:-}}"
if [ -z "$NDK_ROOT" ]; then
  NDK_ROOT="$(find "$HOME/Library/Android/sdk/ndk" -mindepth 1 -maxdepth 1 -type d | sort -V | tail -1)"
fi
TOOLCHAIN="$NDK_ROOT/toolchains/llvm/prebuilt/darwin-x86_64/bin"
CC="$TOOLCHAIN/aarch64-linux-android26-clang"
STRIP="$TOOLCHAIN/llvm-strip"

BUSYBOX_ARCHIVE="$RUNTIME_TMP/busybox-${BUSYBOX_VERSION}.tar.bz2"
curl -fSL "https://busybox.net/downloads/busybox-${BUSYBOX_VERSION}.tar.bz2" -o "$BUSYBOX_ARCHIVE"
echo "$BUSYBOX_SHA256  $BUSYBOX_ARCHIVE" | shasum -a 256 -c -
tar xjf "$BUSYBOX_ARCHIVE" -C "$RUNTIME_TMP"
BUSYBOX_DIR="$RUNTIME_TMP/busybox-${BUSYBOX_VERSION}"
patch -d "$BUSYBOX_DIR" -p1 < "$ASSET_DIR/busybox-android-lib-name.patch"
cp "$ASSET_DIR/busybox-${BUSYBOX_VERSION}-android-arm64.config" "$BUSYBOX_DIR/.config"
make -C "$BUSYBOX_DIR" -j4 CC="$CC" AR="$AR" RANLIB="$RANLIB" STRIP="$STRIP"
"$STRIP" "$BUSYBOX_DIR/busybox"
cp "$BUSYBOX_DIR/busybox" "$JNI_DIR/libbusybox.so"
chmod 0755 "$JNI_DIR/libbusybox.so"

shasum -a 256 \
  "$ASSET_DIR/busybox-${BUSYBOX_VERSION}-android-arm64.config" \
  "$ASSET_DIR/busybox-android-lib-name.patch" \
  "$JNI_DIR/libbusybox.so"
