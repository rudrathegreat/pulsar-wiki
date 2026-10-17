'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { pickFolder } = require('../agent/folder-picker');

test('Windows folder dialog returns the absolute path and passes the starting folder as data', async () => {
  const initialPath = 'E:\\Research\\name with $ and quotes';
  const selectedPath = 'E:\\Research\\Selected project';
  const result = await pickFolder({ initialPath, platform: 'win32', execute(command, args, options, callback) {
    assert.equal(command, 'powershell.exe');
    assert.ok(args.includes('-STA'));
    assert.match(args.at(-1), /System.Windows.Forms.FolderBrowserDialog/);
    assert.equal(args.at(-1).includes(initialPath), false);
    assert.equal(options.env.PULSARWIKI_PICKER_PATH, initialPath);
    assert.equal(options.windowsHide, true);
    callback(null, selectedPath, '');
  } });
  assert.equal(result, selectedPath);
});

test('cancelling the native dialog returns no selection', async () => {
  for (const platform of ['win32', 'darwin', 'linux']) {
    const result = await pickFolder({ platform, execute(command, args, options, callback) {
      if (platform === 'win32') callback(null, '', '');
      else callback({ code: 1 }, '', platform === 'darwin' ? 'User canceled. (-128)' : '');
    } });
    assert.equal(result, null);
  }
});

test('missing or failed native dialogs give a manual-path fallback', async () => {
  await assert.rejects(pickFolder({ platform: 'win32', execute(command, args, options, callback) {
    callback({ code: 'ENOENT' }, '', '');
  } }), /Enter the folder path and select Open/);
});
