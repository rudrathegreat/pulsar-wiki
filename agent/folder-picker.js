'use strict';

const { execFile } = require('node:child_process');

// The browser cannot expose an absolute folder path. Ask the local OS directly;
// pass the starting path as data, never as executable command text.
function pickFolder({ initialPath = '', platform = process.platform, execute = execFile } = {}) {
  let command;
  let args;
  if (platform === 'win32') {
    command = 'powershell.exe';
    args = ['-NoProfile', '-STA', '-Command', `
      $ErrorActionPreference = 'Stop'
      [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding
      Add-Type -AssemblyName System.Windows.Forms
      $picker = New-Object System.Windows.Forms.FolderBrowserDialog
      $picker.Description = 'Select research workspace folder'
      $picker.SelectedPath = $env:PULSARWIKI_PICKER_PATH
      $picker.ShowNewFolderButton = $true
      try {
        if ($picker.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
          [Console]::Write($picker.SelectedPath)
        }
      } finally { $picker.Dispose() }
    `];
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
        return reject(new Error('The system folder picker could not open. Enter the folder path and select Open.'));
      }
      resolve(String(stdout || '').replace(/^\uFEFF/, '').trim() || null);
    });
  });
}

module.exports = { pickFolder };
