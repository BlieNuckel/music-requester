{
  lib,
  stdenv,
  nodejs,
  pnpm,
  fetchPnpmDeps,
  pnpmConfigHook,
  node-gyp,
  python3,
  makeWrapper,
}:

stdenv.mkDerivation (finalAttrs: {
  pname = "tunearr";
  version = "0.1.0";

  # Filter out generated/local dirs so the build input is reproducible and the
  # pnpmDeps hash stays stable across machines.
  src = lib.cleanSourceWith {
    src = ../.;
    filter =
      path: _type:
      let
        base = baseNameOf path;
      in
      !(builtins.elem base [
        "node_modules"
        "build"
        "config"
        "result"
      ]);
  };

  nativeBuildInputs = [
    nodejs
    pnpm
    pnpmConfigHook
    node-gyp # not on PATH under pnpm (unlike npm); needed to compile better-sqlite3
    python3 # node-gyp toolchain
    makeWrapper
  ];

  # Offline pnpm store. After changing dependencies, set `hash = lib.fakeHash;`,
  # rebuild, and copy the correct hash from the error message.
  pnpmDeps = fetchPnpmDeps {
    inherit (finalAttrs) pname version src;
    fetcherVersion = 4;
    hash = "sha256-QnxLuQCePl+H0sxuo/f9lV3NtiOAjsVFVMij1RLlgSI=";
  };

  # pnpmConfigHook installs with --ignore-scripts, so the native better-sqlite3
  # addon is never compiled. Run node-gyp directly (rather than via pnpm, which
  # would attempt the prebuild-install network fetch and swallow build output)
  # against this build's node headers, fully offline.
  preBuild = ''
    export HOME=$TMPDIR
    export PYTHON=${python3}/bin/python3
    pushd node_modules/.pnpm/better-sqlite3@*/node_modules/better-sqlite3
    node-gyp rebuild --release --nodedir=${nodejs}
    popd
  '';

  buildPhase = ''
    runHook preBuild
    pnpm run build
    runHook postBuild
  '';

  # The server runs the TypeScript sources directly via tsx (matching the
  # Dockerfile), so we ship server/, shared/, the built frontend, and the
  # already-installed node_modules. server/ and build/ must stay siblings
  # because index.ts resolves the static dir as path.join(__dirname, "..", "build").
  installPhase = ''
    runHook preInstall

    mkdir -p $out/libexec/tunearr
    cp -r build server shared node_modules package.json $out/libexec/tunearr/

    makeWrapper ${nodejs}/bin/node $out/bin/tunearr \
      --add-flags "$out/libexec/tunearr/node_modules/tsx/dist/cli.mjs" \
      --add-flags "--tsconfig $out/libexec/tunearr/server/tsconfig.json" \
      --add-flags "$out/libexec/tunearr/server/index.ts" \
      --set NODE_ENV production \
      --chdir $out/libexec/tunearr

    runHook postInstall
  '';

  meta = {
    description = "Self-hosted music request server";
    mainProgram = "tunearr";
    platforms = lib.platforms.linux;
  };
})
