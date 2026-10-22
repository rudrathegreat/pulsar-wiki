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
