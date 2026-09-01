# Shell runtime provenance

- BusyBox: BusyBox 1.37.0, downloaded from `https://busybox.net/downloads/busybox-1.37.0.tar.bz2`; source SHA-256 `3311dff32e746499f4df0d5df04d7eb396382d7e108bb9250e7b519b837043a4`, GPL-2.0-only. The Android arm64 PIE binary is built with NDK 27.1.12297006 from `busybox-1.37.0-android-arm64.config` (SHA-256 `3dd357630bde0023d62903aa4b3ef0c133b1ec49501738877b776bf28a73de9b`); `busybox-android-lib-name.patch` only adds recognition of Android's packaged `libbusybox.so` filename. Binary SHA-256: `9c459fa0bef1f070e00a132dc5bfd45bc9ca6fc68e80beb49f2cabd7f6e52a0e`.

Rebuild the packaged artifacts with `scripts/prepare_shell_runtime.sh`.
