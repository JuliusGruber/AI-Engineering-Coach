# Development Container

This folder contains the [Dev Container](https://containers.dev/) configuration for
contributing to **AI Engineering Coach**. It provides a one-click, reproducible
development environment for the VS Code extension.

## What you get

- Node.js 22 (LTS) on Debian Bookworm
- `npm install` runs automatically after the container is created
- GitHub CLI (`gh`) preinstalled
- Recommended VS Code extensions preinstalled:
  - ESLint (`dbaeumer.vscode-eslint`)
  - TypeScript Next (`ms-vscode.vscode-typescript-next`)
  - Vitest Explorer (`vitest.explorer`)
  - Code Spell Checker (`streetsidesoftware.code-spell-checker`)
  - Playwright Test (`ms-playwright.playwright`)

## How to use it

### GitHub Codespaces
Open this repository on GitHub and choose **Code → Codespaces → Create codespace
on main**. The container will build and dependencies will install automatically.

### VS Code (Dev Containers extension)
1. Install the [Dev Containers](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers)
   extension.
2. Open the cloned repository in VS Code.
3. Run **Dev Containers: Reopen in Container** from the Command Palette.

Once the container is ready, run `npm run check` to verify your setup (typecheck,
lint, spellcheck, knip, and tests).
