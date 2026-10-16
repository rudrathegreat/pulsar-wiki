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

Open **Files** to preview source material without leaving PulsarWiki. PDFs use the local PDF.js viewer with page navigation, zoom, and fit-to-width controls. Reader pages, thumbnails, and passage locations count from 1 rather than using journal page labels.

## AI-assisted active reading

Open a PDF from **Files** to read continuous pages with selectable text, page thumbnails, rotation, paper search, and a collapsible reading panel. The **Reading library** icon opens passages and drafts across all papers.

The pointer becomes a highlighter over PDF pages. Select text and choose a manual colour: yellow, green, or pink. Blue is reserved for AI assistance and has no manual swatch; older manual blue selections display in yellow while retaining their saved data. The selection helper has four actions: **Add to wiki**, **Ask AI**, **Add note**, and **Connect to related knowledge**. Each action expands the same helper with its fields and results, including AI progress and wiki draft review. Click an existing PDF highlight or its sidebar card to reopen that highlight's menu without creating another highlight. The helper follows the app theme. **Add note** expands personal comments without a colour selector or PDF filename/page details; **Edit / comment** in the Reading library also lets you change manual colours and optional, comma-separated categories. Researcher colours do not assign scientific meaning. Use **Select region** and drag a rectangle around an equation, figure, or scanned passage. Add a transcription when needed; automatic OCR is not included.

Highlights use full opacity with multiply blending so black PDF text stays black. Nearby word rectangles join into continuous strokes along each line without bridging wide column gaps. **Highlights on/off**, next to **Rotate**, hides or restores existing marks and pauses or enables new highlighting. Saved passages and comments are retained when highlighting is off.

The right reading panel shows filters and highlight cards with their comments and a **Delete** action on each card. **Undo deletion** restores the last deleted highlight. Filter widths stay stable when **With researcher comments** changes the results. All highlights in the opened paper appear by default; opening a paper clears earlier filters. Filter by paper, colour (including **Blue · AI assistance**), category, researcher-comment presence, or text. The Reading library holds the other action buttons, collections, drafts, and backup tools. There, check individual passages to build an input selection across papers. Check individual comments or previous AI responses only when you want them included. Collections preserve passage order, theme labels, and collection notes, with a table for comparison. **Link** connects a passage to an existing wiki page or another highlight. Connected wiki pages display private reading backlinks.

**Ask AI** accepts a question or instructions about the selected passage, equation, method, assumptions, concepts, or evidence. It has no action or additional-wiki-page selector. Review the exact passages, optional nearby context, checked comments, and selected visual inputs in the expanded helper, then submit the request there. The answer appears in the same helper. Reading tasks have no filesystem-write or general source-reading tools. No whole-paper text is added to selection-based summaries. Image capability depends on the subscription model; if unsupported, turn off image input and enter a transcription. Requests can be stopped, inspected, or explicitly retried with their preserved inputs.

Completed reading assistance gives its source highlight the reserved blue colour and appears as an **AI-generated comment** alongside that passage's researcher comments. Existing saved responses use the same presentation. Responses covering several passages are labelled as shared responses. The original researcher colour is preserved in storage. Failed or unfinished requests and artifact drafts do not change passage colours. Reattaching a highlight leaves earlier explanations with their preserved original inputs in Assistance rather than attaching them to the new passage. **Send** submits the question and selected inputs directly; the selected inputs can be inspected in the form. **Ask AI** from the text-selection toolbar uses that particular new passage; use the Reading library for requests spanning several passages.

**Connect to related knowledge** first ranks wiki passages by matching concepts in the highlighted text, excluding bibliography and related-page lists. If no close wiki match exists, it automatically searches arXiv and NASA ADS with terms derived from that passage and filters results against their titles and abstracts. It sends no researcher comments or whole-paper text and makes no AI request. Choose **Connect this page** to retain a wiki relationship or **Save paper reference** to keep a paper citation with the highlight. External results remain abstract-only references. NASA ADS requires `NASA_ADS_API_TOKEN`; arXiv remains available without it. Visual regions need a transcription for this search.

**Search & discover** provides local ranked search over wiki pages, supported source text, highlights, and notes. External discovery sends the displayed, editable query to arXiv and NASA ADS. Results remain saved locally after previews expire. Abstract-only candidates are labelled accordingly and cannot establish verified full-text support. Select candidates for a researcher-initiated evidence comparison, or explicitly import a PDF. Existing automatic AI ingestion on upload/import is retained; it is the exception to the reader's explicit-AI rule.

**Add to wiki** offers one wiki-page selector, defaulting to the paper's published summary or its filename-based summary page when available. Choose another page if needed, then select **Add** to prepare the selected passage as an update to that page in the helper. The Reading library's **Create artifact** retains the full artifact-type and title controls. Draft editing, optional AI generation, preview, and reviewed publication remain in the helper. Concept updates show a line diff; publication updates the wiki page, index, and append-only log and rejects stale page versions.

Published artifacts contain selected source excerpts, page links, source hashes, explicitly included researcher comments, and provenance for included AI interpretations. Visual crops remain private; their source location and any transcription are retained. Other private comments are excluded. Later edits mark dependent drafts as outdated; regeneration is explicit. Revision-qualified passage links preserve original selections even after reattachment or deletion.

Reading records, snapshots, and visual selections are stored locally in ignored `.pulsarwiki/reading/`. They survive ChatGPT disconnects and account changes, but do not travel with a Git clone. Use **Export private backup** and **Import backup** to transfer records; backups contain private annotations and selected images. Browser imports accept up to 100 MB, merge absent records, and reject conflicts rather than overwriting existing histories. Keep the original source files alongside a backup. Changed or missing PDFs are flagged. Select a replacement passage, then use **Reattach to selection** on its existing card in the Reading library to associate it while preserving historical evidence.

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
