# AI-Assisted Active Reading

**Summary**: A guide to private paper annotations, researcher-initiated AI assistance, automatic wiki notes, and library artifacts built from selected evidence.

**Sources**: README.md (application documentation; no scientific source ingestion).

**Last updated**: 2026-10-16

---

## Read and annotate

Open a PDF from Files, select text, and choose a highlight colour. Add optional categories and personal comments. Use Select region for equations, figures, or scanned passages; an entered transcription can support models without image input. Reading notes are local and private. (source: README.md)

The reader opens PDFs from page metadata and extracts passage text on demand. Page rendering prioritises the current page and yields between small text batches. Distant pages release their rendering resources and rebuild when revisited; pages containing the active text selection remain available until it is cleared. Paper search loads the complete text when requested. (source: README.md)

A highlighter pointer follows the mouse over PDF pages. Yellow, green, and pink are manual colours; blue is reserved for AI assistance. The selection helper offers Add to wiki, Ask AI, Add note, and Connect to related knowledge. The helper follows the app theme and has no blue swatch. Each action expands the helper with its fields and results. Add note omits the colour selector and PDF details. Reader pages, thumbnails, and displayed passage locations count from 1 instead of journal page labels. Click a saved PDF highlight or its sidebar card to reopen its menu. Highlights use full opacity with multiply blending and join nearby word blocks into continuous lines. The Highlights on/off toggle beside Rotate controls their visibility and pauses new highlighting without deleting saved passages. (source: README.md)

Filter widths remain stable when the researcher-comments toggle changes the results. The right reading panel contains filters and passage comments, with Delete on each highlight and Undo deletion after a deletion. All highlights in the opened paper show by default. Editing, collection, artifact, and backup controls are available in the Reading library. (source: README.md)

Use the Reading library to find passages across papers, connect highlights to wiki concepts, and organise them into ordered collections with theme labels and comparison notes. Wiki pages show private backlinks to connected passages. (source: README.md)

## Request assistance

Select the passages and explicitly check any comments or previous AI interpretations to include. Enter a question or instructions in Ask AI; there are no action or additional-wiki-page selectors. Inspect the selected inputs if needed, choose Send to submit the request, and read the response within the same expanded helper. External discovery sends an editable query to arXiv and NASA ADS; abstract-only findings remain candidates needing verification. Existing automatic ingestion on upload/import is retained separately. (source: README.md)

Completed assistance displays a blue highlight and an AI-generated comment beside its source passage and researcher comments. The colour filter includes AI assistance, and text search includes its question and response. Shared responses are labelled when they cover several selected passages. Reattached highlights retain earlier AI responses with their preserved original inputs in Assistance. (source: README.md)

Connect to related knowledge checks wiki prose first. If it finds no close match, it searches arXiv and NASA ADS using terms from the highlighted passage and compares paper titles and abstracts against those terms. References can be saved with the highlight. Researcher comments are excluded from the search; external papers remain abstract-only candidates. NASA ADS requires a configured API token. (source: README.md)

## Add notes to the wiki

Add to wiki defaults to the paper summary or filename-based notes page, even when the page does not exist. Select Add to have the connected agent generate and save a concise, cited note automatically. The agent receives explicit instructions to preserve source meaning and uncertainty, distinguish evidence from interpretation, use only selected inputs, and retain existing notes and citations. The application inserts the note into the latest page, creates a missing page when generation succeeds, and updates its sources, date, index, and log together. The helper shows progress and a link to the updated page, without a Markdown editor, diff, or review/publish step. Failed or stopped requests leave the wiki unchanged and offer a retry. (source: README.md)

Create artifact in the Reading library retains paper reading summary, collection synthesis, evidence comparison, and concept-page update options. These private drafts keep their separate editing, optional AI generation, preview, and reviewed publication workflow. (source: README.md)

Published provenance retains selected excerpts, source hashes, page links, included interpretations, and the relationship to AI assistance. Private records preserve earlier selection revisions when a highlight is changed, deleted, or reattached. Back up local reading data separately from Git and retain the original papers. (source: README.md)

## Related pages

- [[project-handover]]
- [[index]]
