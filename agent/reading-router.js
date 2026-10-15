'use strict';

const express = require('express');
const { ReadingError, text } = require('./reading-store');

function createReadingRouter({ service, requireLocalSession, requireLocalMutation, onImport }) {
  const router = express.Router();
  router.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    return (req.method === 'GET' ? requireLocalSession : requireLocalMutation)(req, res, next);
  });
  const route = fn => async (req, res, next) => { try { await fn(req, res); } catch (error) { next(error); } };
  router.get('/', route((_req, res) => res.json(service.state())));
  router.get('/export', route((_req, res) => {
    res.setHeader('Content-Disposition', 'attachment; filename="pulsarwiki-reading-backup.json"');
    res.json(service.store.read());
  }));
  router.post('/import', route((req, res) => res.json(service.store.importBackup(req.body?.data, req.body?.revision))));
  router.post('/documents', route(async (req, res) => res.json(await service.openDocument(req.body?.name))));
  router.get('/documents/:id', route((req, res) => {
    const document = service.store.get('documents', req.params.id);
    try { document.currentName = service.documentFile(document).name; document.available = true; } catch { document.available = false; }
    res.json(document);
  }));
  router.get('/documents/:id/pages/:page', route(async (req, res) => res.json(await service.pageText(req.params.id, req.params.page))));
  router.patch('/documents/:id', route((req, res) => {
    const position = req.body?.position;
    const document = service.store.get('documents', req.params.id);
    if (!position || !Number.isInteger(position.page) || position.page < 1 || position.page > document.pageCount || !Number.isFinite(position.scale) || position.scale < 0.25 || position.scale > 4 || typeof position.fitWidth !== 'boolean') throw new ReadingError('Invalid reading position.');
    res.json(service.store.update('documents', document.id, req.body.revision, { position }));
  }));
  router.post('/highlights', route(async (req, res) => res.status(201).json(await service.createHighlight(req.body))));
  router.get('/passages/:id', route((req, res) => res.json(service.passage(req.params.id, { documentId: req.query.documentId, revision: req.query.revision }))));
  router.patch('/highlights/:id', route(async (req, res) => res.json(await service.updateHighlight(req.params.id, req.body))));
  router.post('/annotations', route((req, res) => res.status(201).json(service.saveAnnotation(req.body))));
  router.patch('/annotations/:id', route((req, res) => res.json(service.saveAnnotation(req.body, req.params.id))));
  router.post('/collections', route((req, res) => res.status(201).json(service.saveCollection(req.body))));
  router.patch('/collections/:id', route((req, res) => res.json(service.saveCollection(req.body, req.params.id))));
  router.post('/relationships', route((req, res) => res.status(201).json(service.saveRelationship(req.body))));
  for (const table of ['highlights', 'annotations', 'collections', 'relationships']) router.delete(`/${table}/:id`, route((req, res) => res.json(service.deleteRecord(table, req.params.id, req.body?.revision))));
  router.get('/backlinks/:page', route((req, res) => {
    const data = service.store.read();
    const relationships = data.relationships.filter(r => !r.deletedAt && r.targetType === 'wiki' && r.target === req.params.page);
    res.json(relationships.map(r => ({ ...r, highlight: data.highlights.find(h => h.id === r.from && !h.deletedAt) })).filter(r => r.highlight));
  }));
  router.post('/search', route(async (req, res) => res.json(await service.search(req.body?.query))));
  router.post('/discover', route(async (req, res) => res.json(await service.discover(req.body?.query))));
  router.post('/discover/import', route(async (req, res) => {
    const ids = service.restoreDiscoveries(req.body?.ids);
    const result = await service.discovery.import(ids);
    const ingestJob = onImport(result.imported.map(i => ({ name: i.name, title: i.source.title, doi: i.source.doi, arxivId: i.source.arxivId })));
    res.json({ ...result, ingestJob });
  }));
  router.post('/tasks', route(async (req, res) => res.status(202).json(await service.createTask(req.body))));
  router.get('/tasks/:id', route((req, res) => res.json(service.task(req.params.id))));
  router.delete('/tasks/:id', route((req, res) => res.json(service.cancelTask(req.params.id))));
  router.post('/tasks/:id/retry', route(async (req, res) => res.status(202).json(await service.retryTask(req.params.id))));
  router.post('/artifacts', route(async (req, res) => res.status(201).json(await service.createArtifact(req.body))));
  router.patch('/artifacts/:id', route((req, res) => res.json(service.saveArtifact(req.params.id, req.body))));
  router.post('/artifacts/:id/generate', route(async (req, res) => res.status(202).json(await service.createTask({ action: 'artifact', question: text(req.body?.question || '', 10000), artifactId: req.params.id, artifactRevision: req.body?.revision }))));
  router.post('/artifacts/:id/publish', route((req, res) => res.json(service.publishArtifact(req.params.id, req.body))));
  router.use((error, _req, res, _next) => {
    const known = error instanceof ReadingError || typeof error.code === 'string' && ['WikiToolError', 'ProviderError', 'ChatGPTAuthError'].includes(error.name);
    res.status(error instanceof ReadingError ? error.status : known ? 400 : 500).json({ error: known ? error.message : 'The reading operation could not be completed. Your saved records are preserved.', code: known ? error.code : 'reading-error' });
  });
  return router;
}

module.exports = { createReadingRouter };
