'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { create } = require('../public/reading-performance');

function recorder({ supported = true } = {}) {
  let time = 1000; let frame; let visibility; let hidden = false; let reads = 0; let callback; let observer;
  class Observer {
    static supportedEntryTypes = supported ? ['longtask'] : [];
    constructor(fn) { callback = fn; observer = this; this.pending = []; }
    observe() { this.observing = true; }
    takeRecords() { return this.pending.splice(0); }
    disconnect() { this.observing = false; }
  }
  const api = create({
    now: () => time, sample: () => { reads += 1; return { page: 2, canvases: [{ width: 600, height: 800 }] }; },
    requestFrame(fn) { frame = fn; return 1; }, cancelFrame() { frame = null; }, Observer,
    hidden: () => hidden, subscribeVisibility(fn) { visibility = fn; return () => { visibility = null; }; },
    environment: () => ({ devicePixelRatio: 2 }),
  });
  return { api, reads: () => reads, observer: () => observer,
    advance(ms) { time += ms; }, tick() { frame(); },
    setHidden(value) { hidden = value; visibility(); },
    deliver(entries) { callback({ getEntries: () => entries }); },
  };
}

test('lag recording is opt-in and stopping releases its frame and observer', () => {
  const c = recorder();
  c.api.mark('canvas', { page: 2 }); assert.equal(c.reads(), 0); assert.equal(c.api.stop(), null);
  c.api.start(); assert.equal(c.reads(), 1); assert.equal(c.api.recording, true);
  c.api.mark('canvas', { page: 2 }); c.advance(16); c.tick();
  const report = c.api.stop();
  assert.equal(report.duration, 16); assert.equal(c.api.recording, false);
  assert.equal(c.observer().observing, false); assert.equal(report.events.length, 1);
  assert.equal(report.events[0].phase, 'canvas');
});

test('reports distinguish a multi-second frame gap from long JavaScript tasks and preserve final pending tasks', () => {
  const c = recorder(); c.api.start(); c.api.mark('canvas', { page: 2 });
  c.advance(6000); c.tick();
  c.deliver([{ startTime: 1100, duration: 250 }]);
  c.observer().pending.push({ startTime: 2000, duration: 5000 });
  const report = c.api.stop();
  const gap = report.events.find(e => e.type === 'frame-gap');
  assert.equal(gap.duration, 6000); assert.equal(gap.sample.page, 2);
  assert.deepEqual(report.events.filter(e => e.type === 'longtask').map(e => e.duration), [250, 5000]);
  assert.equal(report.longTasksSupported, true);
});

test('time spent in a hidden tab is excluded even when animation frames stop entirely', () => {
  const c = recorder(); c.api.start(); c.advance(16); c.tick();
  c.setHidden(true); c.advance(10000); c.setHidden(false); c.tick();
  c.advance(16); c.tick();
  assert.deepEqual(c.api.stop().events, []);
});

test('recording still measures frame gaps when long-task observation is unsupported', () => {
  const c = recorder({ supported: false }); c.api.start(); c.advance(200); c.tick();
  const report = c.api.stop(); assert.equal(report.longTasksSupported, false);
  assert.equal(report.events[0].type, 'frame-gap'); assert.equal(report.events[0].duration, 200);
});

test('a prolonged recording stays bounded and retains the most recent stall', () => {
  const c = recorder(); c.api.start();
  for (let i = 0; i < 2000; i += 1) c.api.mark('canvas', { page: i });
  c.advance(5000); c.tick();
  const report = c.api.stop(); assert.equal(report.events.length, 1000);
  assert.equal(report.droppedEvents, 1001); assert.equal(report.events.at(-1).duration, 5000);
});
