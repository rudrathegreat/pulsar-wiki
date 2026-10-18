# PulsarWiki

PulsarWiki is a local browser interface for source-backed research workspaces. Open any local folder for a separate project, or continue using the included pulsar astronomy wiki. Its chat uses an eligible ChatGPT subscription, while wiki files and saved conversations remain on the local machine.

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

## Research workspaces

On a new server session, the welcome screen shows a plain **Workspace folder** path field. Use **Browse** to select a folder in the system folder dialog, or enter its full path, then select **Open**. Recent folders can also be reopened directly. The native dialog supports creating a new folder; on Linux it requires Zenity, with manual path entry available if the dialog cannot open.

Each selected folder holds its own `wiki/`, immutable `raw/` sources, `.pulsarwiki/chat/` conversations, and `.pulsarwiki/reading/` annotations and drafts. Missing folders, `GEMINI.md`, and starter index/log pages are created without replacing existing content. A new workspace starts with general research instructions; existing projects retain their own instructions and sources. Existing source files should be placed in that project's `raw/` folder to appear in Files.

The selected folder is remembered throughout the running browser/server session, including refreshes, direct page links, and the ChatGPT sign-in round trip. Each tab pins its own workspace, so different projects can be open in separate tabs. Recent paths remain in this browser for reopening after a server restart. ChatGPT account settings are shared across projects.

Use **Change folder** in the title bar or the folder icon in the activity bar to switch projects with the system dialog. The title bar always shows the full active folder path, including on small screens; **Close folder** returns to the welcome screen. Switching reloads the interface to clear the previous project's document and search state. Save any draft edits before switching or closing; saved files and notes remain in their project folders.

The sidebar's **Search wiki** field filters pages by matching text in their names or contents, keeping the existing page groups. When the all-pages graph is open, it shows the same matching pages and only links between them. The filter stays active while browsing; clear the field or press Escape to restore all pages and graph nodes.

Hover over a graph node to keep that page, its directly linked pages (incoming or outgoing), and its connecting lines bright while dimming the rest. Move away to restore normal brightness; click a node to open its page.

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

Chats are stored in local application data at `.pulsarwiki/chat/` inside the selected workspace (ignored by Git in the included project). Each Responses API request uses `store: false`, streams its result, and resends the complete local conversation transcript. Saved chats remain available across ChatGPT disconnects and account changes.

The selected folder's `GEMINI.md` is loaded when that workspace first opens in a server session and becomes the canonical instruction snapshot for new chats. Restart the server after editing it to create chats using the new instruction version.

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

Open a PDF from **Files** to read continuous pages with selectable text, page thumbnails, rotation, paper search, and a collapsible reading panel.

PDF opening reads page metadata without extracting the entire paper. Passage validation extracts only the selected pages; paper search requests the full text when needed. Scrolling interrupts canvas drawing, streamed text extraction, and text-layer construction; new rendering waits for a 120 ms pause. The current viewport updates once per animation frame, and offscreen requests cannot restart because of an old page number. Completed nearby canvases and selectable text stay cached for direction changes, with eviction targets of five pages and 24 megapixels (about 96 MiB of canvas pixels); near pages and active text selections are protected even if those targets are exceeded. Older pages release their resources and rebuild when revisited. Interrupted text construction can reuse a completed canvas. Full-size pages and thumbnails share one rendering slot, with full-size pages taking priority. Text layers build in small batches that yield to input and painting. Canvas resolution has an 8-megapixel budget per page, and each page isolates its layout and painting from the rest of the reader.

The first drawing-context request uses `alpha: false` and `willReadFrequently: true`, matching the bundled PDF.js software-canvas default. Creating a context with browser defaults first prevents PDF.js from applying those settings later. Offscreen page contents can skip browser layout and painting, and empty highlight overlays stay hidden.

If scrolling still causes stalls, choose **Record lag**, reproduce the problem, then choose **Stop & save lag report**, or let the 30-second recording finish. The local `pulsarwiki-lag.json` file records frame gaps of at least 100 ms, long JavaScript tasks when supported, rendering phases, canvas sizes and context attributes, viewport state, browser version, and display pixel ratio. It excludes paper text, annotations, source filenames, page URLs, and screenshots, and sends nothing to a server. Recording is opt-in, retains at most 1,000 events, and excludes time spent in a hidden tab. These timings help narrow the cause; they do not identify a GPU driver or operating-system stall by themselves. Passing scheduling tests does not establish that desktop-wide pointer lag is resolved.

The pointer becomes a highlighter over PDF pages. Select text and choose a manual colour: yellow, green, or pink. Blue is reserved for AI assistance and has no manual swatch; older manual blue selections display in yellow while retaining their saved data. The selection helper has four actions: **Add to wiki**, **Ask AI**, **Add note**, and **Connect to related knowledge**. Each action expands the same helper with its fields and results, including AI progress and automatic wiki-note updates. Click an existing PDF highlight or its sidebar card to reopen that highlight's menu without creating another highlight. The helper follows the app theme and closes automatically when you leave the reader or switch panels. **Add note** expands personal comments without a colour selector or PDF filename/page details. Optional, comma-separated categories can be saved with notes. Researcher colours do not assign scientific meaning. Use **Select region** and drag a rectangle around an equation, figure, or scanned passage. Add a transcription when needed; automatic OCR is not included.

Highlights use full opacity with multiply blending so black PDF text stays black. Nearby word rectangles join into continuous strokes along each line without bridging wide column gaps. **Highlights on/off**, next to **Rotate**, hides or restores existing marks and pauses or enables new highlighting. Saved passages and comments are retained when highlighting is off.

The right reading panel shows filters and highlight cards with their comments and a **Delete** action on each card. **Undo deletion** restores the last deleted highlight. Filter widths stay stable when **With researcher comments** changes the results. All highlights in the opened paper appear by default; opening a paper clears earlier filters. Filter by paper, colour (including **Blue · AI assistance**), category, researcher-comment presence, or text. Connected wiki pages display private reading backlinks.

**Ask AI** accepts a question or instructions about the selected passage, equation, method, assumptions, concepts, or evidence. It has no action or additional-wiki-page selector. Review the exact passages, optional nearby context, checked comments, and selected visual inputs in the expanded helper, then submit the request there. The answer appears in the same helper. Reading tasks have no filesystem-write or general source-reading tools. No whole-paper text is added to selection-based summaries. Image capability depends on the subscription model; if unsupported, turn off image input and enter a transcription. Requests can be stopped, inspected, or explicitly retried with their preserved inputs.

Completed reading assistance gives its source highlight the reserved blue colour and appears as an **AI-generated comment** alongside that passage's researcher comments. Existing saved responses use the same presentation. Responses covering several passages are labelled as shared responses. The original researcher colour is preserved in storage. Failed or unfinished requests and artifact drafts do not change passage colours. Reattaching a highlight leaves earlier explanations with their preserved original inputs in local storage rather than attaching them to the new passage. **Send** submits the question and selected inputs directly; the selected inputs can be inspected in the form. **Ask AI** from the text-selection toolbar uses that particular new passage.

**Connect to related knowledge** first ranks wiki passages by matching concepts in the highlighted text, excluding bibliography and related-page lists. If no close wiki match exists, it automatically searches arXiv and NASA ADS with terms derived from that passage and filters results against their titles and abstracts. It sends no researcher comments or whole-paper text and makes no AI request. Choose **Connect this page** to retain a wiki relationship or **Save paper reference** to keep a paper citation with the highlight. External results remain abstract-only references. NASA ADS requires `NASA_ADS_API_TOKEN`; arXiv remains available without it. Visual regions need a transcription for this search.

Existing automatic AI ingestion on upload/import remains separate from the reader.

**Add to wiki** defaults to the paper's published summary or filename-based notes page, including a missing page labelled **create on Add**. Select **Add** to have the connected agent write and save the note automatically. The helper shows progress and a link to the updated page; there is no Markdown editor, diff, or review/publish step in this flow. The agent receives explicit instructions to write a concise note from the selected passages and explicitly included inputs, preserve meaning and uncertainty, cite the supplied passage references and source filenames, distinguish evidence from interpretation, and avoid unsupported claims. The application inserts the note into the latest page while preserving existing notes and citations, creates a missing page when generation succeeds, and updates sources, date, index and log together. Failed or stopped requests leave the wiki unchanged and can be retried. A connected model is required.

Reading notes append short, topic-focused sections with descriptive headings, short paragraphs or bullets, and readable filename/page links to the original selections. Each appended note includes the exact highlighted text as a Markdown blockquote with its source link, followed by a concise explanation. Selections without a transcription are labelled as visual regions. Published pages omit source hashes, internal IDs, AI-use declarations and model names. Reviewed artifacts also retain selected excerpts and explicitly included interpretations, with unsupported interpretations marked as needing verification. Technical history stays in private reading records. Visual crops remain private; their source location and any transcription are retained. Other private comments are excluded. Later edits mark dependent drafts as outdated; regeneration is explicit. Revision-qualified passage links preserve original selections even after reattachment or deletion.

Reading records, snapshots, and visual selections are stored locally in ignored `.pulsarwiki/reading/`. They survive ChatGPT disconnects and account changes, but do not travel with a Git clone. Keep the original source files and local reading data together. Earlier selections and notes remain stored when a PDF changes or is missing.

Source uploads are exclusive and publish only after the upload completes. Use a different filename for a different paper; existing source files cannot be overwritten.

### Active-reading verification

Run `npm test` (or `npm.cmd test` in PowerShell). Tests cover persistence and rollback, revision conflicts, private-input isolation, citation validation, task cancellation, artifact publishing, historical passage links, image inputs, cross-page selection logic, and coordinate round trips using a real workspace PDF. Reader regressions also cover rapid scrolling, stale-page cancellation, bounded viewport measurements, cached direction changes, page and pixel eviction budgets, selection retention, streamed extraction cancellation, canvas reuse, hidden panels, zoom invalidation, thumbnail scheduling, text batching, and on-demand PDF extraction. AI tests use a mocked provider and do not spend subscription usage. Browser visual verification and a live subscription image request require an available browser and connected model.

## Troubleshooting

If sign-in is declined or expires, open the ChatGPT settings dialog and reconnect. If plan permission is missing, reconnect and approve direct plan usage. Ineligible subscriptions and usage limits cannot fall back to API-key billing; check the account or its [ChatGPT usage page](https://chatgpt.com/settings/usage).

Temporary OpenAI failures leave the saved registration intact so reconnection can be retried. A terminal refresh failure clears the active session and asks you to sign in again.

If port 3000 is in use, set another local port:

    $env:PORT = 3001
    npm.cmd start

## License

See [LICENSE](LICENSE).
