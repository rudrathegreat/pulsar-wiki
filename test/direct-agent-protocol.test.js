'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');
const test = require('node:test');
const WebSocket = require('ws');

function request(url, options = {}) {
  return new Promise((resolve, reject) => {
    const { body, ...requestOptions } = options;
    const outgoing = http.request(url, requestOptions, response => {
      response.resume();
      resolve(response);
    });
    outgoing.on('error', reject);
    if (body) outgoing.write(body);
    outgoing.end();
  });
}

test('direct-agent WebSocket requires protocol 4 and thread-scoped chat payloads', async t => {
  const child = spawn(process.execPath, ['scripts/server-runner.js', '0'], {
    cwd: path.join(__dirname, '..'),
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let output = '';
  let serverUrl;
  const started = new Promise((resolve, reject) => {
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      output += chunk;
      const match = output.match(/http:\/\/127\.0\.0\.1:(\d+)/);
      if (match) {
        serverUrl = 'http://127.0.0.1:' + match[1];
        resolve();
      }
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', chunk => { output += chunk; });
    child.once('error', reject);
    child.once('exit', code => {
      if (!serverUrl) reject(new Error('Server exited before startup (' + code + '): ' + output));
    });
  });
  t.after(async () => {
    if (!child.killed) child.kill('SIGTERM');
    await new Promise(resolve => child.once('exit', resolve));
  });

  await started;
  const page = await request(serverUrl);
  const cookie = page.headers['set-cookie']?.[0]?.split(';')[0];
  assert.match(cookie || '', /^pulsarwiki_session=/);

  const mutationBody = JSON.stringify({ model: '' });
  const mutationHeaders = { Cookie: cookie, 'Content-Type': 'application/json' };
  const missingOrigin = await request(`${serverUrl}/api/chatgpt/model`, {
    method: 'PUT', headers: mutationHeaders, body: mutationBody,
  });
  assert.equal(missingOrigin.statusCode, 403);
  const wrongOrigin = await request(`${serverUrl}/api/chatgpt/model`, {
    method: 'PUT', headers: { ...mutationHeaders, Origin: 'http://127.0.0.1:9' }, body: mutationBody,
  });
  assert.equal(wrongOrigin.statusCode, 403);
  const allowedOrigin = await request(`${serverUrl}/api/chatgpt/model`, {
    method: 'PUT', headers: { ...mutationHeaders, Origin: serverUrl }, body: mutationBody,
  });
  assert.equal(allowedOrigin.statusCode, 400);

  const messages = await new Promise((resolve, reject) => {
    const socket = new WebSocket(serverUrl.replace('http', 'ws'), { headers: { Cookie: cookie, Origin: serverUrl } });
    const received = [];
    socket.on('message', raw => {
      const message = JSON.parse(raw.toString());
      received.push(message);
      if (message.type === 'server-hello' && !message.ready) {
        socket.send(JSON.stringify({ type: 'client-hello', protocol: 4 }));
      } else if (message.type === 'server-hello' && message.ready) {
        socket.send(JSON.stringify({ type: 'chat', text: 'missing thread' }));
      } else if (message.type === 'error') {
        socket.close();
        resolve(received);
      }
    });
    socket.once('error', reject);
  });
  assert.equal(messages[0].protocol, 4);
  assert.equal(messages[1].ready, true);
  assert.deepEqual(messages.at(-1), {
    type: 'error',
    code: 'invalid-message',
    text: 'A chat thread and message are required.',
  });
});
