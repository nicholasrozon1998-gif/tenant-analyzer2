// server.js — AI Tenant Analyzer backend.
// Serves the static UI and exposes POST /api/analyze, which runs document extraction
// (real with ANTHROPIC_API_KEY, demo data without) and the deterministic scoring engine.

const path = require('path');
const express = require('express');
const { analyzeApplication, MODEL } = require('./extraction.js');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '60mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', (req, res) => {
  res.json({ ok: true, model: MODEL, hasKey: !!process.env.ANTHROPIC_API_KEY });
});

// Body: { files: [{name,mediaType,data}], overrides?: { filename: category } }
app.post('/api/analyze', async (req, res) => {
  try {
    const body = req.body || {};
    const result = await analyzeApplication({
      files: body.files || [],
      overrides: body.overrides || {}
    });
    res.json({ ok: true, result });
  } catch (e) {
    console.error('Analyze error:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.listen(PORT, () => {
  console.log('AI Tenant Analyzer running at http://localhost:' + PORT);
  console.log('Extraction mode:', process.env.ANTHROPIC_API_KEY ? ('LIVE (' + MODEL + ')') : 'DEMO (no ANTHROPIC_API_KEY set)');
});
