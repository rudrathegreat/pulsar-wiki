'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { ZipFile } = require('yazl');
const { openProjectFile } = require('./workspace-files');

const PROJECT_PATHS = ['wiki', 'raw', 'notebooks', 'GEMINI.md', 'AGENTS.md', 'CLAUDE.md', 'references.bib', '.gitignore'];
const SAVED_DATA_PATHS = [
  '.pulsarwiki/chat',
  '.pulsarwiki/reading',
  '.pulsarwiki/handover',
  '.pulsarwiki/notebooks/catalog.json',
  '.pulsarwiki/notebooks/history',
  '.pulsarwiki/source-display-names.json',
];

async function collectEntries(root, archivePath, entries, optional = false) {
  const file = path.join(root, archivePath);
  let stat;
  try {
    stat = await fs.lstat(file);
    const resolved = await fs.realpath(file);
    if (stat.isSymbolicLink() || path.relative(file, resolved)) {
      if (optional) return;
      throw new Error('A project file or directory is a symbolic link.');
    }
  } catch (error) {
    if (optional && error.code === 'ENOENT') return;
    throw error;
  }
  if (stat.isDirectory()) {
    entries.push({ archivePath, stat });
    for (const child of await fs.readdir(file, { withFileTypes: true })) {
      if ((!child.isDirectory() && !child.isFile()) || child.name === '.ipynb_checkpoints'
          || child.name.endsWith('.tmp') || child.name.includes('\\')) continue;
      await collectEntries(root, path.posix.join(archivePath, child.name), entries, true);
    }
  } else if (stat.isFile()) {
    entries.push({ file, archivePath, stat });
  }
}

async function createWorkspaceZip(root) {
  const entries = [];
  for (const archivePath of PROJECT_PATHS) await collectEntries(root, archivePath, entries);
  for (const archivePath of SAVED_DATA_PATHS) await collectEntries(root, archivePath, entries, true);

  const zip = new ZipFile();
  const output = zip.outputStream;
  let activeInput;
  zip.on('error', error => output.destroy(error));
  output.once('close', () => activeInput?.destroy());
  for (const { file, archivePath, stat } of entries) {
    const options = { mtime: stat.mtime, mode: stat.mode };
    if (!file) {
      zip.addEmptyDirectory(archivePath, options);
      continue;
    }
    zip.addReadStreamLazy(archivePath, options, callback => {
      openProjectFile(file).then(input => {
        if (output.destroyed) {
          input.destroy();
          return;
        }
        activeInput = input;
        input.once('error', error => output.destroy(error));
        callback(null, input);
      }, callback);
    });
  }
  zip.end();
  return output;
}

module.exports = { createWorkspaceZip };
