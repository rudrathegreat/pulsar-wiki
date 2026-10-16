# AI-Assisted Active Reading

**Summary**: A guide to private paper annotations, researcher-initiated AI assistance, and reviewed artifacts built from selected evidence.

**Sources**: README.md (application documentation; no scientific source ingestion).

**Last updated**: 2026-10-16

---

## Read and annotate

Open a PDF from Files, select text, and choose a highlight colour. Add optional categories and personal comments. Use Select region for equations, figures, or scanned passages; an entered transcription can support models without image input. Reading notes are local and private. (source: README.md)

A highlighter pointer follows the mouse over PDF pages. Yellow, green, and pink are manual colours; blue is reserved for AI assistance. The selection popup offers Add to wiki, Ask AI, Add note, and Connect to related knowledge. Highlights use full opacity with multiply blending and join nearby word blocks into continuous lines. The Highlights on/off toggle beside Rotate controls their visibility and pauses new highlighting without deleting saved passages. (source: README.md)

The right reading panel contains filters and passage comments, with Delete on each highlight and Undo deletion after a deletion. All highlights in the opened paper show by default. Editing, collection, artifact, and backup controls are available in the Reading library. (source: README.md)

Use the Reading library to find passages across papers, connect highlights to wiki concepts, and organise them into ordered collections with theme labels and comparison notes. Wiki pages show private backlinks to connected passages. (source: README.md)

## Request assistance

Select the passages and explicitly check any comments or previous AI interpretations to include. Ask AI can explain equations, methods, assumptions, and concepts, or compare selected evidence. Review the displayed inputs before submitting. External discovery sends an editable query to arXiv and NASA ADS; abstract-only findings remain candidates needing verification. Existing automatic ingestion on upload/import is retained separately. (source: README.md)

Completed assistance displays a blue highlight and an AI-generated comment beside its source passage and researcher comments. The colour filter includes AI assistance, and text search includes its question and response. Shared responses are labelled when they cover several selected passages. Reattached highlights retain earlier AI responses with their preserved original inputs in Assistance. (source: README.md)

Connect to related knowledge checks wiki prose first. If it finds no close match, it searches arXiv and NASA ADS using terms from the highlighted passage and compares paper titles and abstracts against those terms. References can be saved with the highlight. Researcher comments are excluded from the search; external papers remain abstract-only candidates. NASA ADS requires a configured API token. (source: README.md)

## Create reviewed wiki artifacts

Use Add to wiki on selected text, or Create artifact in the Reading library, to create a paper reading summary, collection synthesis, evidence comparison, or proposed concept-page update. Drafts can be written manually or with requested AI assistance. Paper summaries cover selected passages rather than claiming to summarise the entire paper. Review the draft, source references, selected private material, and any concept-page diff before publishing. Publication updates the wiki index and operation log. (source: README.md)

Published provenance retains selected excerpts, source hashes, page links, included interpretations, and the relationship to AI assistance. Private records preserve earlier selection revisions when a highlight is changed, deleted, or reattached. Back up local reading data separately from Git and retain the original papers. (source: README.md)

## Related pages

- [[project-handover]]
- [[index]]
