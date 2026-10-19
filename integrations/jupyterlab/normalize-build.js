'use strict';
const fs = require('node:fs');
const path = require('node:path');
const file = path.join(__dirname, 'extensions', 'pulsarwiki-notebook-bridge', 'package.json');
const metadata = JSON.parse(fs.readFileSync(file, 'utf8'));
metadata.jupyterlab._build.load = metadata.jupyterlab._build.load.replaceAll('\\', '/');
fs.writeFileSync(file, JSON.stringify(metadata, null, 2) + '\n');
