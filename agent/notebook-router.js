'use strict';

const express = require('express');
const { NotebookError } = require('./notebook-store');

function createNotebookRouter({ service, requireLocalSession, requireLocalMutation }) {
  const router = express.Router();
  router.use((req, res, next) => { req.body ??= {}; res.setHeader('Cache-Control', 'no-store'); (req.method === 'GET' ? requireLocalSession : requireLocalMutation)(req, res, next); });
  const route = fn => async (req, res, next) => { try { await fn(req, res); } catch (error) { next(error); } };
  router.get('/', route((_req, res) => res.json(service.state())));
  router.post('/', route((req, res) => res.status(201).json(service.create(req.body))));
  router.get('/runtime', route((_req, res) => res.json(service.runtime.status())));
  router.put('/runtime/python', route(async (req, res) => res.json(await service.runtime.configure(req.body.python))));
  router.post('/runtime/start', route(async (req, res) => res.status(202).json(await service.runtime.start(req.headers.origin))));
  router.post('/runtime/launch', route((req, res) => res.json(service.runtime.launchTicket(req.headers.origin))));
  router.post('/runtime/stop', route(async (_req, res) => { if (service.children.size) throw new NotebookError('Stop the clean rerun before stopping Python.', 'runtime-busy', 409); res.json(await service.runtime.stop()); }));
  router.post('/recalls', route(async (req, res) => res.status(202).json(await service.recall(req.body))));
  router.get('/recalls/:id', route((req, res) => res.json(service.task(req.params.id))));
  router.delete('/recalls/:id', route((req, res) => res.json(service.cancelRecall(req.params.id))));
  router.post('/recalls/:id/retry', route(async (req, res) => res.status(202).json(await service.retryRecall(req.params.id))));
  router.post('/executions', route((req, res) => res.status(201).json(service.recordExecution(req.body))));
  router.delete('/runs/:id', route((req, res) => res.json(service.cancelRun(req.params.id))));
  router.get('/:id', route((req, res) => { service.store.sync(); res.json({ entry: service.store.entry(req.params.id), ...service.store.read(req.params.id, req.query.revision) }); }));
  router.patch('/:id', route((req, res) => res.json(service.store.rename(req.params.id, req.body.name, req.body.revision))));
  router.get('/:id/download', route((req, res) => { const snapshot = service.store.read(req.params.id, req.query.revision); res.setHeader('Content-Disposition', 'attachment; filename="notebook.ipynb"'); res.json(snapshot.notebook); }));
  router.post('/:id/checkpoints', route((req, res) => res.status(201).json(service.store.checkpoint(req.params.id, req.body.revision, req.body.label))));
  router.post('/:id/restore', route((req, res) => res.json(service.store.restore(req.params.id, req.body.revision, req.body.expectedRevision))));
  router.post('/:id/transfers', route(async (req, res) => res.json(await service.transfer(req.params.id, req.body))));
  router.post('/:id/sources', route(async (req, res) => res.json(await service.associate(req.params.id, req.body))));
  router.post('/:id/rerun', route(async (req, res) => res.status(202).json(await service.rerun(req.params.id, req.body))));
  router.post('/:id/export', route((req, res) => { res.setHeader('Content-Disposition', 'attachment; filename="notebook-history.json"'); res.json(service.export(req.params.id, req.body.includeSources)); }));
  router.use((error, _req, res, _next) => {
    const known = error instanceof NotebookError || ['ReadingError', 'WikiToolError', 'ChatGPTAuthError', 'ProviderError'].includes(error.name);
    res.status(error instanceof NotebookError ? error.status : known ? error.status || 400 : 500).json({ error: known ? error.message : 'The notebook operation failed. Saved notebooks and history are preserved.', code: known ? error.code : 'notebook-error' });
  });
  return router;
}

module.exports = { createNotebookRouter };
