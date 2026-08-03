# Pulsar Wiki - LLM Wiki Concept

## Prerequisites

- Node.js 20.19.0 or newer (required by the locked `chokidar` dependency)
- npm (included with Node.js)

Check the installed versions:

```bash
node --version
npm --version
```

On Windows PowerShell, use `npm.cmd --version` if running `npm` reports that
`npm.ps1` cannot be loaded because script execution is disabled.

## Installation

Clone the repository, enter its directory, and install the dependencies:

```bash
git clone <repository-url>
cd pulsar-wiki
npm install
```

In Windows PowerShell with script execution disabled, use:

```powershell
npm.cmd install
```

## Running the project

```bash
npm start
```

In Windows PowerShell with script execution disabled, use the Windows command
shim instead:

```powershell
npm.cmd start
```

Then open <http://localhost:3000>.

## First-run CLI setup

On first launch, PulsarWiki asks which local coding-agent CLI should power chat:

- Claude Code (`claude`)
- Antigravity CLI (`agy`)
- Codex CLI (`codex`)
- OpenCode (`opencode`)

You can select any tool during setup even if PulsarWiki cannot detect it. The
selected command only needs to be installed, authenticated, and available on the
server's `PATH` when you use chat. PulsarWiki stores the choice locally in
`.pulsarwiki.json`; this file is ignored by Git. To change the selection later,
click the CLI name in the top-right status control. The browser also keeps its
own preference and sends it with chat requests, so setup still works when a host
does not expose the configuration API correctly.

## Document viewing

Open **Files** to preview source material without leaving PulsarWiki. PDF files use
the built-in PDF.js viewer with page navigation, zoom, and fit-to-width controls.
Markdown and text-based files render in the same themed reading surface as the
rest of the wiki. Every document can still be downloaded from the viewer header.

## Troubleshooting

### `npm.ps1 cannot be loaded because running scripts is disabled`

PowerShell is trying to invoke npm's PowerShell wrapper, but the local execution
policy blocks it. Run `npm.cmd install` and `npm.cmd start`; this uses npm's
Windows command shim and does not require changing the machine's execution
policy.

### `Cannot find module 'express'`

The project dependencies have not been installed in the current checkout. Run
`npm install` (or `npm.cmd install` in restricted PowerShell), then start the
server again.

### Port 3000 is already in use

Set a different port before starting the server. For example, in PowerShell:

```powershell
$env:PORT = 3001
npm.cmd start
```

## License

See [LICENSE](LICENSE).
