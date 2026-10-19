# Research Notebooks

**Summary**: Embedded JupyterLab provides a free-form notebook for manually written Python analyses, research notes, and plots, with source connections and cited recall of earlier work.

**Sources**: README.md

**Last updated**: 2026-10-19

---

## Working with notes and code

Open Notebooks, select a local Python environment, and start Python. Create or import standard Jupyter notebooks and combine executable code, Markdown, LaTeX and visualisations without a prescribed format. Headings, navigation and cell collapse remain optional. Editing and execution work without an AI connection. (source: README.md)

## Bringing in research context

Add paper highlights or wiki references to a notebook as cited Markdown. Highlight transfers preserve exact text and the original passage revision. Optional source associations record dataset and research-source fingerprints. Application-managed notebook operations preserve immutable source files. Findings and plots stay in notebooks, without a notebook-to-wiki publishing workflow. (source: README.md)

## Preserving earlier analyses

Working files live in `notebooks/`; private history and provenance live in `.pulsarwiki/notebooks/`. Changed saves and named checkpoints retain historical cells and outputs. Restoring creates another revision. A clean rerun executes a separate copy with a fresh kernel, records changed inputs and outputs, and preserves the working notebook. Export can include history and explicitly selected source files. Local history does not travel with a Git clone. (source: README.md)

## Recalling assumptions and decisions

Recall searches saved notebook cells and historical revisions when requested. Matching excerpts are sent to the connected AI, with the supplied evidence available for inspection. Answers distinguish recorded statements from inference and link to original historical cells. Recall does not execute code, edit notebooks or publish results. (source: README.md)

## Related pages

- [[active-reading]]
- [[project-handover]]
