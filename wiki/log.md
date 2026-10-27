# Change Log

All major updates to the wiki are recorded here.

| Date | Source | Description |
| :--- | :--- | :--- |
| 2026-04-27 | pulsars.md, pulsar-info.txt | Initial ingestion of pulsar fundamentals and catalog data. |
| 2026-04-27 | tempo2_manual.pdf | Ingested TEMPO2 manual and timing concepts. |
| 2026-04-27 | s41550-019-0880-2.pdf, stac3719.pdf | Ingested high-mass pulsar physics and MeerKAT timing results. |
| 2026-04-27 | Global Review | **Comprehensive Wiki Rewrite**: Expanded all existing pages with high-density scientific content. Created new pages for `pulsar-magnetosphere`, `binary-pulsar`, `pulsar-timing-array`, and `radio-telescope`. Reorganized the index into a five-pillar structural framework. |
| 2026-04-27 | psrchive.pdf, papers.txt | Ingested PSRCHIVE manual and research bibliography. Created `psrchive` page and expanded `gamma-ray-pulsar` and `radio-telescope` with Fermi LAT results and software pipeline details. |
| 2026-04-27 | Catalog & Bibliography Expansion | Created concept pages for `magnetar`, `supernova-remnant`, `radio-frequency-interference`, `astrometry`, and `polarimetry`. Created `discovery-surveys` page connecting pulsars to search programmes. Added individual profiles for `vela-pulsar` and `psr-j0437-4715`. |
- 2026-10-06: Created pulsar-glitches page covering glitch definition, detection, scientific significance, Vela, and open questions; updated wiki index.
| 2026-10-06 | Application UI | Updated rendered chat-link styling, saved-chat spacing and control sizing, and light-mode sidebar/icon-bar contrast. |
| 2026-10-06 | Application UI | Updated the ChatGPT settings window so all light-mode text and controls use black text. |
| 2026-10-06 | Application UI | Made all rendered AI chat links explicitly white with grey underlines in dark mode, matching the wiki-link treatment. |
| 2026-10-06 | Application UI | Fixed internal wiki links in streamed and saved chat responses so ordinary clicks open pages within PulsarWiki while modified clicks retain normal browser behaviour. |
| 2026-10-06 | Application UI | Made `wiki/index.md` the default page on a plain PulsarWiki launch while preserving direct wiki and source-file routes. |
| 2026-10-15 | Project Handover | Added a researcher-selected, AI-organised, review-gated project handover workflow; created the `project-handover` wiki page and updated the index. |
| 2026-10-15 | Application active reading / README.md | Added continuous PDF reading, coloured highlights, comments, region selections, collections, passage links, optional bounded AI assistance, local and external search, and reviewed reading artifacts; documented the workflow in `active-reading` and updated the index. |
| 2026-10-16 | Application active reading / README.md | Added a highlighter cursor and readable selection-toolbar labels; simplified the right panel to filters and passage comments; reset filters to show all highlights by default; displayed completed AI assistance in purple alongside its source passage comments; retained library controls and preserved input provenance; updated `active-reading` and the index. |
| 2026-10-16 | Application active reading / README.md | Reserved blue within the four-colour palette for AI assistance; added the four selection actions and wiki-first related-knowledge lookup with arXiv/ADS fallback; removed the privacy badge; joined word rectangles into full-opacity, multiply-blended highlight strokes; added the toggle beside Rotate and sidebar deletion with undo; updated the reading guide and index. |
| 2026-10-16 | Application active reading / README.md | Expanded highlight actions, AI review/progress, connections, and wiki draft editing inside the existing helper; reopened the menu when saved PDF highlights or sidebar cards are clicked; simplified Ask AI to a question with optional context/images; removed the action selector, additional-wiki-page selector, and introductory destination text; added regression coverage and updated the reading guide and index. |
| 2026-10-16 | Application active reading / README.md | Made the highlight helper follow the app theme, removed its blue swatch and Add note colour/source details, changed Ask AI to direct Send, removed the Add to wiki introductory text, and displayed PDF page positions from 1 while preserving saved evidence and the existing artifact workflow; updated the reading guide and index. |
| 2026-10-16 | Application active reading / README.md | Simplified Add to wiki to one destination selector with the paper summary selected when available and an Add button; retained the library artifact workflow and reviewed updates; reserved scrollbar space so the comments filter does not shift controls; updated the reading guide and index. |
| 2026-10-16 | Application active reading / README.md | Optimised PDF opening with metadata-only inspection and on-demand page extraction; added serial viewport-prioritised rendering, cancellable text batches, offscreen resource cleanup with selection retention, bounded canvas allocation, and page layout containment; added reader regression coverage and updated the reading guide and index. |
| 2026-10-16 | Application active reading / README.md | Made Add to wiki retain the paper notes destination when missing, create its page and update the index/log only on Add, and continue into the reviewed passage draft; preserved existing pages and filename aliases, added regression coverage, and updated the reading guide and index. |
- 2026-10-16: Created paper reading-notes page stac3719; sources: stac3719.pdf.
| 2026-10-16 | Application active reading / GEMINI.md / README.md | Made Add to wiki generate and save cited notes automatically with explicit agent instructions, preserve existing and concurrent notes, create missing pages on successful generation, and update metadata/index/log atomically; replaced the Markdown review flow with progress and completion, retained library artifacts, and added failure, cancellation, retry, and API coverage. |
- 2026-10-16: Automatically added reading note to stac3719; operation: 9c2e1027-e9fe-48b3-aa9f-18be3709dc4a; sources: stac3719.pdf.
| 2026-10-17 | Application UI / README.md | Replaced the wiki search menu with grouped sidebar filtering by page name or contents; applied matching nodes and connecting links to the open all-pages graph, retained filters while browsing, added clear/Escape restoration and search status/error handling, and guarded against stale search responses. |
| 2026-10-17 | Application UI / README.md | Added graph hover highlighting: the hovered page, its directly linked incoming and outgoing neighbours, and its incident links remain bright while unrelated nodes, labels, and links dim; leaving the node restores brightness, including within a searched graph. |
| 2026-10-17 | Application active reading / README.md | Paused rendering during scrolling, updated viewport priority once per animation frame, prevented stale offscreen render restarts, cached completed nearby pages under page and pixel budgets with selection protection, made text extraction cancellable with canvas reuse, and serialised thumbnails behind full-size pages; added rapid-scroll, cache, cancellation, hidden-panel and zoom regressions and updated the reading guide and index. |
| 2026-10-17 | Application active reading / README.md | Investigated continuing desktop-wide pointer stalls with stac3719.pdf in Edge; local rendering of all 18 pages did not reproduce a multi-second drawing stall. Corrected first-context creation to preserve bundled PDF.js software-canvas settings, enabled offscreen content skipping and hid empty blend overlays, and added opt-in bounded local lag recording without document contents or network transmission. Added context-initialisation and diagnostic regressions; desktop responsiveness still requires live verification. |
| 2026-10-17 | Application active reading / README.md | Dismissed the highlight helper and cleared its pending selection whenever navigation switches panels, including leaving a paper with Back or the sidebar; updated the reading guide and index. |
| 2026-10-17 | Application workspaces / README.md | Added an editor-style welcome screen, local folder browsing and creation, recent workspaces, session restoration, and folder switching/closing. Scoped wiki, sources, chats, reading records, imports and file notifications to each workspace, preserved existing files and instructions, and added initialization, API isolation and session regression coverage. |

| 2026-10-17 | Application workspaces / README.md | Replaced the custom folder browser with the system folder dialog and a plain path input with an Open button. Made the full current folder path visible and selectable at all screen sizes, added Change folder, retained session restoration, and removed custom folder-listing and creation APIs. |

| 2026-10-18 | Application active reading / README.md | Removed the Reading Library sidebar entry, page, library controls and client handlers; redirected its old route to Files, preserved PDF highlights, comments, AI assistance, automatic wiki notes and existing local records, and updated the reading guide and index. |

| 2026-10-18 | Reading notes / README.md / GEMINI.md | Made appended notes concise and topic-focused, replaced visible passage IDs with filename/page links, removed technical provenance and AI/model declarations from published pages, retained retry tracking in the operation log, and cleaned the existing stac3719 notes. |

| 2026-10-18 | Selected reading notes / README.md / GEMINI.md | Added exact highlighted text as Markdown blockquotes with readable source links before each appended explanation; kept technical keys and model details out of paper pages and restored the quote in stac3719. |

| 2026-10-19 | Research notebooks / README.md / GEMINI.md | Added embedded JupyterLab with managed local Python, cited paper/wiki transfers, optional dataset fingerprints, immutable notebook revisions and checkpoints, separate clean reruns, export, and cancellable AI recall linked to historical cells; retained manual analysis and notebook-local results; added backend, client and live Jupyter/kernel coverage and updated workspace guidance and index. |

| 2026-10-19 | Research notebook startup / JupyterLab bridge | Removed the bridge activation wait on application restoration, which created a circular startup dependency and plugin activation warnings; rebuilt the shipped extension and added a regression test that requires activation to complete before restoration. |

| 2026-10-20 | Notebook workspace UI / README.md | Removed the PulsarWiki notebook file sidebar and filename/action bar, automatically started local Python when Notebooks opens, and added an accessible loading animation through JupyterLab bridge readiness with startup recovery and retry controls. Updated notebook guidance and index. |

| 2026-10-20 | Notebook creation / README.md | Added a shared barebones template with Title, Objective, Live notes, and Preliminary analysis Markdown cells to new notebooks created through JupyterLab and the notebook service. Preserved imported and existing contents, copies, and later edits; added creation and preservation regression coverage and updated the guide and index. |

| 2026-10-21 | Project opening / README.md | Added a themed loading animation while opening a folder and loading initial project data, including first-time opening; blocked background interaction, respected reduced-motion preferences, and cleared loading on failure with a visible error. Updated workspace guidance and index. |

| 2026-10-21 | Application interface / public | Padded Close folder and made its text white, moved wiki scrolling to the panel's right edge while retaining centered content, placed the notebook reference action beside the breadcrumb, removed the selected sidebar page edge marker, and shared button hover transitions using the existing 150 ms easing token. Updated the wiki index. |

| 2026-10-21 | Light-mode interface / public | Applied grey sidebar, icon bar and wiki search backgrounds with light grey borders, corrected light-mode button and Close folder text, replaced white sidebar and chat-link hover accents with theme-aware black accents, and matched native reading helper controls to light mode. Updated the wiki index. |

| 2026-10-21 | Light-mode sidebar / public | Changed the sidebar and wiki search backgrounds to white while keeping the icon bar grey. Updated the wiki index. |

| 2026-10-21 | Light-mode icon bar / public | Changed the icon bar background to white to match the sidebar and wiki search. Updated the wiki index. |

| 2026-10-21 | Wiki breadcrumb / public | Removed the border around the Wiki breadcrumb button while preserving navigation and keyboard focus styling. Updated the wiki index. |

| 2026-10-21 | Graph key / public | Set the graph legend background to #eee, removed its border, and used black labels for contrast. Updated the wiki index. |

| 2026-10-21 | Dark-mode graph key / public | Set the graph key background to #222 with white labels in dark mode, retaining its borderless appearance and light-mode styling. Updated the wiki index. |

| 2026-10-21 | Chat sidebar / public | Set the saved chats sidebar background to white in light mode. Updated the wiki index. |

| 2026-10-21 | Chat list height / public | Made the saved chat list fill the sidebar below its fixed-height header and scroll when needed, preserving chat row heights. Updated the wiki index. |

| 2026-10-21 | Chat options menu / public | Set the chat options menu background to white in light mode, removed its outer border and individual option boxes, and added dividers between options. Updated the wiki index. |

| 2026-10-21 | Chat options border / public | Restored the chat options menu outer border as 1px solid #ccc, retaining dividers between unboxed options. Updated the wiki index. |

| 2026-10-21 | Chat options positioning and hover / public | Positioned menus outside the sidebar on its right, kept them within the viewport height, and closed them on list scroll or window resize. Added a pointer cursor and visible hover shading using the shared easing transition and reduced-motion preference. Updated the wiki index. |

| 2026-10-21 | Chat option hover and overflow / public | Set menu option hover backgrounds to #eee and overflow to hidden on each option button, retaining the shared easing animation. Updated the wiki index. |

| 2026-10-21 | Chat input area / public | Set the bottom chat input bar background to white in light mode. Updated the wiki index. |

| 2026-10-21 | Dark-mode chat input / public | Set the bottom input area to #111 and the chat input and its wrapper to #222 using dark-mode-only rules. Preserved light-mode styling and updated the wiki index. |

| 2026-10-21 | Dark-mode chat menu / public | Set chat menu option hover backgrounds to #222 and the menu outer border to #333 in dark mode, preserving easing and light-mode styling. Updated the wiki index. |

| 2026-10-21 | Reading workspace appearance / public | Set reading workspace surfaces to white with readable text in either app theme, made right-hand highlight cards borderless with #eee backgrounds, and set file title, size and type text to regular weight. Updated the wiki index. |

| 2026-10-21 | Reading toolbar / public | Removed the Record lag button and its recording/download event handler. Updated the wiki index. |

| 2026-10-21 | Dark-mode reading workspace / public | Set reading workspace and helper surfaces to #222, inputs and borderless highlight cards to #333, and text to white in dark mode. Preserved light-mode styling and updated the wiki index. |

| 2026-10-21 | Reading background adjustment / public | Changed dark-mode reading workspace and helper backgrounds to #1c1c1c, retaining #333 inputs and highlight cards. Updated the wiki index. |

| 2026-10-21 | Reading input and card colours / public | Set dark-mode reading inputs and highlight cards to #222, with #111 for the page number input. Updated the wiki index. |

| 2026-10-21 | Dark-mode reading input borders / public | Made the page number input transparent and removed borders from right-hand reading sidebar inputs and the Find in paper search bar, only in dark mode. Updated the wiki index. |

| 2026-10-21 | Sources sidebar / public | Added a saved-source sidebar for Sources and document views, wired file selection to the existing AI-assisted PDF reader and text previews, marked the current document, and included loading, empty and failure messages plus an Add sources action. Saved files refresh after uploads and imports. Updated the wiki index. |

| 2026-10-21 | Reading header / public | Removed the top document header containing the filename, file icon, size, type, back and download controls, along with its unused handlers and styles. Kept the reading toolbar and saved-source sidebar. Updated the wiki index. |

| 2026-10-21 | Source tabs / public | Renamed the Add sources tab to Search online, removed the numbered cards beneath the search bar, and moved the upload action into an adjacent Upload a file tab. Updated the wiki index. |

| 2026-10-21 | Search input / public | Removed the search icon and Smart search intent tag, moved the Search button outside the input box, and retained form submission and filter suggestions. Updated the wiki index. |

| 2026-10-21 | Search bar styling / public | Set the search bar background to #222 and border to #333, transitioning to #fff only while its input is focused. Matched the Search button to the input box height and kept input text white for contrast. Updated the wiki index. |

| 2026-10-21 | Search border states / public | Hid the search input border until focus and set the Search button border to #333 with a transition to #fff on hover. Preserved matching control heights and updated the wiki index. |

| 2026-10-21 | NASA ADS settings / application | Added a masked NASA ADS API token input with save and remove actions in Settings, local persistence shared across workspaces, immediate search updates and environment-token fallback. Updated the wiki index. |

| 2026-10-21 | NASA ADS saving diagnosis / application | Identified an older running server without the ADS settings endpoint. Added a clear restart instruction for missing or workspace-gated settings routes and a regression check. Updated the wiki index. |
- 2026-10-21: Automatically added reading note to stac3719; operation: b2bafbb5-3718-4b26-b498-6b42986c53ad; sources: stac3719.pdf.

| 2026-10-21 | Paper search keywords / application | Added automatic AI topic keywords from abstracts beneath paper authors in place of category codes. Uses the connected ChatGPT model, background requests with three workers, session caching and duplicate-request sharing, abstract labels and loading/unavailable states. Added regression coverage and updated the wiki index. |

| 2026-10-21 | Source card appearance / public | Removed the Research workspace, Discover and AI keywords · abstract labels from Sources. Removed search result card outer borders and set bottom-row action borders to #333, including hover. Updated keyword rendering coverage and the wiki index. |

| 2026-10-22 | Project handover / public | Split the handover into separate Select, Generate, Review and Publish stages with Back and Next navigation, retained form state, validation, and review-gated publication. Updated the wiki index. |

| 2026-10-22 | Project handover stages / application | Separated project details from evidence selection, removed the standalone generation stage, and made Next generate the draft before opening review. Added selection and bounded saved-cell evidence for research notebooks, project descriptions, and reuse of unchanged drafts. Updated the wiki index. |

| 2026-10-22 | Handover appearance and selection / application | Removed the top stage bar and helper copy, made cards transparent and inputs borderless with #1c1c1c backgrounds, enlarged errors in regular red text, replaced material lists with autocomplete inputs and removable selections, renamed research materials to Sources, styled Select all like Next, removed selection-count limits, and added a central drafting spinner. Updated the wiki index. |

| 2026-10-22 | Project handover backend / application | Rebuilt generation as a dedicated service that reads complete selected source, wiki and saved notebook text before inference, uses backend-owned drafting instructions with no model tools, rejects unreadable and oversized evidence, and opens Markdown preview for review. Added service and review regression coverage and updated the handover page and wiki index. |
- 2026-10-22: Published the researcher-reviewed Project Handover guide and updated the wiki index.

| 2026-10-22 | Project handover labels / public | Removed the Research continuity, Project details, Source set and Review workspace labels from the handover interface. Updated the wiki index. |

| 2026-10-22 | Project handover spacing and controls / public | Aligned form cards with the header and navigation, enlarged field labels and review text, padded the guide and draft-view buttons, removed the draft-tab wrapper border, increased preview padding, hid Back on step 1, and removed review helper and draft-ready copy. Updated the wiki index. |

| 2026-10-22 | Handover publication labels / public | Removed Ready to share and the Publishes as filename label from the publication step. Updated the wiki index. |

| 2026-10-22 | Iconbar branding / public | Added the supplied PulsarWiki SVG logo above the iconbar controls, preserving its proportions and inverting it for light mode. Updated the wiki index. |

| 2026-10-22 | Handover light-mode inputs / public | Set step 1 and 2 input backgrounds and the step 3 draft editor to #eee in light mode, with theme-aware text for readability. Updated the wiki index. |

| 2026-10-22 | Paper search light-mode styling / public | Set paper card action borders and transparent keyword tag borders to #ccc in light mode. Set the search input background to #eee with readable text and a black focus border, and the Search button border to #ccc transitioning to #000 on hover. Updated the wiki index. |

| 2026-10-22 | Paper detail pages / application | Replaced inline previews with a dedicated metadata view and matching paper cards under References and Cited in. Added nested navigation, related-paper selection and keyword generation, ADS identifier lookup, unavailable/error states and stale-response protection. Updated the wiki index. |
`n| 2026-10-23 | Direct paper import / application | Added Import this paper beside Import selected in paper details, using the open paper independently of checkbox selections. Shared import progress, prevented concurrent imports, and disabled direct import when no open PDF is available. Updated the wiki index. |

| 2026-10-23 | Research notebook guidance / application | Expanded the descriptions beneath Title, Objective, Live notes, and Preliminary analysis in the shared Jupyter notebook template. Updated documentation and existing template checks; existing notebooks retain their contents. |

| 2026-10-23 | Default paper search provider / application | Made sciX (formerly NASA ADS) the default results provider, with arXiv as backup for missing credentials, failures or no matches. Preserved explicit provider filters and added source:scix as an alias. Added provider selection and fallback checks; updated documentation and wiki index. |

| 2026-10-23 | Citation counts in paper results / application | Displayed citation counts beneath authors on search and related-paper cards, including zero citations and an explicit unavailable label for records without citation data. Updated the wiki index and checked card rendering. |

| 2026-10-23 | Paper search filters and sorting / application | Added controls at the top of search results for citation count, recency, first author and default relevance sorting, plus refereed status, collection, publication year and minimum citations. Defaulted to refereed publications, applied ADS options before limiting results, explained unsupported arXiv fallbacks, and prevented stale search responses. Updated the wiki index and search guide. |

| 2026-10-23 | Expired paper citation lookup / application | Fixed related-paper requests returning 400 after the search cache expires. Paper details now supply citation identifiers, checked against the paper ID, so References and Cited in can recover without repeating the search. Added expiry, lost-cache and client request regression coverage; updated the wiki index. |

| 2026-10-23 | Workspace bibliography / application | Added a References tab with an editable workspace-root references.bib file. Uploads and search/reading imports append BibTeX citations, with metadata where available and filename placeholders otherwise. Existing sources are included on opening References; duplicate files, citation key collisions, unsaved edits and concurrent saves are handled. Added bibliography, editor and workspace API checks; updated the wiki index. |

| 2026-10-23 | References interface copy / public | Removed the introductory helper text, successful-load message and BibTeX file label from the References editor, retaining an accessible editor name. Updated the wiki index. |

| 2026-10-23 | Visual bibliography / application | Made References open as a searchable library grouped by year, with paper cards, type and keyword tags, publication metadata, identifier links and expandable properties. Added a Library/BibTeX toggle that previews unsaved edits while preserving source text and existing save/conflict handling. Added a read-only BibTeX parser with nested values, macros, comments, escaped text and malformed-entry warnings, responsive theme-aware styling, and parser/client regression checks. Updated the wiki index. |

| 2026-10-23 | Structured BibTeX preview / application | Replaced year-grouped bibliography cards with a file-order inspector: collapsible citation keys and type badges, indented property rows, nested numbered author/editor lists, keyword tags and linked identifier values. Added Expand all and Collapse all and preserved fold state while filtering. Retained source editing and save protections; updated structure, order and fold-state regression checks and the wiki index. |

| 2026-10-23 | AI bibliography recovery / application | Added direct PDF attachment and supported text-document extraction through the connected AI before creating fallback bibliography entries. Imports and References recover missing fields, preserve partial results and concurrent manual edits, and retry unsuccessful placeholders. Added extraction, validation, fallback and bibliography preservation regression checks; updated the wiki index. |
- 2026-10-23: Published the researcher-reviewed Project Handover guide and updated the wiki index.

| 2026-10-24 | Bibliography sidebar shortcuts / public | Added persistent references.bib shortcuts to the Wiki and Sources sidebars, opening the current workspace's existing References preview and BibTeX editor. Updated the wiki index. |

| 2026-10-24 | Compact bibliography preview / public | Arranged reference properties in responsive horizontal columns and author/editor names in wrapping horizontal lists. Kept titles and longer notes full width, preserved field order and collapse controls, and updated the wiki index. Verified all 12 bibliography parser and reference tests. |

| 2026-10-24 | Reference source links / public | Linked file fields in the References preview to the workspace document reader, including PDF reading tools. Preserved modified clicks and escaped filenames, left unsupported paths as text, and added navigation regression coverage. Updated the wiki index. |

| 2026-10-24 | References preview property rows / public | Placed each reference property on its own full-width row while preserving horizontal, wrapping author and editor lists. Updated the wiki index. |

| 2026-10-24 | Sources abstract equations / public | Applied the existing KaTeX renderer whenever paper details open, preserving escaped abstract text and supporting inline and display LaTeX delimiters. Added scrolling for wide display equations and navigation regression coverage; updated the wiki index. |

| 2026-10-24 | Collapsed references preview / public | Made papers start collapsed when References opens or reloads, preserving manual expansion through filtering and the Expand all and Collapse all controls. Updated the wiki index and existing preview checks. |

| 2026-10-24 | Author ORCID profiles / application | Linked author names in search results, full paper details, related papers, and existing References when valid ORCID IDs are available. Added cached, bounded background lookups using ADS paper identifiers or exact titles and Crossref DOIs, conservative author-name matching, checksum validation, and positional IDs in imported BibTeX. Added regression coverage for provider metadata, lookup failures, ambiguous matches, import retention, and browser links; updated the wiki index. |

| 2026-10-24 | Edit individual references / public | Added Edit beside each reference to open raw BibTeX, select the exact entry and scroll to it. Preserved unsaved text and used parser source locations so filtering, duplicate citation keys and comments do not affect navigation. Raw source uses horizontal scrolling for long lines. Added navigation regression coverage and updated the wiki index. |

| 2026-10-24 | Tab URLs / application | Added URLs for main tabs and all Sources subtabs, including References and Upload. Unified startup and browser history routing, made explicit view hashes take priority over older wiki pathnames, preserved wiki/document/reading/notebook links, and added reload, Back/Forward and legacy-link regression coverage. Updated the wiki index. |
| 2026-10-24 | Wiki page editing / public | Added Edit immediately before Add page reference to notebook on every wiki page, with a Markdown editor, Save and Cancel controls, retained drafts after save failures, and protection from background refreshes. Updated the wiki index. |
| 2026-10-25 | Wiki editor line numbers / public | Added a theme-aware left-hand line-number gutter that updates with edits and follows vertical scrolling. Long Markdown lines scroll horizontally to keep source lines aligned with their numbers. Updated the wiki index. |
| 2026-10-25 | BibTeX editor line numbers / public | Added the same theme-aware line-number gutter to the references.bib source editor, synchronised with edits, loading, saving, scrolling and jumps to individual references. Updated the wiki index and existing reference client checks. |
| 2026-10-25 | BibTeX viewer height / public | Made the source editor fill the available space beneath the Sources controls with internal scrolling and a small bottom margin. Removed the fixed viewport height and manual resize that could create page overflow. Updated the wiki index; all 12 references tests pass. |
| 2026-10-25 | Wiki editor dimensions / public | Expanded page editing to the available panel width and height with smaller responsive margins. Kept source scrolling inside the editor and Save and Cancel below it; removed the fixed viewport height and manual resize. Updated the wiki index. |
| 2026-10-25 | Source editor line wrapping / public | Enabled soft wrapping in both wiki Markdown and references.bib editors. Shared browser layout measurements expand gutter rows to match wrapped lines, update after edits and resizing, and keep reference jumps aligned without changing source newlines. Added regression coverage for gutter spacing, blank lines, reflow and reference navigation; updated the wiki index. |
| 2026-10-25 | Modern Windows project picker / application | Replaced the legacy folder tree with the Windows Common Item Dialog in folder-selection mode, preserving initial-folder navigation, cancellation, Unicode paths and hidden helper execution. Updated the wiki index. Picker and backend workspace checks pass; four existing frontend workspace checks still expect removed path-entry controls. |

| 2026-10-25 | New project / application | Added New project to the left of Open project, with project name, parent path and native Browse, Create and Cancel controls. Creation validates names and the parent, refuses existing paths, populates a clean research template (instructions, wiki index/log, sources, notebooks, private data, empty bibliography and ignore rules), opens the project, and remembers it in recents. Updated README and wiki index; added backend/API/client regression coverage and aligned older workspace client checks with the current native Open project flow. All 19 workspace/picker checks pass; full suite: 287 passed, one skipped, one existing palette failure for #333. |

| 2026-10-25 | New project server restart / application | Reproduced the workspace-required creation error against the old server on port 3000: it was running before the create endpoint was added while serving the updated client. Restarted that server with current code, verified live creation returns 201 and the created wiki opens with 200, and made API regression coverage explicitly use the welcome screen closed-workspace header. All 19 workspace/picker tests pass. Updated the wiki index with the restart requirement. |
| 2026-10-25 | Welcome button layout / public | Kept New project and Open project in one horizontal row, prevented button labels from wrapping or shrinking, and reserved enough space in the Start column. Updated the wiki index. |
| 2026-10-26 | Project compatibility / application | Added template validation before opening folders, including recent and cached projects. Incompatible folders remain untouched and show the requested popup while retaining the current selection. Private runtime data may be recreated when absent. Updated README and wiki index, with structure, API and popup regression coverage. |
| 2026-10-26 | Source review notifications / application | Added persistent custom in-app notifications for completed background source reviews, with direct links to the specific saved approval chat, dismissal, duplicate suppression, workspace isolation and reconnect replay. Added saved-chat routes and notification regression coverage. |
| 2026-10-26 | PDF import fonts / application | Configured the server-side source extractor to use bundled PDF.js standard fonts and character maps, resolving the missing standardFontDataUrl warning during imports. Release PDF resources after extraction. Added a regression PDF using unembedded Helvetica that reproduces the exact warning before the fix and checks extraction, caching and source preservation. Updated the wiki index. |
| 2026-10-26 | Live source updates / application | Refresh saved sources and the visible References view on workspace file events and WebSocket connection, alongside the existing wiki refresh. Watch references.bib as well as raw and wiki files. Combine event bursts and retain refreshes requested during ongoing loads; isolate request failures. Added regression coverage for live additions, removals, reconnect catch-up and wiki request failures. Updated the wiki index. |
| 2026-10-26 | Source import feedback / application | Preserve the selected-count span when updating import progress, fixing the client-only null textContent error shown beside Sources after a successful import. Add a dismissible Source added notification for each imported or uploaded file, linking directly to its AI-assisted reading workspace. Added regression coverage for repeated imports, partial failures, notification links and dismissal; updated the wiki index. |
| 2026-10-26 | Import selected styling / public | Removed the rounded span borders around the Import selected label and its adjacent count. Both inherit the button typography, with spacing retained before the count. Updated the wiki index. |
| 2026-10-26 | Online search filter styling / public | Removed borders from the filter shortcuts, sorting and filter dropdowns, and year and citation inputs in both themes. Updated the wiki index. |
| 2026-10-26 | Keyword filter shortcut borders / public | Restored dashed borders on the keyword search shortcuts while retaining borderless sorting dropdowns and filter inputs. Updated the wiki index. |
| 2026-10-26 | Notification appearance / public | Made source notifications white with dark text in both themes. Clip hover backgrounds to the outer rounded border to remove corner gaps, and keep dismiss and keyboard focus controls readable. Updated the wiki index. |
| 2026-10-26 | Notification corner and hover design / public | Removed the outer card shadow clipped by the rectangular scrolling stack, made the stack explicitly transparent, and kept the white fill clipped inside the rounded card border. Hover changes only the card border to black, without changing the background. Updated the wiki index. |
| 2026-10-26 | Custom source filter menus / public | Replaced browser-rendered option lists for sorting, publication status and collection with custom theme-aware popover menus, selected checkmarks, hover and keyboard navigation. Retained the existing form values and automatic search updates. Updated the wiki index. |

| 2026-10-27 | Downloaded source search results / application | Mark saved papers in search and related results, disable their import controls, and reject duplicate imports using saved filenames and citation metadata. Updated the wiki index. |

| 2026-10-27 | Downloaded papers filter / application | Added a local search-results filter to hide already downloaded papers, with an accurate visible count and an empty-state message. Updated the wiki index. |

| 2026-10-27 | Publication year filter / application | Removed the extended publication year input while retaining the year: search shortcut. Updated the wiki index and workspace guide. |

| 2026-10-27 | Upload button spacing / public | Added top margin to the upload button in the Sources upload tab. Updated the wiki index. |

| 2026-10-27 | Saved sources title spacing / public | Added top margin above the Saved sources sidebar title. Updated the wiki index. |

| 2026-10-27 | Downloaded papers default / public | Defaulted source search to hide already downloaded papers while retaining the option to show all papers. Updated the wiki index. |

| 2026-10-27 | Search filter menu styling / public | Matched search filter popovers to the chat sidebar menu with compact separated rows, borders and theme-aware hover colours. Updated the wiki index. |
