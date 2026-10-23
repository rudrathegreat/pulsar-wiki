# LLM Wiki Index

Welcome to the **Pulsar Astronomy Wiki**, a comprehensive knowledge base for pulsar science, observational tools, and relativistic physics.

Application branding: the PulsarWiki logo appears at the top of the iconbar and adapts to dark and light themes.

Application workspace guide: [Research workspaces](../README.md#research-workspaces). Choose a project folder with the system folder dialog or plain path field; a loading animation appears while the project opens and its initial data loads. The full selected path stays visible in the title bar, and each workspace keeps its own sources, pages, chats and reading notes, and the folder stays selected for the session.

Notebook guide: [Research notebooks](../README.md#research-notebooks). New notebooks start with editable Title, Objective, Live notes, and Preliminary analysis sections, each with detailed guidance on research context, questions and methods, ongoing observations and decisions, or reproducible analysis and tentative findings.

Settings: add, replace or remove a NASA ADS API token for literature searches. Tokens are saved locally across workspaces and applied immediately; an existing server environment token remains the fallback.

After updating the application, restart its server and refresh the browser to load new settings endpoints. NASA ADS settings show a restart instruction if the running server does not support token saving.

AI-assisted reading workspace: white surfaces with borderless light grey (`#eee`) highlight cards in light mode; `#1c1c1c` surfaces with `#222` inputs and highlight cards in dark mode, with a transparent page number input and borderless sidebar inputs and Find in paper search bar. The filename, file details, back and download header is removed; the reading toolbar remains above the document. The toolbar omits the Record lag button.

Sources sidebar: opening Sources shows saved files from the current workspace. Select a file to open it in the reading space; PDFs open with AI-assisted reading tools. The source list stays visible while reading, with the current file marked and an Add sources action for finding or uploading more documents.

Source tabs: Search online contains the literature search without the numbered introductory cards. Upload a file has its own adjacent tab, followed by Saved sources.

Paper search results automatically generate up to six AI topic keywords from each available abstract using the connected ChatGPT model. Keywords appear beneath the authors in place of category codes, with loading and unavailable states. Results remain usable during generation; repeated abstracts reuse keywords during the server session. The Sources view omits the Research workspace, Discover and AI keywords · abstract labels. Search result cards have no outer border, and their bottom-row action borders stay #333 in dark mode and #ccc in light mode.

Paper details: Show More opens a dedicated view with the full title, authors, journal, abstract and keywords. Import this paper sits beside Import selected and saves the open paper without requiring a checkbox selection. References and Cited in use the same paper cards, with nested paper navigation and Back to results. Citation links use NASA ADS (including DOI/arXiv lookup); each section shows up to 25 recent records and explains unavailable data.

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
- [[research-notebooks]]: Embedded JupyterLab for free-form local Python analyses, cited paper and wiki transfers, automatic local history, clean reruns, and on-request recall linked to historical cells; automatic local Python startup with a loading animation until the editor is ready, in a workspace without the extra file sidebar or action bar.
- [[project-handover]]: A project handover drafted from complete selected file text using backend instructions, displayed as Markdown for researcher review before publication, with aligned form spacing, larger labels and review controls, and simplified review and publication copy.
- [[active-reading]]: PDF reading without a separate Reading Library, with scroll-aware scheduling, bounded nearby-page caching, cancellable text extraction, software-canvas settings and local lag diagnostics, theme-aware highlight helpers that close when leaving the reader, notes and AI requests, wiki-first reference discovery, and automatic agent-written wiki notes with the paper page selected by default and created on Add when missing.

---
*Last updated: 2026-10-22*

- [[stac3719]]: Selected reading notes for stac3719.pdf, with quoted highlights and links to the original passages.
