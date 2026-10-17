/* Opt-in, bounded local timing diagnostics. No document contents or network I/O. */
(function (root) {
  'use strict';
  const BUILD = '2026-10-17-software-canvas';
  function create({ sample = () => ({}), now = () => performance.now(),
    requestFrame = callback => window.requestAnimationFrame(callback), cancelFrame = id => window.cancelAnimationFrame(id),
    Observer = root.PerformanceObserver, hidden = () => Boolean(root.document?.hidden),
    subscribeVisibility = callback => {
      root.document?.addEventListener('visibilitychange', callback);
      return () => root.document?.removeEventListener('visibilitychange', callback);
    },
    environment = () => ({ userAgent: root.navigator?.userAgent, devicePixelRatio: root.devicePixelRatio }) } = {}) {
    let report = null; let frame = null; let previous = null; let observer = null; let started = 0; let unsubscribe = null;
    function append(event) {
      if (!report) return;
      if (report.events.length >= 1000) { report.droppedEvents += 1; report.events.shift(); }
      report.events.push(event);
    }
    function longTasks(entries) {
      for (const entry of entries) append({ type: 'longtask', at: entry.startTime - started, duration: entry.duration });
    }
    function tick() {
      if (!report) return;
      const current = now();
      if (hidden()) previous = null;
      else {
        if (previous !== null && current - previous >= 100) append({ type: 'frame-gap', at: previous - started, duration: current - previous, sample: sample() });
        previous = current;
      }
      frame = requestFrame(tick);
    }
    return {
      get recording() { return report !== null; },
      start() {
        if (report) return;
        started = now(); previous = started;
        report = { build: BUILD, environment: environment(), startedAt: new Date().toISOString(), initial: sample(), events: [], droppedEvents: 0, longTasksSupported: false };
        unsubscribe = subscribeVisibility(() => { previous = null; });
        if (Observer?.supportedEntryTypes?.includes('longtask')) {
          const session = report;
          observer = new Observer(list => { if (report === session) longTasks(list.getEntries()); });
          try { observer.observe({ type: 'longtask' }); report.longTasksSupported = true; }
          catch { observer.disconnect(); observer = null; }
        }
        frame = requestFrame(tick);
      },
      mark(phase, details = {}) { if (report) append({ type: 'phase', at: now() - started, phase, ...details }); },
      stop() {
        if (!report) return null;
        if (observer) { longTasks(observer.takeRecords()); observer.disconnect(); observer = null; }
        unsubscribe?.(); unsubscribe = null;
        cancelFrame(frame); frame = null;
        report.duration = now() - started; report.final = sample();
        const result = report; report = null; previous = null; return result;
      },
    };
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { create };
  else root.ReadingPerformance = { create };
})(typeof window === 'undefined' ? globalThis : window);
