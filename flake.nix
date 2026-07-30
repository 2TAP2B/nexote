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
          ];

          shellHook = ''
            echo "nexote devshell"
            echo "  go:    $(go version)"
            echo "  node:  $(node --version)"
            echo "  pnpm:  $(pnpm --version)"
          '';
        };
      });
}