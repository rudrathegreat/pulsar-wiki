# PulsarWiki

PulsarWiki is a local, browser-only interface for a source-backed pulsar astronomy wiki. Its chat uses an eligible ChatGPT subscription, while wiki files and saved conversations remain on the local machine.

## Requirements

- Node.js 20.19.0 or newer
- An eligible ChatGPT subscription
- Permission to grant PulsarWiki direct ChatGPT plan usage during sign-in

ChatGPT subscription sharing is currently a preview feature. Eligibility, model availability, and usage limits are determined by the connected ChatGPT account and workspace.

## Install and run

    npm install
    npm start

In PowerShell environments where `npm.ps1` is disabled, use:

    npm.cmd install
    npm.cmd start

Open the displayed loopback address, normally <http://127.0.0.1:3000>. PulsarWiki is intentionally local-only and browser-based; do not expose it through a reverse proxy, LAN address, or the public internet.

## Connect ChatGPT

1. Select **Connect ChatGPT** in the top-right corner.
2. Choose **Continue with ChatGPT** and complete the OpenAI authorization page.
3. Grant the requested ChatGPT plan-usage permission.
4. Choose one of the subscription models returned for that account and save it.

PulsarWiki displays model names from the connected account and submits their catalog slugs. It automatically selects the first available model after the initial connection, keeps a saved selection while it remains available, and falls back to the new first model if availability changes.

There is no API-key or alternate-provider fallback. Usage is charged against the connected ChatGPT plan and is subject to that plan's limits. The settings dialog links to the ChatGPT usage page.

## Credentials and disconnection

One ChatGPT account registration is retained at a time in the operating system's user configuration directory:

- Windows: `%LOCALAPPDATA%\PulsarWiki\chatgpt-auth.json`
- macOS: `~/Library/Application Support/PulsarWiki/chatgpt-auth.json`
- Linux: `${XDG_CONFIG_HOME:-~/.config}/pulsarwiki/chatgpt-auth.json`

The file is written atomically and uses owner-only permissions where the operating system supports them. Access, refresh, and ID tokens are never placed in browser storage, application URLs, logs, or API responses.

**Disconnect** revokes the active session when possible and retains the saved account registration for easy reconnection. **Forget account** revokes the session and removes the saved account before another account can be connected.

## Saved chats and agent context

Chats are stored in ignored local application data at `.pulsarwiki/chat/`. Each Responses API request uses `store: false`, streams its result, and resends the complete local conversation transcript. Saved chats remain available across ChatGPT disconnects and account changes.

`GEMINI.md` is loaded when the local server starts and becomes the canonical instruction snapshot for new chats. Restart the server after editing it to create chats using the new instruction version.

## Local tool boundaries

The model can only ask the server to list, search, and read bounded wiki or source excerpts, including locally extracted PDF text. It has no shell, network, terminal, or general filesystem tool.

All agent writes use one validated local operation:

- only Markdown under `wiki/` may be changed;
- `raw/` is immutable;
- normal page changes require an accompanying `wiki/index.md` update;
- `wiki/log.md` is appended automatically; and
- failed operations roll back their local file changes.

## Document viewing

Open **Files** to preview source material without leaving PulsarWiki. PDFs use the local PDF.js viewer with page navigation, zoom, and fit-to-width controls.

## Troubleshooting

If sign-in is declined or expires, open the ChatGPT settings dialog and reconnect. If plan permission is missing, reconnect and approve direct plan usage. Ineligible subscriptions and usage limits cannot fall back to API-key billing; check the account or its [ChatGPT usage page](https://chatgpt.com/settings/usage).

Temporary OpenAI failures leave the saved registration intact so reconnection can be retried. A terminal refresh failure clears the active session and asks you to sign in again.

If port 3000 is in use, set another local port:

    $env:PORT = 3001
    npm.cmd start

## License

See [LICENSE](LICENSE).
