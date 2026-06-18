# LR Gestion — AI Tenant Analyzer

Document-driven tenant screening. Upload documents into four sections, click **Analyze
application**, and get a scored recommendation plus a printable PDF report. No manual data entry.

## Run

```bash
npm install
npm start
```

Open http://localhost:3000

## Real extraction vs demo mode

- **Demo mode (default):** with no API key set, the server returns clearly-labeled sample
  extracted data so you can see the full workflow immediately.
- **Live extraction:** set an API key, then restart:
  ```bash
  export ANTHROPIC_API_KEY=sk-ant-...
  npm start
  ```
  The server reads each uploaded document with the Claude API (`claude-sonnet-4-6` by default),
  extracts structured fields, cross-references sections, and scores the applicant. The key stays
  server-side and is never sent to the browser.

## How it works

- `public/` — the upload UI, results page, and printable report (dark app theme; light print theme).
- `server.js` — Express server: serves the UI and exposes `POST /api/analyze`.
- `extraction.js` — sends documents to Claude for structured extraction, cross-references, and
  orchestrates scoring. Falls back to demo data when no key is present.
- `scoring.js` — the deterministic LR Gestion scoring methodology. The model never decides the
  score; it only supplies extracted inputs.

## PDF report

Click **Generate PDF report** in the results page and use your browser's "Save as PDF". The
report is white, ink-light, LR Gestion-branded, and includes a timestamp.
