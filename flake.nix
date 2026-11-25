{
  description = "Nexote - a markdown note-taking app with Milkdown + Go";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs { inherit system; };
        # The Android SDK is unfree and needs its license accepted; only the
        # android shell pulls it in.
        androidPkgs = import nixpkgs {
          inherit system;
          config = {
            allowUnfree = true;
            android_sdk.accept_license = true;
          };
        };
        # Versions match android/app/build.gradle.kts (compileSdk,
        # buildToolsVersion); the NDK is for gomobile, the emulator and its
        # x86_64 image for trying the app on this machine.
        androidSdk = (androidPkgs.androidenv.composeAndroidPackages {
          platformVersions = [ "35" ];
          buildToolsVersions = [ "35.0.0" ];
          includeNDK = true;
          includeEmulator = true;
          includeSystemImages = true;
          systemImageTypes = [ "google_apis" ];
          abiVersions = [ "x86_64" ];
        }).androidsdk;
      in
      {
        devShells.default = pkgs.mkShell {
          packages = with pkgs; [
            # Go backend
            go_1_25
            gopls
            gotools

            # Frontend
            nodejs_22
            pnpm
            typescript-language-server

            # Tooling
            ripgrep
            # GitHub CLI (releases, repo admin)
            gh
          ];

          shellHook = ''
            echo "nexote devshell"
            echo "  go:    $(go version)"
            echo "  node:  $(node --version)"
            echo "  pnpm:  $(pnpm --version)"
          '';
        };

        # Android app (android/): `nix develop .#android`, then
        # android/build-engine.sh and ./gradlew in android/.
        devShells.android = pkgs.mkShell {
          packages = [
            pkgs.go_1_25
            pkgs.nodejs_22
            pkgs.pnpm
            pkgs.jdk17
            androidSdk
          ];
          ANDROID_HOME = "${androidSdk}/libexec/android-sdk";
          ANDROID_SDK_ROOT = "${androidSdk}/libexec/android-sdk";
          JAVA_HOME = pkgs.jdk17.home;
          shellHook = ''
            export ANDROID_NDK_HOME="$(echo "$ANDROID_HOME"/ndk/* | cut -d' ' -f1)"
            # Gradle downloads aapt2 from Maven as a generic Linux binary,
            # which doesn't run on NixOS; use the SDK's patched one.
            export GRADLE_OPTS="-Dorg.gradle.project.android.aapt2FromMavenOverride=$ANDROID_HOME/build-tools/35.0.0/aapt2"
            echo "nexote android devshell (sdk: $ANDROID_HOME, ndk: $ANDROID_NDK_HOME)"
          '';
        };
      });
}