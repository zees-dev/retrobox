#!/bin/bash
export MESA_GL_VERSION_OVERRIDE=3.3
export MESA_GLSL_VERSION_OVERRIDE=330
export HOME=/home/pi

exec /nix/store/4r50iipazy6nr7hm6k2fm6wli96l07nr-retroarch-bare-1.21.0/bin/retroarch \
  -L /nix/store/wakpyax04ywiz5jl3p5aaxw0869x3lij-retroarch-with-cores-1.21.0/lib/retroarch/cores/mupen64plus_next_libretro.so \
  --verbose \
  "/home/pi/retrobox/presets/n64/4p/Mario Kart 64.zip"
