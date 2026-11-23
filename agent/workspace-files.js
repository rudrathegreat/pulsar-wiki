'use strict';

const fs = require('node:fs/promises');
const { O_RDONLY, O_NOFOLLOW, O_NONBLOCK } = require('node:fs').constants;
const path = require('node:path');
const explorerFolders = new Set(['raw', 'wiki', 'notebooks']);
const instructionFiles = new Set(['agents.md', 'claude.md', 'gemini.md']);

function visibleName(name) {
  return Boolean(name) && (!name.startsWith('.') || name === '.gitignore')
    && !/[/\\:\x00-\x1f]|[. ]$/.test(name)
    && !['node_modules', '__pycache__'].includes(name.toLowerCase());
}

function missingEntry() {
  return Object.assign(new Error('Project entry not found.'), { code: 'ENOENT' });
}

function projectPath(root, relative) {
  if (relative === '') return root;
  if (typeof relative !== 'string') throw missingEntry();
  const segments = relative.split('/');
  if (!explorerFolders.has(segments[0]) || !segments.every(visibleName)) throw missingEntry();
  return path.join(root, relative);
}

async function verifyProjectPath(file) {
  if (path.relative(file, await fs.realpath(file))) throw missingEntry();
}

async function listProjectFolder(root, relative) {
  const folder = projectPath(root, relative);
  await verifyProjectPath(folder);
  const entries = await fs.readdir(folder, { withFileTypes: true });
  // Recheck the directory in case it was replaced while being read.
  await verifyProjectPath(folder);
  const visibleEntries = relative === ''
    ? entries.filter(entry => entry.isDirectory() && explorerFolders.has(entry.name))
    : entries.filter(entry => visibleName(entry.name) && (entry.isDirectory()
      || (entry.isFile() && !instructionFiles.has(entry.name.toLowerCase()))));
  return visibleEntries
    .map(entry => ({ name: entry.name, directory: entry.isDirectory() }))
    .sort((a, b) => Number(b.directory) - Number(a.directory)
      || a.name.localeCompare(b.name, undefined, { numeric: true }));
}

async function openProjectFile(file) {
  await verifyProjectPath(file);
  const handle = await fs.open(file, O_RDONLY | (O_NOFOLLOW || 0) | (O_NONBLOCK || 0));
  try {
    const actual = await handle.stat();
    const current = await fs.lstat(file);
    if (!actual.isFile() || !current.isFile() || actual.dev !== current.dev || actual.ino !== current.ino) throw missingEntry();
    await verifyProjectPath(file);
    return handle.createReadStream();
  } catch (error) {
    await handle.close();
    throw error;
  }
}

async function openExplorerFile(root, relative) {
  if (!relative) throw missingEntry();
  return openProjectFile(projectPath(root, relative));
}

module.exports = { listProjectFolder, openExplorerFile, openProjectFile };
