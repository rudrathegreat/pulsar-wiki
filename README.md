# PulsarWiki

PulsarWiki is a local browser interface for source-backed research workspaces. Open any local folder for a separate project, or continue using the included pulsar astronomy wiki. Its chat uses an eligible ChatGPT subscription, while wiki files and saved conversations remain on the local machine.

## Requirements

- Node.js 20.19.0 or newer
- An eligible ChatGPT subscription
- Permission to grant PulsarWiki direct ChatGPT plan usage during sign-in

Research notebooks additionally need a local Python environment with JupyterLab 4, `ipykernel`, `nbformat`, and `nbclient`. Plotting and widget packages are optional. Notebook editing and execution do not require a ChatGPT connection; AI recall does.

ChatGPT subscription sharing is currently a preview feature. Eligibility, model availability, and usage limits are determined by the connected ChatGPT account and workspace.

## Install and run

    npm install
    npm start

In PowerShell environments where `npm.ps1` is disabled, use:

    npm.cmd install
    npm.cmd start

Open the displayed loopback address, normally <http://127.0.0.1:3000>. PulsarWiki is intentionally local-only and browser-based; do not expose it through a reverse proxy, LAN address, or the public internet.

## Research workspaces

On a new server session, choose **New project** or **Open project** from the welcome screen. **New project** asks for a project name and a parent folder, entered as a full path or selected with **Browse**. **Create project** creates a named subfolder, fills it with a clean research template, and opens it automatically. The template includes `wiki/` with starter index and log pages, empty `raw/` and `notebooks/` folders, private `.pulsarwiki/` data, `GEMINI.md`, `AGENTS.md`, `CLAUDE.md`, an empty `references.bib`, and `.gitignore`. Existing files or folders with the same name are never reused or overwritten. **Open project** selects an existing folder with the system dialog; recent folders can also be reopened directly. On Linux the native dialog requires Zenity.

Each selected folder holds its own `wiki/`, immutable `raw/` sources, `.pulsarwiki/chat/` conversations, and `.pulsarwiki/reading/` annotations and drafts. Open project requires the template's `wiki/`, `raw/`, and `notebooks/` folders, `wiki/index.md`, `wiki/log.md`, `GEMINI.md`, `AGENTS.md`, `CLAUDE.md`, `references.bib`, and `.gitignore` files. Incompatible folders remain untouched and show a popup: "this project is not compatible. Please select a different project". Private `.pulsarwiki/` data can be recreated when absent, including after cloning a project. A new workspace starts with general research instructions; existing projects retain their own instructions and sources. Existing source files should be placed in that project's `raw/` folder to appear in Files.

An animated loading screen appears while a project opens and its initial data loads, including the first opening of a new folder. It follows the current theme and respects reduced-motion preferences. If opening fails, the loading screen clears and the error is displayed.

The selected folder is remembered throughout the running browser/server session, including refreshes, direct page links, and the ChatGPT sign-in round trip. Each tab pins its own workspace, so different projects can be open in separate tabs. Recent paths remain in this browser for reopening after a server restart. ChatGPT account settings are shared across projects.

In **Settings**, paste your **NASA ADS API token** and choose **Save token** to enable ADS literature searches immediately. The token is stored on this computer in the application's Git-ignored `.pulsarwiki/source-settings.json` and shared across workspaces. **Remove saved token** deletes it; the server's `NASA_ADS_API_TOKEN`, if set, remains the fallback. Settings only returns whether a token is configured, and the saved token is never filled back into the browser input.

In **Settings**, paste your **NASA ADS API token** and choose **Save token** to enable ADS literature searches immediately. The token is stored on this computer in the application's Git-ignored `.pulsarwiki/source-settings.json` and shared across workspaces. **Remove saved token** deletes it; the server's `NASA_ADS_API_TOKEN`, if set, remains the fallback. Settings only returns whether a token is configured, and the saved token is never filled back into the browser input.

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

Paper searches use **sciX (formerly NASA ADS)** as the default results provider, using the NASA ADS token configured in Settings. Controls beneath the search bar offer Default (relevance), Most citations, Most recent, and First author (A–Z) sorting, plus publication status, collection (Astronomy, Physics, General), publication year, and minimum citations. Searches initially show only refereed (peer-reviewed) publications with Default sorting. Changing a control reruns the search, applying the options before the result limit.

**arXiv** is the backup when no token is configured, sciX fails, or sciX returns no matches, provided the selected options can be supported. To allow arXiv results, choose All publications, All collections, no minimum citations, and Default or Most recent sorting. arXiv cannot verify peer-review status, ADS collections, or citation counts, and its API does not support first-author sorting. An explicit `source:scix` (also `source:ads` or `source:nasa-ads`) or `source:arxiv` filter searches only that provider.

## Research notebooks

Open **Notebooks** in the activity bar to work in JupyterLab inside PulsarWiki. Local Python starts automatically when this space opens, using the workspace's saved interpreter (or `python` by default). A loading animation remains visible until JupyterLab has restored and connected its editor. The notebook space fills the available area without a separate PulsarWiki file sidebar or filename/action bar. Use JupyterLab's own file browser, launcher, and upload controls to create or open standard `.ipynb` notebooks. New notebooks automatically start with four editable Markdown cells: **Title**, **Objective**, **Live notes**, and **Preliminary analysis**, with detailed guidance below each heading covering research context, objectives and assumptions, dated working notes, and reproducible preliminary analysis. Add code cells wherever needed, or edit or remove any section. The template is applied only at creation; existing notebooks, uploads, copies, and later saves keep their contents. Write and run Python manually, interleave Markdown and LaTeX, and retain plots and visualisations with the notebook. JupyterLab supplies optional headings, table of contents, and collapsible cells.

The default interpreter needs the notebook dependencies installed. For example, create an isolated environment from the workspace root:

```powershell
python -m venv .pulsarwiki/python-env
.pulsarwiki/python-env/Scripts/python.exe -m pip install "jupyterlab>=4,<5" ipykernel nbformat nbclient matplotlib ipywidgets
```

If startup fails, the recovery panel offers retry and Python environment settings; enter that environment's full `python.exe` path there. On macOS/Linux, use the environment's `bin/python` instead. Scientific packages belong to this selected environment. The application starts one authenticated, loopback-only Jupyter process per workspace and embeds it on a separate browser origin. Its prebuilt bridge is included; no Jupyter extension installation or Node build is needed for normal use. Python runs with the local researcher's file permissions, rather than in a sandbox. The file browser starts in `notebooks/`; the application does not write to `raw/`.

Switching panels retains the editor and kernel. JupyterLab's Save command and autosave create history when content changes. Closing or switching workspace folders waits for notebook saves and then stops that workspace's runtime. A save conflict leaves the folder open. Stop an active clean rerun before closing its workspace. The recovery panel's **Stop** and **Reconnect** controls retain saved files and history; stopping Python discards its in-memory variables.

### Bringing research into a notebook

Choose **Add to notebook** on a paper highlight, or **Add page reference to notebook** on a wiki page. Choose a notebook or create one. Paper passages become exact quoted Markdown with revision-qualified source links; wiki references retain the page's captured content privately in cell metadata. Visual selections are included only when checked. Other researcher comments are excluded by default. Material goes after the editor's active cell for that notebook, or at its end when unopened. The editor is saved first; concurrent changes are rejected or left for Jupyter's conflict handling rather than overwritten. Source links return to the paper or wiki inside PulsarWiki.

The notebook service supports associating existing workspace files with the analysis. The notebook records the filename, size and SHA-256 fingerprint. Read local datasets from Python using paths such as `../raw/data.csv`; treat the source files as immutable. Plots and findings stay in the notebook. There is no notebook-to-wiki publishing workflow or separate result library.

### History and reproducibility

Editable notebooks live in `notebooks/`. Changed saves, named checkpoints, source associations, and restores create local revisions under `.pulsarwiki/notebooks/`. Historical notebook links open read-only snapshots with saved code, Markdown, text outputs and raster plots. Active HTML and JavaScript outputs are not executed in historical previews. Restoring creates a new revision, and historical cell links retain their original content even after cell deletion or notebook renaming. External notebook edits are captured when the workspace next scans notebooks. A notebook has a 25 MB limit.

Execution records retain the notebook revision, cell ID, execution count, timestamps, success/failure, associated source fingerprints, and the Python/package environment captured at runtime startup. The notebook service's clean rerun executes all cells in order in a fresh kernel and saves a separate notebook, including partial outputs if a cell fails. Its report lists unavailable or changed associated inputs and changed outputs. The current working notebook is preserved. Individual cells have a two-minute execution timeout in clean reruns, and the complete rerun has a ten-minute limit. A completed rerun does not establish scientific correctness or guarantee identical results.

The notebook service's export API downloads the current `.ipynb`, or a JSON bundle containing saved revisions, provenance and run/environment records. Associated source bytes are included only when explicitly checked; bundles have a 100 MB limit. Local history, Python settings and recall requests are ignored by Git in this project, so preserve `.pulsarwiki/notebooks/` with the workspace or export the notebook history when moving projects.

### Recall earlier work

The notebook service supports recall requests about earlier assumptions, exclusions, decisions, limitations or observations. Requests can search the current notebook or all notebooks in the active workspace, including historical cells. Only matching saved code, Markdown and text-output excerpts are sent through the existing ChatGPT connection. Recall records retain the exact evidence excerpts used. Responses must cite supplied evidence; unknown or missing references fail safely. Evidence links open the original read-only notebook revision and cell, with an option to return to the current notebook. No match produces a local answer without an AI request.

Recall distinguishes recorded statements from AI inference and reports insufficient evidence. It does not insert cells, run code, generate an analysis, or publish results. Requests can be cancelled and explicitly retried with their original preserved evidence; a server restart marks unfinished requests as interrupted. Notebook content is treated as evidence, never as instructions to the AI.

### Notebook development and verification

Run `npm test` for workspace, persistence, rollback, source transfer, citation, recall, client and API checks. To rebuild the shipped JupyterLab bridge after editing its source, run `npm run build:notebooks`; this installs build dependencies only under `integrations/jupyterlab/`.

To run the real local Jupyter/kernel integration test in PowerShell:

```powershell
$env:PULSARWIKI_TEST_PYTHON = 'C:\full\path\to\python.exe'
node --test test/notebooks-live.test.js
```

That environment needs `matplotlib` as well as the notebook requirements. The test verifies authentication, framing policy, private service credentials, versioned Jupyter saves, Python execution over WebSocket, and clean reruns with saved plots. It uses disposable workspaces and no AI subscription usage. Browser visual verification and a real AI recall request are separate manual checks.

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

**Connect to related knowledge** first ranks wiki passages by matching concepts in the highlighted text, excluding bibliography and related-page lists. If no close wiki match exists, it automatically searches arXiv and NASA ADS with terms derived from that passage and filters results against their titles and abstracts. It sends no researcher comments or whole-paper text and makes no AI request. Choose **Connect this page** to retain a wiki relationship or **Save paper reference** to keep a paper citation with the highlight. External results remain abstract-only references. NASA ADS requires a token saved in Settings or supplied through `NASA_ADS_API_TOKEN`; arXiv remains available without it. Visual regions need a transcription for this search.

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
