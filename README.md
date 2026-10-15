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

## AI-assisted active reading

Open a PDF from **Files** to read continuous pages with selectable text, page thumbnails, rotation, paper search, and a collapsible reading panel. The **Reading library** icon opens passages and drafts across all papers.

Select text and choose yellow, green, blue, or pink to highlight it. **Add note** opens personal comments; **Edit / comment** also lets you change colours and optional, comma-separated categories. Colours do not assign scientific meaning. Use **Select region** and drag a rectangle around an equation, figure, or scanned passage. Add a transcription when needed; automatic OCR is not included.

The reading panel supports filtering by paper, colour, category, comment presence, and text. Check individual passages to build an input selection across papers. Check individual comments or previous AI responses only when you want them included. Collections preserve passage order, theme labels, and collection notes, with a table for comparison. **Link** connects a passage to an existing wiki page or another highlight. Connected wiki pages display private reading backlinks.

**Ask AI** offers passage, equation, method, assumption, concept, custom-question, evidence-comparison, and connection assistance. Review the exact passages, optional nearby context, checked comments, additional wiki pages, and selected visual inputs before submitting to the connected ChatGPT model. Reading tasks have no filesystem-write or general source-reading tools. No whole-paper text is added to selection-based summaries. Image capability depends on the subscription model; if unsupported, turn off image input and enter a transcription. Requests can be stopped, inspected, or explicitly retried with their preserved inputs.

**Search & discover** provides local ranked search over wiki pages, supported source text, highlights, and notes. External discovery sends the displayed, editable query to arXiv and NASA ADS. Results remain saved locally after previews expire. Abstract-only candidates are labelled accordingly and cannot establish verified full-text support. Select candidates for a researcher-initiated evidence comparison, or explicitly import a PDF. Existing automatic AI ingestion on upload/import is retained; it is the exception to the reader's explicit-AI rule.

**Create artifact** makes a private, editable Markdown draft without calling AI. Choose a paper reading summary, multi-paper synthesis, evidence comparison, or update to an existing concept page. Optionally request an AI draft from the captured inputs. Inspect source references and the rendered preview; concept updates show a line diff. Publishing requires researcher review and updates the wiki page, index, and append-only log through the validated wiki writer. Existing pages cannot be overwritten by a new artifact, and concept updates reject stale page versions.

Published artifacts contain selected source excerpts, page links, source hashes, explicitly included researcher comments, and provenance for included AI interpretations. Visual crops remain private; their source location and any transcription are retained. Other private comments are excluded. Later edits mark dependent drafts as outdated; regeneration is explicit. Revision-qualified passage links preserve original selections even after reattachment or deletion.

Reading records, snapshots, and visual selections are stored locally in ignored `.pulsarwiki/reading/`. They survive ChatGPT disconnects and account changes, but do not travel with a Git clone. Use **Export private backup** and **Import backup** to transfer records; backups contain private annotations and selected images. Browser imports accept up to 100 MB, merge absent records, and reject conflicts rather than overwriting existing histories. Keep the original source files alongside a backup. Changed or missing PDFs are flagged, and **Reattach old highlight** explicitly associates a new selection while preserving historical evidence.

Source uploads are exclusive and publish only after the upload completes. Use a different filename for a different paper; existing source files cannot be overwritten.

### Active-reading verification

Run `npm test` (or `npm.cmd test` in PowerShell). Tests cover persistence and rollback, revision conflicts, private-input isolation, citation validation, task cancellation, artifact publishing, historical passage links, image inputs, cross-page selection logic, and coordinate round trips using a real workspace PDF. AI tests use a mocked provider and do not spend subscription usage. Browser visual verification and a live subscription image request require an available browser and connected model.

## Troubleshooting

If sign-in is declined or expires, open the ChatGPT settings dialog and reconnect. If plan permission is missing, reconnect and approve direct plan usage. Ineligible subscriptions and usage limits cannot fall back to API-key billing; check the account or its [ChatGPT usage page](https://chatgpt.com/settings/usage).

Temporary OpenAI failures leave the saved registration intact so reconnection can be retried. A terminal refresh failure clears the active session and asks you to sign in again.

If port 3000 is in use, set another local port:

    $env:PORT = 3001
    npm.cmd start

## License

See [LICENSE](LICENSE).
