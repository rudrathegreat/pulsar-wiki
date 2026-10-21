'use strict';

const fs = require('node:fs');
const path = require('node:path');

class SourceSettings {
  constructor({ dataDir, envToken = process.env.NASA_ADS_API_TOKEN } = {}) {
    this.file = path.join(dataDir, 'source-settings.json');
    this.envToken = envToken || '';
    try { this.savedToken = JSON.parse(fs.readFileSync(this.file, 'utf8')).adsToken || ''; }
    catch (error) { if (error.code !== 'ENOENT') throw error; this.savedToken = ''; }
  }

  get token() { return this.savedToken || this.envToken; }
  status() { return { configured: Boolean(this.token), saved: Boolean(this.savedToken), fromEnvironment: !this.savedToken && Boolean(this.envToken) }; }

  save(token) {
    if (typeof token !== 'string' || !token.trim() || token.trim().length > 4096 || /\s/.test(token.trim())) {
      throw new TypeError('Enter a NASA ADS token without spaces.');
    }
    const adsToken = token.trim();
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const temporary = `${this.file}.tmp`;
    try {
      fs.writeFileSync(temporary, JSON.stringify({ adsToken }), { mode: 0o600 });
      fs.renameSync(temporary, this.file);
    } finally {
      fs.rmSync(temporary, { force: true });
    }
    this.savedToken = adsToken;
    return this.status();
  }

  remove() {
    fs.rmSync(this.file, { force: true });
    this.savedToken = '';
    return this.status();
  }
}

module.exports = { SourceSettings };
