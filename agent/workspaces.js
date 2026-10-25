'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const DEFAULT_INSTRUCTIONS = `# Research workspace

Maintain a source-backed research knowledge base for this project.
Read wiki/index.md first to find project context. Do not assume a research topic.

## Files and evidence
- raw/ contains immutable sources. Never modify or overwrite existing sources.
- wiki/ contains Markdown pages, wiki/index.md is the table of contents, and wiki/log.md is append-only.
- Preserve existing notes and citations. Use lowercase, hyphenated page names and [[wiki-links]].
- Cite factual claims with (source: filename). Mark unsupported claims Needs verification.
- Every page has a title, **Summary**, **Sources**, **Last updated**, main content, and Related pages.
- Update wiki/index.md and append wiki/log.md after changes.

## Full-source ingestion
Read each source in full, discuss key takeaways with the researcher before writing, then create summaries and concept pages, connect related pages, and update index and log.

## Research notebooks
notebooks/ contains editable standard Jupyter notebooks; .pulsarwiki/notebooks/ retains private local history, provenance and execution records.
Researchers manually write and execute analyses. Paper and wiki material may be brought into notebooks with source links; results remain in notebooks.
AI recall uses only supplied saved excerpts, cites exact historical cells, distinguishes recorded statements from inference, and states when evidence is insufficient. It must not execute code, insert cells, or publish notebook results.

## Selected reading notes
Selecting Add to wiki authorises generating and saving that note automatically without another confirmation or Markdown review.
Use only selected passages and explicitly included comments, visual regions and AI interpretations, with the destination page as context.
Write a concise note with a descriptive heading, preserving meaning, qualifications, equations and units. Do not imply the whole paper was read.
Cite passage references and source filenames. Distinguish source evidence, researcher interpretation and AI explanation; mark unsupported interpretations Needs verification.
Preserve existing notes and citations. Insert into the latest page instead of replacing it. Create a missing paper notes page on Add and update sources, date, index and append-only log together.
Append short, topic-focused sections with descriptive headings, the exact highlighted text in Markdown blockquotes, and readable filename/page links. Place the concise explanation below the quoted selections. Keep hashes, internal IDs, AI-use declarations and model names out of published notes. Preserve scientific uncertainty using natural interpretation or open-question wording.
Show progress and a completion link without opening an editor or publication review.
`;

function describe(workspace) {
  return workspace ? { id: workspace.id, name: path.basename(workspace.rootDir) || workspace.rootDir, path: workspace.rootDir } : null;
}

function existingDirectory(value) {
  if (typeof value !== 'string' || !value.trim() || !path.isAbsolute(value.trim())) throw new Error('Enter an absolute folder path.');
  const directory = fs.realpathSync(value.trim());
  if (!fs.statSync(directory).isDirectory()) throw new Error('Select a folder, rather than a file.');
  return directory;
}

function initializeWorkspace(value) {
  const rootDir = existingDirectory(value);
  // Validate the entire layout before creating anything. Existing files are never overwritten.
  for (const [name, directory] of [['wiki', true], ['raw', true], ['.pulsarwiki', true], ['GEMINI.md', false], ['wiki/index.md', false], ['wiki/log.md', false]]) {
    const target = path.join(rootDir, name);
    if (!fs.existsSync(target)) continue;
    const relative = path.relative(rootDir, fs.realpathSync(target));
    if (relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) throw new Error(`${name} must stay inside the selected workspace.`);
    if (fs.statSync(target).isDirectory() !== directory) throw new Error(`${name} must be a ${directory ? 'folder' : 'file'}.`);
  }
  for (const name of ['wiki', 'raw', '.pulsarwiki']) fs.mkdirSync(path.join(rootDir, name), { recursive: true });
  const date = new Date().toISOString().slice(0, 10);
  const starters = {
    'GEMINI.md': DEFAULT_INSTRUCTIONS,
    'wiki/index.md': `# Research workspace\n\n**Summary**: Knowledge and reading notes for this project.\n\n**Sources**: None yet.\n\n**Last updated**: ${date}\n\n---\n\n## Research pages\n\nAdd sources from Files, or create your first wiki page.\n\n## Related pages\n\n- [[log]]\n`,
    'wiki/log.md': `# Workspace log\n\n- ${date}: Initialised research workspace.\n`,
  };
  for (const [name, content] of Object.entries(starters)) {
    try { fs.writeFileSync(path.join(rootDir, name), content, { encoding: 'utf8', flag: 'wx' }); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
  return { id: crypto.randomUUID(), rootDir, wikiDir: path.join(rootDir, 'wiki'), rawDir: path.join(rootDir, 'raw'), dataDir: path.join(rootDir, '.pulsarwiki'), instructions: fs.readFileSync(path.join(rootDir, 'GEMINI.md'), 'utf8') };
}

function createWorkspace(parentPath, projectName) {
  const name = typeof projectName === 'string' ? projectName.trim() : '';
  if (!name || name.length > 120 || /[<>:"/\\|?*\x00-\x1f]/.test(name) || /[. ]$/.test(name) || name === '.' || name === '..' || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) {
    throw new Error('Enter a valid project name (up to 120 characters, without folder separators or reserved filename characters).');
  }
  const parent = existingDirectory(parentPath);
  const rootDir = path.join(parent, name);
  try { fs.mkdirSync(rootDir); }
  catch (error) {
    if (error.code === 'EEXIST') throw new Error('A file or folder with this project name already exists. Choose another name.');
    throw error;
  }
  const workspace = initializeWorkspace(rootDir);
  fs.mkdirSync(path.join(rootDir, 'notebooks'));
  const entryPoint = '# PulsarWiki instruction entry point\n\nBefore answering, editing, or running commands, read and follow `GEMINI.md` at\nthis workspace root. It is the canonical source for all project instructions.\n';
  const files = {
    'AGENTS.md': entryPoint,
    'CLAUDE.md': entryPoint,
    'references.bib': '',
    '.gitignore': '/.pulsarwiki/\n.env\n.env.*\n!.env.example\n.ipynb_checkpoints/\n__pycache__/\n*.pyc\n.DS_Store\nThumbs.db\n',
  };
  for (const [file, content] of Object.entries(files)) fs.writeFileSync(path.join(rootDir, file), content, { encoding: 'utf8', flag: 'wx' });
  const indexPath = path.join(rootDir, 'wiki', 'index.md');
  fs.writeFileSync(indexPath, fs.readFileSync(indexPath, 'utf8').replace('# Research workspace', () => `# ${name.replace(/[\[\]<>#`*_]/g, '')}`));
  return workspace;
}

module.exports = { initializeWorkspace, createWorkspace, describe };
