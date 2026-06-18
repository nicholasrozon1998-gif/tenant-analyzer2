// extraction.js
// Server-side document extraction + analysis orchestration for the LR Gestion Tenant Analyzer.
//
//  * Sends each section's uploaded documents to Claude with a strict-JSON extraction prompt.
//  * Falls back to clearly-labeled DEMO data when ANTHROPIC_API_KEY is not set, so the full
//    workflow runs immediately with no key.
//  * Cross-references sections, flags inconsistencies, lists missing documents.
//  * Feeds extracted numbers into the deterministic scoring engine (scoring.js) — the model
//    never decides the score.

const Scoring = require('./scoring.js');

const API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';
const API_VERSION = '2023-06-01';

const IMG_TYPES = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp' };

function fileToBlock(file) {
  // file: { name, mediaType?, data (raw base64, no data: prefix) }
  const ext = (file.name || '').split('.').pop().toLowerCase();
  const mt = file.mediaType || IMG_TYPES[ext] || (ext === 'pdf' ? 'application/pdf' : 'image/png');
  if (mt === 'application/pdf') {
    return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: file.data } };
  }
  return { type: 'image', source: { type: 'base64', media_type: mt, data: file.data } };
}

async function callClaude(files, prompt) {
  const content = files.map(fileToBlock);
  content.push({ type: 'text', text: prompt });

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': API_VERSION
    },
    body: JSON.stringify({ model: MODEL, max_tokens: 2048, messages: [{ role: 'user', content }] })
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error('Anthropic API ' + res.status + ': ' + body.slice(0, 300));
  }
  const data = await res.json();
  const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
  return parseJson(text);
}

function parseJson(text) {
  if (!text) return {};
  let t = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  const first = t.indexOf('{'), last = t.lastIndexOf('}');
  if (first !== -1 && last !== -1) t = t.slice(first, last + 1);
  try { return JSON.parse(t); } catch (e) { return { _parseError: true, _raw: text.slice(0, 200) }; }
}

// ---- Section extraction prompts -------------------------------------------

const PROMPTS = {
  unit: `You are extracting structured data from rental UNIT / property documents (listing screenshots, photos, lease details, property info). Read every document. Return ONLY a JSON object, no prose, with keys:
{"address":string|null,"unitNumber":string|null,"monthlyRent":number|null,"leaseStartDate":string|null,"bedrooms":number|null,"bathrooms":number|null,"parking":string|null,"utilitiesIncluded":string|null,"otherDetails":string|null,"quality":"high"|"medium"|"low"}
Rules: monthlyRent must be a MONTHLY number (convert weekly x52/12 or annual /12). Use null for anything not clearly present. Never invent values.`,

  tenant: `You are extracting structured data from a rental APPLICATION, government ID, and tenant documents. Read every document. Return ONLY a JSON object, no prose, with keys:
{"fullName":string|null,"dateOfBirth":string|null,"currentAddress":string|null,"phone":string|null,"email":string|null,"previousLandlord":{"name":string|null,"phone":string|null,"tenancyLength":string|null}|null,"employment":{"employer":string|null,"position":string|null,"status":string|null,"years":number|null}|null,"otherDetails":string|null,"quality":"high"|"medium"|"low"}
Use null for anything not clearly present. Never invent values.`,

  income: `You are extracting INCOME data from pay stubs, bank statements, employment letters, or other proof of income. Read every document.
If pay stubs: read gross & net per stub, detect pay frequency, normalize to monthly (weekly x52/12, biweekly x26/12, semimonthly x2, monthly x1). If bank statements (3 months): identify recurring payroll deposits only (same source, regular cadence), filter out e-transfers/refunds/one-offs, average to monthly net.
Return ONLY a JSON object, no prose, with keys:
{"employer":string|null,"employmentStatus":string|null,"netMonthly":number|null,"grossMonthly":number|null,"payFrequency":string|null,"ytdEarnings":number|null,"avgMonthlyDeposits":number|null,"derivedFrom":"paystub"|"bank"|"letter"|"other"|null,"stability":"stable"|"irregular"|"unknown","riskFactors":[string],"quality":"high"|"medium"|"low"}
grossMonthly may be null if not derivable (mark unverified). Never invent values.`,

  credit: `You are extracting CREDIT data from an Equifax/TransUnion/Beacon credit report. Read every document. Return ONLY a JSON object, no prose, with keys:
{"creditScore":number|null,"collections":number,"judgments":number,"consumerProposals":number,"bankruptcy":boolean,"latePayments":number,"utilization":number|null,"debtObligations":number|null,"concerns":[string],"quality":"high"|"medium"|"low"}
Counts default to 0 if none found. creditScore null if not present. Never invent values.`
};

// ---- DEMO fallback data (used only when no API key) ------------------------

const DEMO = {
  unit: { address: '128 Rue Principale, Gatineau, QC', unitNumber: '4B', monthlyRent: 1850, leaseStartDate: '2026-07-01',
    bedrooms: 2, bathrooms: 1, parking: '1 outdoor spot included', utilitiesIncluded: 'Heat & water included; hydro extra',
    otherDetails: 'Non-smoking, small pets allowed', quality: 'high', _demo: true },
  tenant: { fullName: 'Marie-Claude Tremblay', dateOfBirth: '1991-03-14', currentAddress: '57 Rue Laval, Gatineau, QC',
    phone: '(819) 555-0142', email: 'mc.tremblay@example.com',
    previousLandlord: { name: 'Habitations Boucher', phone: '(819) 555-0199', tenancyLength: '3 years' },
    employment: { employer: "CISSS de l'Outaouais", position: 'Registered Nurse', status: 'full_time', years: 4 },
    otherDetails: 'No pets declared', quality: 'high', _demo: true },
  income: { employer: "CISSS de l'Outaouais", employmentStatus: 'full_time', netMonthly: 4850, grossMonthly: 6400,
    payFrequency: 'biweekly', ytdEarnings: 38400, avgMonthlyDeposits: 4900, derivedFrom: 'paystub',
    stability: 'stable', riskFactors: [], quality: 'high', _demo: true },
  credit: { creditScore: 728, collections: 0, judgments: 0, consumerProposals: 0, bankruptcy: false, latePayments: 1,
    utilization: 22, debtObligations: 540, concerns: [], quality: 'high', _demo: true }
};

// ---- Per-section extraction (real or demo) --------------------------------

async function extractSection(section, files, hasKey) {
  if (!files || files.length === 0) return { _missing: true };
  if (!hasKey) return Object.assign({}, DEMO[section]); // demo mode
  try {
    const out = await callClaude(files, PROMPTS[section]);
    out._fileCount = files.length;
    return out;
  } catch (e) {
    return { _error: e.message, _fileCount: files.length };
  }
}

// ---- Cross-reference + assembly -------------------------------------------

function norm(s) { return (s || '').toString().trim().toLowerCase(); }

function crossReference(unit, tenant, income) {
  const issues = [];
  const empT = tenant && tenant.employment && tenant.employment.employer;
  const empI = income && income.employer;
  if (empT && empI && norm(empT) !== norm(empI)) {
    issues.push('Employer differs between application (' + empT + ') and income docs (' + empI + ')');
  }
  const yrsT = tenant && tenant.employment && tenant.employment.years;
  if (income && income.stability === 'irregular') issues.push('Income documents indicate irregular income');
  return { issues, employmentYears: (typeof yrsT === 'number' ? yrsT : null) };
}

const REC_MAP = {
  'APPROVED': 'Approve',
  'APPROVED WITH CONDITIONS': 'Approve with Conditions',
  'MANUAL REVIEW': 'Refer for Review',
  'REJECTED': 'Decline'
};

function buildPositives(score, unit, tenant, income, credit) {
  const p = [];
  if (credit && credit.creditScore != null && credit.creditScore >= 700) p.push('Strong credit score (' + credit.creditScore + ')');
  if (score.detail.income.netRatio != null && score.detail.income.netRatio >= 2.5)
    p.push('Healthy income-to-rent ratio (' + score.detail.income.netRatio.toFixed(1) + '\u00d7 net)');
  if (!score.detail.employment.unverified && score.components.employment >= 15) p.push('Stable, verified employment');
  if (credit && !credit.bankruptcy && norm(credit.collections) === '0') {} // handled below
  const derog = (Number(credit && credit.collections) || 0) + (credit && credit.bankruptcy ? 1 : 0) + (Number(credit && credit.consumerProposals) || 0);
  if (credit && credit.creditScore != null && derog === 0) p.push('No collections, bankruptcies, or proposals on file');
  if (tenant && tenant.previousLandlord && tenant.previousLandlord.name) p.push('Previous landlord reference available');
  if (income && income.stability === 'stable') p.push('Consistent income deposits');
  return p;
}

function buildAnalystNotes(decision, score, ratios, credit, employmentYears, redFlags) {
  const parts = [];
  parts.push('Applicant assessed at grade ' + score.grade + ' (' + score.score + '/100) under the LR Gestion scoring methodology.');
  if (credit && credit.creditScore != null) parts.push('Credit score of ' + credit.creditScore + '.');
  if (ratios.net != null) parts.push('Net income covers rent ' + ratios.net.toFixed(1) + '\u00d7 (required 2.0\u00d7).');
  if (employmentYears != null) parts.push('Reported employment tenure of ' + employmentYears + ' year(s).');
  if (redFlags.length) parts.push('Concerns: ' + redFlags.join('; ') + '.');
  else parts.push('No material concerns detected.');
  parts.push('Recommendation: ' + decision + '. This is a decision-support summary requiring final human review and must remain consistent with fair-housing and applicable rental regulations.');
  return parts.join(' ');
}

async function analyzeApplication(sections) {
  const hasKey = !!process.env.ANTHROPIC_API_KEY;

  const [unit, tenant, income, credit] = await Promise.all([
    extractSection('unit', sections.unit, hasKey),
    extractSection('tenant', sections.tenant, hasKey),
    extractSection('income', sections.income, hasKey),
    extractSection('credit', sections.credit, hasKey)
  ]);

  // Missing documents
  const missing = [];
  if (unit._missing) missing.push('Unit information');
  if (tenant._missing) missing.push('Tenant information');
  if (income._missing) missing.push('Income documents');
  if (credit._missing) missing.push('Credit report');

  // Cross-reference
  const xref = crossReference(unit, tenant, income);

  // Resolve scoring inputs
  const rent = num(unit.monthlyRent);
  const empYears = xref.employmentYears != null ? xref.employmentYears
    : (income && typeof income.netMonthly === 'number' && tenant && tenant.employment ? tenant.employment.years : null);
  const empType = (income && income.employmentStatus) || (tenant && tenant.employment && tenant.employment.status) || null;

  const scoreInput = {
    rent: rent || 0,
    credit: {
      beaconScore: num(credit.creditScore),
      latePayments: num(credit.latePayments, 0),
      collections: num(credit.collections, 0),
      consumerProposal: num(credit.consumerProposals, 0) > 0,
      bankruptcy: !!credit.bankruptcy
    },
    income: {
      netMonthly: num(income.netMonthly),
      grossMonthly: num(income.grossMonthly),
      irregular: income.stability === 'irregular'
    },
    employment: {
      years: typeof empYears === 'number' ? empYears : null,
      type: mapEmpType(empType),
      verified: typeof empYears === 'number' && !income._missing
    },
    docs: {
      hasProperty: !unit._missing && rent != null,
      hasCredit: !credit._missing && credit.creditScore != null,
      hasIncome: !income._missing && num(income.netMonthly) != null,
      inconsistent: xref.issues.length > 0,
      lowScanQuality: [unit, tenant, income, credit].some(s => s && s.quality === 'low')
    }
  };

  const score = Scoring.analyze(scoreInput);
  const decision = REC_MAP[score.recommendation] || 'Refer for Review';

  const ratios = {
    net: score.detail.income.netRatio,
    gross: score.detail.income.grossRatio
  };

  // Red flags: engine flags + extraction risks + cross-ref + missing docs
  const redFlags = [];
  score.redFlags.forEach(f => redFlags.push(f));
  (income.riskFactors || []).forEach(f => redFlags.push(f));
  (credit.concerns || []).forEach(f => redFlags.push(f));
  xref.issues.forEach(f => redFlags.push(f));
  if (missing.length) redFlags.push('Missing: ' + missing.join(', '));
  const dedupFlags = Array.from(new Set(redFlags));

  const positives = buildPositives(score, unit, tenant, income, credit);
  const analystNotes = buildAnalystNotes(decision, score, ratios, credit, scoreInput.employment.years, dedupFlags);

  return {
    demoMode: !hasKey,
    generatedAt: new Date().toISOString(),
    extracted: { unit, tenant, income, credit },
    decision,
    score: { value: score.score, grade: score.grade, confidence: score.confidence },
    components: score.components,
    keyMetrics: {
      creditScore: num(credit.creditScore),
      netIncomeToRent: ratios.net != null ? Number(ratios.net.toFixed(2)) : null,
      grossIncomeToRent: ratios.gross != null ? Number(ratios.gross.toFixed(2)) : null,
      employmentStability: stabilityLabel(score.components.employment, scoreInput.employment.verified),
      debtIndicators: { utilization: num(credit.utilization), monthlyObligations: num(credit.debtObligations), collections: num(credit.collections, 0) },
      rentalHistory: tenant && tenant.previousLandlord && tenant.previousLandlord.name ? ('Reference: ' + tenant.previousLandlord.name) : 'No prior landlord on file'
    },
    redFlags: dedupFlags,
    positiveFactors: positives,
    analystNotes,
    missingDocuments: missing,
    inconsistencies: xref.issues
  };
}

function num(v, dflt) {
  if (v === null || v === undefined || v === '') return dflt === undefined ? null : dflt;
  const n = Number(v);
  return Number.isFinite(n) ? n : (dflt === undefined ? null : dflt);
}
function mapEmpType(s) {
  s = norm(s);
  if (!s) return null;
  if (s.includes('full')) return 'full_time';
  if (s.includes('part')) return 'part_time';
  if (s.includes('contract')) return 'contract';
  if (s.includes('self')) return 'self_employed';
  if (s.includes('retire')) return 'retired';
  if (s.includes('govern') || s.includes('benefit')) return 'government';
  return null;
}
function stabilityLabel(pts, verified) {
  if (!verified) return 'Unverified';
  if (pts >= 17) return 'Strong';
  if (pts >= 12) return 'Moderate';
  return 'Limited';
}

module.exports = { analyzeApplication, MODEL };
