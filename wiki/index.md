# LLM Wiki Index

Welcome to the **Pulsar Astronomy Wiki**, a comprehensive knowledge base for pulsar science, observational tools, and relativistic physics.

Application navigation: each main tab and Sources subtab has its own URL, including `/#sources/references`, `/#sources/upload`, `/#chat`, `/#graph`, `/#notebooks`, and `/#handover`. Reload restores the selected tab; browser Back and Forward restore earlier views. Existing wiki page, document, reading passage and notebook links remain supported.

Application branding: the PulsarWiki logo appears at the top of the iconbar and adapts to dark and light themes.

Source review notifications: completed background source reviews show a custom notification throughout the application. Open the notification to read and approve the proposed wiki changes in its specific saved chat (`/#chat/<thread-id>`), or dismiss it. Separate reviews have separate notifications; unread reviews return after reconnecting or reloading while the server remains running.

Source added notifications: each successful paper import or file upload shows a dismissible notification. Click it to open that source in the AI-assisted reading workspace. Import progress preserves the selection count so successful imports no longer show a missing-element error beside the Sources title. The Import selected label and adjacent count appear as plain text without oval or circle outlines.

Live source updates: adding or importing a source automatically refreshes the saved-source grid and sidebar in connected browsers. Visible References refreshes while preserving unsaved edits. Reconnecting catches up with changes made while offline; bursts of file events are combined into one refresh.

Project compatibility: Open project checks the selected folder against the project template before opening it. Incompatible folders remain untouched and show "this project is not compatible. Please select a different project" in a popup; the current project stays selected. Use New project to generate a compatible template. See the [workspace guide](../README.md#research-workspaces) for required files and folders.

Wiki editing: select Edit to the left of Add page reference to notebook on any page to edit its Markdown. The editor uses the available panel width and height, keeping scrolling inside the source area and Save and Cancel visible. Long source lines wrap to the available width, and the line-number gutter leaves space for continuation rows so numbers stay aligned through typing, scrolling and resizing. Save applies the changes; Cancel restores the displayed page. Background file refreshes leave the editor open, and failed saves retain the draft.

Source authors: search results, paper details, related papers, and the References preview link author names to ORCID profiles when a valid ID is supplied by the paper metadata or found through an ADS or Crossref lookup. Missing or ambiguous matches remain plain text; imported IDs are retained in positional BibTeX `orcid` lists.

Application workspace guide: [Research workspaces](../README.md#research-workspaces). Choose a project folder with the system folder dialog (the modern Windows picker includes address-bar navigation and search); a loading animation appears while the project opens and its initial data loads. The full selected path stays visible in the title bar, and each workspace keeps its own sources, pages, chats and reading notes, and the folder stays selected for the session.

Notebook guide: [Research notebooks](../README.md#research-notebooks). New notebooks start with editable Title, Objective, Live notes, and Preliminary analysis sections, each with detailed guidance on research context, questions and methods, ongoing observations and decisions, or reproducible analysis and tentative findings.

Settings: add, replace or remove a NASA ADS API token for literature searches. Tokens are saved locally across workspaces and applied immediately; an existing server environment token remains the fallback. Paper searches default to sciX (formerly NASA ADS). Controls beneath the search bar offer Default (relevance), Most citations, Most recent and First author (A–Z) sorting, with refereed status, collection, publication year and minimum citation filters. Initial searches show only peer-reviewed publications with Default sorting. arXiv backup requires All publications, All collections, no minimum citations, and Default or Most recent sorting, because it cannot verify ADS metadata. Explicit source filters search only the selected provider.

After updating the application, restart its server and refresh the browser to load new settings endpoints. NASA ADS settings show a restart instruction if the running server does not support token saving.

Bibliography access: both the Wiki and Sources sidebars include a persistent `references.bib` shortcut below their file lists. Select it to open the current workspace's References preview and BibTeX editor. The BibTeX editor fills the available height beneath the Sources controls, keeping long files scrolling inside the editor. Long source lines wrap without changing the saved text; the line-number gutter expands each row to match its wrapped text, including after resizing and jumps to individual references.

References preview: papers start collapsed by default. Expand a paper to view its properties, or use Expand all. Select Edit beside a paper to open raw BibTeX, highlight its entry and scroll to it; unsaved edits are retained. Select a `file` field link to open that source in PulsarWiki's document reader, including the PDF reading tools for PDFs.

Bibliography recovery: when source metadata is incomplete, uploads, paper imports and opening References ask the connected AI to extract bibliographic fields from the original PDF (or supported text document). Available fields are saved even when extraction is partial, without overwriting existing metadata, citation keys or comments. The completion note remains only if extraction fails or returns no usable fields. Opening References retries earlier failures; successful extraction is reused during the server session. Sources in `raw/` stay unchanged.

PDF imports: server-side source extraction uses the bundled PDF.js standard fonts and character maps, including papers whose standard fonts are not embedded. Restart the server after updating to apply this fix.

AI-assisted reading workspace: white surfaces with borderless light grey (`#eee`) highlight cards in light mode; `#1c1c1c` surfaces with `#222` inputs and highlight cards in dark mode, with a transparent page number input and borderless sidebar inputs and Find in paper search bar. The filename, file details, back and download header is removed; the reading toolbar remains above the document. The toolbar omits the Record lag button.

Sources sidebar: opening Sources shows saved files from the current workspace. Select a file to open it in the reading space; PDFs open with AI-assisted reading tools. The source list stays visible while reading, with the current file marked and an Add sources action for finding or uploading more documents. Paper result cards show sciX citation counts beneath the authors; records without citation data show “Citations unavailable”.

Source tabs: Search online contains the literature search without the numbered introductory cards. Upload a file has its own adjacent tab, followed by Saved sources and References. References opens the workspace-root `references.bib` as a structured preview in file order. Each collapsible citation-key branch carries an entry-type badge and shows each property on its own row with a visible field name and value. Author and editor fields expand into numbered lists that flow horizontally and wrap; keywords appear as tags, and DOI/arXiv/URL values link to their destinations. Expand all and Collapse all control the hierarchy; search and type filtering retain branch state. The Preview/BibTeX toggle retains the original editable source with Save changes and Reload file actions; unsaved edits can be previewed without rewriting the file. Incomplete entries show a warning while complete entries remain readable. The inspector follows light and dark themes and adapts to narrow screens. Uploads and paper imports automatically append citations using available metadata; files without metadata receive a filename-based entry marked for completion. Opening References also adds entries for existing source files. Edits and comments are preserved, and stale saves are rejected to protect concurrent additions.

Paper search results automatically generate up to six AI topic keywords from each available abstract using the connected ChatGPT model. Keywords appear beneath the authors in place of category codes, with loading and unavailable states. Results remain usable during generation; repeated abstracts reuse keywords during the server session. The Sources view omits the Research workspace, Discover and AI keywords · abstract labels. Search result cards have no outer border, and their bottom-row action borders stay #333 in dark mode and #ccc in light mode.

Paper details: Show More opens a dedicated view with the full title, authors, journal, abstract and keywords. Abstracts render inline and display LaTeX equations, with horizontal scrolling for wide display equations. Import this paper sits beside Import selected and saves the open paper without requiring a checkbox selection. References and Cited in use the same paper cards, with nested paper navigation and Back to results. Citation links use NASA ADS (including DOI/arXiv lookup); each section shows up to 25 recent records and explains unavailable data.

Citation links continue loading when a displayed paper outlives the 30-minute search cache, using its matching ADS, DOI or arXiv identifiers to recover the lookup.

Online search input: no search icon or intent tag; the Search button sits beside the input box at the same height, with filter shortcuts below. In dark mode, the input box has a #222 background and no visible border until it transitions to #fff while the input is focused. The Search button border transitions from #333 to #fff on hover. In light mode, the input background is #eee with theme-aware text and a black focus border; the Search button border transitions from #ccc to #000 on hover. Paper card bottom-row actions have #ccc borders, and keyword tags have transparent backgrounds with #ccc borders in light mode.

Graph key: a borderless box with a light grey (`#eee`) background and black labels in light mode, or a dark grey (`#222`) background and white labels in dark mode.

Chat sidebar: the saved chats panel uses a white background in light mode, and the chat list fills the remaining height below the header with scrolling for longer lists.

Chat input: the bottom input area has a white background in light mode. In dark mode, the bottom area is `#111` and the chat input is `#222`.

Chat options: menus open to the right of the sidebar with a white background and `#ccc` outer border in light mode, a `#333` outer border in dark mode, and dividers between unboxed options. Options use a pointer cursor, eased hover shading to `#eee` in light mode or `#222` in dark mode, and hidden overflow.

Interface: wiki pages keep centered content with the scrollbar at the right edge, and the notebook reference action sits beside the borderless Wiki breadcrumb. Buttons share consistent hover timing; Close folder has padding and theme-aware text, and selected sidebar pages have no edge marker. Light mode uses white sidebar, icon bar, and wiki search backgrounds, light grey borders, and black text and hover accents.

Project handover: project details, searchable autocomplete selection of wiki pages, sources and research notebooks, draft review, then publication. Select all includes the full category without document-count caps. The form has no top stage bar, transparent cards, borderless inputs (#eee in light mode and #1c1c1c in dark mode for steps 1 and 2 and the step 3 draft editor), larger red regular-weight errors, and a central drafting animation. Back preserves inputs and edits.

## Pillar 1: Foundational Physics
- [[neutron-star]]: The ultra-dense physical nature of pulsars and the nuclear Equation of State.
- [[pulsar]]: An overview of the pulsar phenomenon and power sources.
- [[pulsar-magnetosphere]]: The physics of relativistic plasma and beam emission.
- [[magnetar]]: High-field neutron stars powered by magnetic decay.
- [[supernova-remnant]]: The birthplaces of pulsars and SNR-pulsar associations.

## Pillar 2: Taxonomy & Evolution
- [[radio-pulsar]]: The most common rotation-powered sources.
- [[millisecond-pulsar]]: Rapidly rotating, recycled clocks in the universe.
- [[binary-pulsar]]: Orbital dynamics and post-Keplerian relativistic tests.
- [[x-ray-pulsar]]: Accretion physics and the precursors to millisecond pulsars.
- [[gamma-ray-pulsar]]: High-energy emission from young and MSP sources.

## Pillar 3: Observational Methodology
- [[pulsar-timing]]: The core science of high-precision pulse measurement.
- [[pulsar-glitches]]: Sudden increases in pulsar rotation rate and probes of neutron-star interiors.
- [[astrometry]]: Precision measurements of position, motion, and parallax.
- [[polarimetry]]: Studying the emission geometry via Stokes parameters.
- [[shapiro-delay]]: Relativistic path delays used for mass determination.
- [[dispersion-measure]]: Probing the interstellar medium and distance estimation.
- [[pulsar-timing-array]]: Galaxy-scale detectors for gravitational waves.

## Pillar 4: Facilities & Infrastructure
- [[radio-telescope]]: The global infrastructure used for pulsar discovery.
- [[discovery-surveys]]: Systematic searches that build the pulsar population.
- [[meerkat]]: South Africa's premier array for high-cadence timing.
- [[tempo2]]: The international standard software for timing analysis.
- [[psrchive]]: The library for pulse profile analysis and calibration.
- [[radio-frequency-interference]]: Managing contamination in radio data.

## Pillar 5: Notable Objects & Data
- [[psr-j0740+6620]]: The record-breaking $2.14 M_{\\odot}$ neutron star.
- [[psr-j0437-4715]]: The brightest MSP and primary timing laboratory.
- [[vela-pulsar]]: A bright young pulsar and glitch laboratory.
- [[crab-pulsar]]: The multi-wavelength remnant of SN 1054.
- [[pulsar-catalog]]: A directory of physical parameters for known pulsars.

## Project Continuity
- Welcome screen: **New project** and **Open project** stay side by side with single-line labels (layout: `public/style.css`).
- Project creation: **New project** on the welcome screen creates a named subfolder in the selected parent folder, populates a clean research template, and opens it automatically; existing names are rejected without overwriting files. See README.md for the template contents. Restart the running Node server after backend changes so the welcome screen and project API use the same version.
- [[research-notebooks]]: Embedded JupyterLab for free-form local Python analyses, cited paper and wiki transfers, automatic local history, clean reruns, and on-request recall linked to historical cells; automatic local Python startup with a loading animation until the editor is ready, in a workspace without the extra file sidebar or action bar.
- [[project-handover]]: A project handover drafted from complete selected file text using backend instructions, displayed as Markdown for researcher review before publication, with aligned form spacing, larger labels and review controls, and simplified review and publication copy.
- [[active-reading]]: PDF reading without a separate Reading Library, with scroll-aware scheduling, bounded nearby-page caching, cancellable text extraction, software-canvas settings and local lag diagnostics, theme-aware highlight helpers that close when leaving the reader, notes and AI requests, wiki-first reference discovery, and automatic agent-written wiki notes with the paper page selected by default and created on Add when missing.

---
*Last updated: 2026-10-23*

- [[stac3719]]: Selected reading notes for stac3719.pdf, with quoted highlights and links to the original passages.
