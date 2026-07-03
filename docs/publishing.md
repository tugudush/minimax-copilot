# Publishing MiniMax Copilot to the VS Code Marketplace

Step-by-step guide for packaging and publishing this extension.

---

## Prerequisites

| Requirement              | Details                                                                                    |
| ------------------------ | ------------------------------------------------------------------------------------------ |
| **Node.js**              | ≥ 18                                                                                       |
| **`vsce`**               | Installed locally (`@vscode/vsce` in devDependencies) — run `npx vsce --version` to verify |
| **Azure DevOps account** | Free at <https://dev.azure.com> — needed to create a publisher and obtain a PAT            |
| **Publisher ID**         | Must match the `publisher` field in `package.json` (`minimax-copilot-paygo`)               |

---

## 1. One-time setup: create a publisher

1. Go to <https://marketplace.visualstudio.com> and sign in with your Microsoft / Azure DevOps account.
2. Click **Publish extensions** → **Create publisher**.
3. Fill in the publisher name — it **must** match the `publisher` field in `package.json` exactly:
   ```
   minimax-copilot-paygo
   ```
4. Note the Personal Access Token (PAT) you generate — you'll need it for `vsce login`.

---

## 2. Authenticate with `vsce`

```bash
npx vsce login minimax-copilot-paygo
```

Paste the PAT when prompted. This stores credentials locally for future publishes.

---

## 3. Build the extension

```bash
# Clean build: lint → typecheck → format → bundle
npm run ltfb

# Package into a .vsix file
npm run package
```

This produces a file like:

```
minimax-copilot-0.1.0.vsix
```

The `package` script runs `vsce package` which:

- Reads `.vscodeignore` to decide what goes into the archive.
- Bundles only `dist/extension.js`, `package.json`, walkthrough markdown, and assets.
- Excludes `src/`, `test/`, `docs/`, config files, and dev tooling (see `.vscodeignore`).

### What's in the `.vsix`?

`vsce package` honours `.vscodeignore`. The current ignore list
excludes `node_modules/`, `src/`, `test/`, `docs/`, config files
(esbuild / eslint / tsconfig / prettier), `.git/`, `.env`,
`*.vsix`, **and `CHANGELOG.md`** (so the changelog is **not** part
of the published package — track its history in git / GitHub releases
instead). What lands in the archive:

```
minimax-copilot-0.1.0.vsix  (zip archive)
├── extension/
│   ├── package.json
│   ├── LICENSE              ← packaged by default (vsce includes MIT-license files automatically)
│   ├── dist/
│   │   └── extension.js    ← bundled output from esbuild
│   └── walkthroughs/
│       └── setup/
│           ├── welcome.md
│           ├── set-key.md
│           ├── choose-region.md
│           └── thinking.md
└── [VSIX metadata]
```

---

## 4. Test the `.vsix` locally

Before publishing, verify the package works:

```bash
# Install from the .vsix
code --install-extension minimax-copilot-0.1.0.vsix
```

Or in VS Code: **Extensions** → `···` → **Install from VSIX…** → select the file.

Then:

1. Reload VS Code (`Developer: Reload Window`).
2. Open Copilot Chat and confirm **MiniMax** appears as a provider.
3. Walk through the setup walkthrough.
4. Verify chat works with your API key.

To uninstall the test build:

```bash
code --uninstall-extension minimax-copilot-paygo.minimax-copilot
```

---

## 5. Publish to the Marketplace

### Publish a pre-release (beta)

```bash
npx vsce publish --pre-release
```

This marks the version as a pre-release in the Marketplace. Users who enable "Install Pre-release" will get it.

### Publish a stable release

```bash
npx vsce publish
```

### What happens on publish

1. `vsce` validates `package.json` (required fields, icon, readme, etc.).
2. The `.vsix` is uploaded to the VS Code Marketplace under publisher `minimax-copilot-paygo`.
3. The Marketplace runs a virus scan (may take a few minutes).
4. The extension goes live once scanning passes.

---

## 6. Bump the version

The Marketplace does not allow re-publishing the same version. Before each publish:

```bash
# Patch: 0.1.0 → 0.1.1
npm version patch

# Minor: 0.1.0 → 0.2.0
npm version minor

# Major: 0.1.0 → 1.0.0
npm version major
```

`npm version` updates `package.json`, creates a git commit and tag. Then rebuild and publish:

```bash
npm run ltfb
npm run package
npx vsce publish
```

---

## 7. Verify the listing

After publishing, check your extension at:

```
https://marketplace.visualstudio.com/items?itemName=minimax-copilot-paygo.minimax-copilot
```

It may take a few minutes for the Marketplace index to update.

---

## Notes on proposed APIs

This extension uses the **proposed** `languageModelThinkingPart` API via `enabledApiProposals` in `package.json`.

**Implications for publishing:**

- Proposed APIs are subject to change and are **not covered by the standard VS Code API stability guarantees**.
- Extensions using proposed APIs may be flagged during Marketplace review. You typically need approval from the VS Code team to ship to the stable Marketplace with proposed APIs.
- Proposed APIs are **enabled by default in VS Code Insiders**. For stable builds, users may need `#extensions.proposedApi` enabled in their settings, or the extension may need to be gated behind an Insiders check.
- Check the current status of the `languageModelThinkingPart` proposal at: <https://github.com/microsoft/vscode/blob/main/src/vscode-dts/vscode.proposed.d.ts>

If the proposal graduates to a stable API, update `enabledApiProposals` and the minimum `engines.vscode` version accordingly.

---

## Troubleshooting

| Problem                                               | Fix                                                                                                            |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `ERROR  Publisher not found`                          | Create a publisher at <https://marketplace.visualstudio.com> matching the `publisher` field in `package.json`. |
| `ERROR  Unauthorized`                                 | Re-run `npx vsce login minimax-copilot-paygo` with a valid PAT.                                                |
| `ERROR  Manifest missing field "version"`             | Ensure `package.json` has a valid `version` (e.g. `0.1.0`).                                                    |
| `ERROR  Cannot find module 'vscode'`                  | This is expected in bundled builds — `vscode` is marked `external` in esbuild. `vsce package` handles it.      |
| Extension installs but doesn't appear in Copilot Chat | Confirm you're on a VS Code build with `languageModelThinkingPart` support (Insiders).                         |
| Version already exists on Marketplace                 | Bump the version with `npm version patch` before publishing.                                                   |
| `.vsix` is too large                                  | Check `.vscodeignore` excludes `node_modules/`, `src/`, `test/`, and other dev files.                          |

---

## Quick reference

```bash
# Full workflow: build, test, publish
npm run ltfb                      # lint + typecheck + format + compile
npm run package                   # create .vsix
code --install-extension minimax-copilot-*.vsix   # test locally
npx vsce publish --pre-release    # publish beta
npx vsce publish                  # publish stable
```
