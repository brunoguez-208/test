#!/usr/bin/env bash
# Compila whisper.cpp para Windows desde Linux (MinGW-w64) con backend Vulkan
# (GPU de NVIDIA, AMD o Intel) y CPU con todas las variantes (AVX2, AVX-512…),
# cargados como DLL: si no hay GPU o driver de Vulkan, ggml usa la CPU solo.
# Los binarios quedan en src-tauri/binaries/whisper/ (los empaqueta el instalador).
#
# Requisitos (Ubuntu): mingw-w64 cmake ninja-build glslc libvulkan-dev, y el
# paquete spirv-headers (solo los headers; se extraen sin instalar).
set -euo pipefail

VERSION="${WHISPER_VERSION:-v1.9.2}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/src-tauri/binaries/whisper"
WORK="${WORK:-$(mktemp -d)}"
SRC="$WORK/whisper.cpp"

git clone -q --depth 1 --branch "$VERSION" https://github.com/ggml-org/whisper.cpp "$SRC"

# Headers de Vulkan y SPIR-V aparte (no se puede sumar /usr/include a un build cruzado).
mkdir -p "$WORK/vkinc"
cp -r /usr/include/vulkan /usr/include/vk_video "$WORK/vkinc/"
(cd "$WORK" && apt-get download spirv-headers >/dev/null && dpkg -x spirv-headers_*.deb spirv)
cp -r "$WORK/spirv/usr/include/spirv" "$WORK/vkinc/"

# Librería de importación de vulkan-1.dll: solo funciones del núcleo (1.0–1.3) y WSI,
# que son las que exporta el loader de Windows.
python3 - "$WORK" <<'PY'
import re, sys
work = sys.argv[1]
keep = re.compile(r'VK_VERSION_1_\d$|VK_KHR_surface$|VK_KHR_swapchain$|VK_KHR_display$|VK_KHR_display_swapchain$')
sec, out = None, set()
for line in open('/usr/include/vulkan/vulkan_core.h'):
    m = re.match(r'#define (VK_\w+) 1\s*$', line)
    if m and (m.group(1).startswith('VK_VERSION_') or re.match(r'VK_[A-Z]+_\w+', m.group(1))):
        sec = m.group(1)
    m = re.search(r'VKAPI_ATTR \w+ VKAPI_CALL (vk\w+)\(', line)
    if m and sec and keep.match(sec):
        out.add(m.group(1))
open(f'{work}/vulkan-1.def', 'w').write('LIBRARY vulkan-1.dll\nEXPORTS\n' + '\n'.join(sorted(out)) + '\n')
PY
x86_64-w64-mingw32-dlltool -d "$WORK/vulkan-1.def" -l "$WORK/libvulkan-1.a"

# Definiciones de Windows 11 que faltan en los headers de MinGW.
cat > "$WORK/mingw-compat.h" <<'H'
#ifndef SNIP_MINGW_COMPAT_H
#define SNIP_MINGW_COMPAT_H
#if defined(_WIN32) && !defined(THREAD_POWER_THROTTLING_CURRENT_VERSION)
#define THREAD_POWER_THROTTLING_CURRENT_VERSION 1
#define THREAD_POWER_THROTTLING_EXECUTION_SPEED 0x1
typedef struct _THREAD_POWER_THROTTLING_STATE { unsigned long Version, ControlMask, StateMask; } THREAD_POWER_THROTTLING_STATE;
#endif
#endif
H

cat > "$WORK/mingw.cmake" <<'T'
set(CMAKE_SYSTEM_NAME Windows)
set(CMAKE_SYSTEM_PROCESSOR x86_64)
set(CMAKE_C_COMPILER x86_64-w64-mingw32-gcc-posix)
set(CMAKE_CXX_COMPILER x86_64-w64-mingw32-g++-posix)
set(CMAKE_RC_COMPILER x86_64-w64-mingw32-windres)
set(CMAKE_FIND_ROOT_PATH /usr/x86_64-w64-mingw32)
set(CMAKE_FIND_ROOT_PATH_MODE_PROGRAM NEVER)
set(CMAKE_FIND_ROOT_PATH_MODE_LIBRARY ONLY)
set(CMAKE_FIND_ROOT_PATH_MODE_INCLUDE ONLY)
T

LINK="-static-libgcc -static-libstdc++ -Wl,--exclude-libs,ALL"
cmake -S "$SRC" -B "$WORK/build" -G Ninja -DCMAKE_TOOLCHAIN_FILE="$WORK/mingw.cmake" -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_C_FLAGS="-include $WORK/mingw-compat.h" -DCMAKE_CXX_FLAGS="-include $WORK/mingw-compat.h" \
  -DCMAKE_SHARED_LINKER_FLAGS="$LINK" -DCMAKE_MODULE_LINKER_FLAGS="$LINK" -DCMAKE_EXE_LINKER_FLAGS="-static-libgcc -static-libstdc++" \
  -DBUILD_SHARED_LIBS=ON -DGGML_BACKEND_DL=ON -DGGML_CPU_ALL_VARIANTS=ON -DGGML_NATIVE=OFF -DGGML_OPENMP=OFF \
  -DGGML_VULKAN=ON -DVulkan_INCLUDE_DIR="$WORK/vkinc" -DVulkan_LIBRARY="$WORK/libvulkan-1.a" -DVulkan_GLSLC_EXECUTABLE="$(command -v glslc)" \
  -DSPIRV-Headers_DIR="$WORK/spirv/usr/share/cmake/SPIRV-Headers" \
  -DWHISPER_BUILD_TESTS=OFF -DWHISPER_BUILD_EXAMPLES=ON -DWHISPER_SDL2=OFF -DWHISPER_CURL=OFF
cmake --build "$WORK/build" -j "$(nproc)"

mkdir -p "$DEST"
rm -f "$DEST"/*.dll "$DEST"/*.exe
cp "$WORK/build/bin/whisper-cli.exe" "$WORK/build/bin/libwhisper.dll" "$WORK/build/bin/ggml.dll" \
   "$WORK/build/bin/ggml-base.dll" "$WORK/build/bin/ggml-vulkan.dll" "$WORK/build/bin"/ggml-cpu-*.dll "$DEST/"
cp /usr/x86_64-w64-mingw32/lib/libwinpthread-1.dll "$DEST/"
cp "$SRC/LICENSE" "$DEST/WHISPER-LICENSE.txt"
echo "$VERSION (Vulkan + CPU, MinGW-w64)" > "$DEST/WHISPER-VERSION.txt"
echo "Listo → $DEST"
