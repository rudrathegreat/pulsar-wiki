'use strict';

const { execFile } = require('node:child_process');
const path = require('node:path');
// The browser cannot expose an absolute folder path. Ask the local OS directly;
// pass the starting path as data, never as executable command text.
function pickFolder({ initialPath = '', platform = process.platform, execute = execFile } = {}) {
  let command;
  let args;
  if (platform === 'win32') {
    command = 'powershell.exe';
    args = ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'windows-folder-picker.ps1')];
  } else if (platform === 'darwin') {
    command = 'osascript';
    args = ['-e', 'POSIX path of (choose folder with prompt "Select research workspace folder")'];
  } else {
    command = 'zenity';
    args = ['--file-selection', '--directory', '--title=Select research workspace folder', ...(initialPath ? [`--filename=${initialPath}/`] : [])];
  }
  return new Promise((resolve, reject) => {
    execute(command, args, { windowsHide: true, encoding: 'utf8', timeout: 180000, maxBuffer: 65536, env: { ...process.env, PULSARWIKI_PICKER_PATH: initialPath } }, (error, stdout, stderr) => {
      if (error) {
        if ((platform === 'darwin' && String(stderr).includes('(-128)')) || (platform !== 'win32' && platform !== 'darwin' && error.code === 1)) return resolve(null);
        return reject(new Error('The system folder picker could not open. Please try again.'));
      }
      resolve(String(stdout || '').replace(/^\uFEFF/, '').trim() || null);
    });
  });
}

module.exports = { pickFolder };
