# LLM Wiki Index

Welcome to the **Pulsar Astronomy Wiki**, a comprehensive knowledge base for pulsar science, observational tools, and relativistic physics.

File navigation: source citations and source lists open saved files in the reading workspace; wiki page references in pages and chat link to their pages and share the same link styling, including pulsar names containing plus signs and standalone references formatted as inline code.

Related knowledge: connection previews show concise AI-generated wiki page summaries with spacing below their titles, render Markdown and use wiki link styling for their titles.
Saved wiki connections in the reading sidebar share the link styling used in chat and wiki pages. [Reading interface](../public/reading.js)

Browser tab: PulsarWiki uses its favicon as the tab icon.

Sidebar navigation: hover or focus an icon to see a shadow-free tooltip explaining what it opens or changes.

The workspace top bar shows the full folder path on the right. The File, Edit, Selection, Go, and Help menus open with a 6 px gap below the bar. The File menu creates wiki files and chats, adds or uploads sources, opens saved items and projects, and exports the active project as a ZIP. The ZIP includes the wiki, sources, notebooks, references, instructions, and saved workspace data such as chats and reading notes. [Workspace File menu](../public/index.html) [Top bar layout](../public/style.css) [Project export](../agent/workspace-export.js)

The Edit menu lists Undo, Redo, Cut, Copy, Paste, Find, and Replace with platform-specific shortcuts. Find opens below the top bar, centred horizontally, and searches saved source files, wiki pages, and Jupyter notebooks as you type. It suggests completions and shows each result with a linked name, location details to its right, and a grey-highlighted excerpt. Markdown excerpts render with formatting and links. Source results use their display names. Select **Go to location** to open the matched passage or notebook cell. Find runs locally without AI. Replace edits the active text field. [Workspace Edit menu](../public/index.html) [Workspace search](../agent/workspace-search.js)

Find skips **Sources** fields, inline source links, and saved source filenames mentioned in wiki text when matching keywords and suggesting completions. [Workspace search](../agent/workspace-search.js)

The Help menu opens the published [[project-handover|Project Handover]] wiki page and includes a disabled PulsarWiki Docs button. [Workspace Help menu](../public/index.html)

Settings updates appear in a dismissible notification that follows the active theme, names the new settings, and links to Settings. To announce a future addition, give its heading or label a unique `data-settings-update` value. [Settings markup](../public/index.html)

Saving a different ChatGPT subscription model shows a Settings updated notification with the saved model name. [Model save flow](../public/app.js)

Saved chats: new chats receive an AI-generated title after the first completed exchange, and can still be renamed.

Saved sources: select multiple documents in the Saved sources view and delete them together; selection keeps the document card details and styling in place with larger checkboxes.

Source navigation: the wiki sidebar's Add sources button opens the Sources page. Source rename and delete actions use in-app dialogs with theme-specific colours and accessible input focus.

Paper discovery: searches use one keyword, sciX review, or AI-ranked research-question route; filter and sort changes retain the question route.

Ask AI paper citations and reference links open the paper details in Sources, where an available open arXiv PDF can be imported. [Sources interface](../public/app.js)

Sources cancels outstanding paper and author lookups when a new search replaces the view. SciX searches retry temporary failures once with a longer timeout. [Sources interface](../public/app.js) [Literature search](../agent/source-discovery.js)

Markdown tables share the chat style and scroll horizontally when needed; the change log displays its historical entries in a single table.

Reading assistance: The Ask AI answer box shows progress messages on the left and the same closely spaced animated dots as chat on the right. The Stop request button appears below the answer box while the request runs. A concise explanation with citations to selected passages then appears in the same box, with completion status below it. The question and answer appear in closely spaced borderless boxes. Highlight colours appear as individual swatches; assisted highlights show blue as their selected colour and disable other colour choices. Saved responses show the user question, can be expanded from a five-line preview, and can start a new chat with the selected passages and response. [Reading interface](../public/reading.js)

Agent guidance: [GEMINI.md](../GEMINI.md) requires clickable file references in chat and wiki content, including linked source citations.

Ask AI searches the current wiki first. If the wiki answer is incomplete or unavailable, Ask AI searches sciX/NASA ADS for peer-reviewed journal articles that address the missing information. It combines supported wiki and paper findings in one answer with wiki links, linked MNRAS-style paper citations, and a reference list. If ADS cannot fill a gap, Ask AI keeps the supported wiki findings and names the unresolved details. The online search requires an ADS token. [Reading assistance](../agent/reading-service.js)

Ask AI retries an unusable literature search plan and can search ADS using keywords from the typed question. [Literature search](../agent/reading-service.js)

Ask AI retries temporary NASA ADS connection and server failures once. Messages identify access denial, rate limits, rejected queries, connection failures, and unreadable replies. [Literature search](../agent/source-discovery.js) [Ask AI errors](../agent/reading-service.js)

Ask AI uses the highlight to identify the subject of the question and looks for sources that directly answer it. For a highlighted pulsar’s properties, it prioritises supported measurements and searches the literature by designation when the wiki only describes the pulsar’s uses. [Reading assistance](../agent/reading-service.js)

## Pillar 1: Foundational Physics
- [[neutron-star]]: The ultra-dense physical nature of pulsars and the nuclear Equation of State.
- [[pulsar]]: An overview of the pulsar phenomenon and power sources.
- [[pulsar-magnetosphere]]: The physics of relativistic plasma and beam emission.
- [[magnetar]]: High-field neutron stars powered by magnetic decay.
- [[supernova-remnant]]: The birthplaces of pulsars and SNR-pulsar associations.
- [[gravitational-radiation]]: Orbital-energy loss in compact binaries due to gravitational radiation, with PSR B1913+16 as an example.
- [[geodetic-spin-precession]]: Relativistic spin-axis precession inferred from changing pulsar profiles.

## Pillar 2: Taxonomy & Evolution
- [[radio-pulsar]]: The most common rotation-powered sources.
- [[millisecond-pulsar]]: Rapidly rotating, recycled clocks in the universe.
- [[binary-pulsar]]: Orbital dynamics and post-Keplerian relativistic tests.
- [[post-keplerian-parameters]]: Relativistic corrections to binary-pulsar timing models.
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
- [[psr-b1913-16]]: The Hulse–Taylor relativistic double-neutron-star binary.
- [[psr-j0740+6620]]: The record-breaking $2.14 M_{\\odot}$ neutron star.
- [[psr-j0437-4715]]: The brightest MSP and primary timing laboratory.
- [[vela-pulsar]]: A bright young pulsar and glitch laboratory.
- [[crab-pulsar]]: The multi-wavelength remnant of SN 1054.
- [[pulsar-catalog]]: A directory of physical parameters for known pulsars.

## Kinematics
- [[systemic-velocity]]: Center-of-mass motion of a pulsar binary inferred from astrometry and Galactic kinematics.

## Source summaries
- [[1011-0718]]: Timing Measurements of the Relativistic Binary Pulsar PSR B1913+16.

## Project Continuity
- Chat displays wiki activity in a full-width, theme-aware collapsible panel before the response, with an indicator while work is underway.
- [[research-notebooks]]: Embedded JupyterLab for free-form local Python analyses, cited paper and wiki transfers, automatic local history, clean reruns, and on-request recall linked to historical cells.
- [[project-handover]]: A project handover drafted from complete selected file text using backend instructions, displayed as Markdown for researcher review before publication.
- [[active-reading]]: PDF reading with highlight helpers, AI responses linked to selected passages, wiki notes, and reference discovery.

---
*Last updated: 2026-11-23*
