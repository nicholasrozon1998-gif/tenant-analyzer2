(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var GAUGE_CIRC = 490;

  var SECTIONS = [
    { key: 'unit', title: 'Unit information', icon: 'M3 11l9-7 9 7v8a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
      accepts: 'Unit photos, listing screenshots, lease details, property info' },
    { key: 'tenant', title: 'Tenant information', icon: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm-7 8a7 7 0 0 1 14 0z',
      accepts: 'Rental application, government ID, additional tenant documents' },
    { key: 'income', title: 'Tenant income', icon: 'M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6',
      accepts: 'Two pay stubs, OR 3 months bank statements, OR employment letter' },
    { key: 'credit', title: 'Credit report', icon: 'M2 7h20v10H2zM2 11h20',
      accepts: 'Equifax, TransUnion, or Beacon score report' }
  ];

  var state = { unit: [], tenant: [], income: [], credit: [] };
  var lastResult = null;

  // ---- Build the four upload sections ----
  function buildSections() {
    var host = $('sections');
    SECTIONS.forEach(function (s) {
      var card = document.createElement('div');
      card.className = 'upload-card';
      card.innerHTML =
        '<div class="uc-head">' +
          '<svg class="uc-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + s.icon + '"/></svg>' +
          '<div><div class="uc-title">' + s.title + '</div><div class="uc-accepts">' + s.accepts + '</div></div>' +
          '<span class="uc-status" data-status="' + s.key + '">Empty</span>' +
        '</div>' +
        '<label class="dropzone" data-zone="' + s.key + '" tabindex="0">' +
          '<input type="file" multiple accept="image/*,.pdf" data-input="' + s.key + '" hidden />' +
          '<span class="dz-text"><b>Drop files</b> or click to browse</span>' +
          '<span class="dz-types">PDF, JPG, PNG</span>' +
        '</label>' +
        '<ul class="file-list" data-files="' + s.key + '"></ul>';
      host.appendChild(card);

      var input = card.querySelector('[data-input]');
      var zone = card.querySelector('[data-zone]');
      input.addEventListener('change', function (e) { addFiles(s.key, e.target.files); input.value = ''; });
      zone.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
      ['dragenter', 'dragover'].forEach(function (ev) {
        zone.addEventListener(ev, function (e) { e.preventDefault(); zone.classList.add('drag'); });
      });
      ['dragleave', 'drop'].forEach(function (ev) {
        zone.addEventListener(ev, function (e) { e.preventDefault(); zone.classList.remove('drag'); });
      });
      zone.addEventListener('drop', function (e) { addFiles(s.key, e.dataTransfer.files); });
    });
  }

  function readAsBase64(file) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(String(r.result).split(',')[1]); };
      r.onerror = reject;
      r.readAsDataURL(file);
    });
  }

  function addFiles(key, fileList) {
    var files = Array.prototype.slice.call(fileList || []);
    files.forEach(function (f) {
      readAsBase64(f).then(function (b64) {
        state[key].push({ name: f.name, mediaType: f.type || guessType(f.name), data: b64 });
        renderFiles(key);
        updateAnalyzeState();
      });
    });
  }

  function guessType(name) {
    var ext = name.split('.').pop().toLowerCase();
    if (ext === 'pdf') return 'application/pdf';
    if (ext === 'png') return 'image/png';
    if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
    if (ext === 'gif') return 'image/gif';
    if (ext === 'webp') return 'image/webp';
    return 'application/octet-stream';
  }

  function renderFiles(key) {
    var ul = document.querySelector('[data-files="' + key + '"]');
    ul.innerHTML = '';
    state[key].forEach(function (f, i) {
      var li = document.createElement('li');
      li.innerHTML = '<span class="fl-name">' + escapeHtml(f.name) + '</span>' +
        '<button class="fl-x" aria-label="Remove ' + escapeHtml(f.name) + '">&times;</button>';
      li.querySelector('.fl-x').addEventListener('click', function () {
        state[key].splice(i, 1); renderFiles(key); updateAnalyzeState();
      });
      ul.appendChild(li);
    });
    var status = document.querySelector('[data-status="' + key + '"]');
    var n = state[key].length;
    status.textContent = n ? (n + ' file' + (n > 1 ? 's' : '')) : 'Empty';
    status.classList.toggle('ready', n > 0);
  }

  function updateAnalyzeState() {
    var total = SECTIONS.reduce(function (a, s) { return a + state[s.key].length; }, 0);
    var emptySections = SECTIONS.filter(function (s) { return state[s.key].length === 0; });
    var btn = $('analyze-btn');
    btn.disabled = total === 0;
    var status = $('analyze-status');
    if (total === 0) status.textContent = 'No documents uploaded yet';
    else if (emptySections.length) status.textContent = total + ' files \u00b7 still empty: ' + emptySections.map(function (s) { return s.title; }).join(', ');
    else status.textContent = total + ' files across all four sections \u00b7 ready';
  }

  // ---- Analyze ----
  function analyze() {
    var btn = $('analyze-btn');
    btn.classList.add('loading'); btn.disabled = true;
    $('analyze-status').textContent = 'Reading documents and scoring\u2026';

    fetch('/api/analyze', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sections: state })
    }).then(function (r) { return r.json(); })
      .then(function (resp) {
        if (!resp.ok) throw new Error(resp.error || 'Analysis failed');
        lastResult = resp.result;
        renderResult(resp.result);
      })
      .catch(function (err) {
        $('analyze-status').textContent = 'Error: ' + err.message;
      })
      .finally(function () {
        btn.classList.remove('loading'); btn.disabled = false; updateAnalyzeState();
      });
  }

  function decisionClass(d) {
    if (d === 'Approve') return 'approve';
    if (d === 'Approve with Conditions') return 'conditions';
    if (d === 'Decline') return 'decline';
    return 'review';
  }
  function gradeColor(g) {
    if (g === 'A+' || g === 'A') return 'var(--green)';
    if (g === 'B+' || g === 'B') return 'var(--accent)';
    if (g === 'C+' || g === 'C') return 'var(--amber)';
    return 'var(--red)';
  }

  function renderResult(r) {
    $('demo-banner').hidden = !r.demoMode;
    $('results').hidden = false;

    $('decision').textContent = r.decision;
    $('decision').className = 'decision-pill ' + decisionClass(r.decision);
    $('analyst-notes-short').textContent = firstSentence(r.analystNotes);

    var color = gradeColor(r.score.grade);
    var grade = $('grade'); grade.textContent = r.score.grade; grade.style.color = color;
    $('score-val').textContent = r.score.value;
    var fill = $('gauge-fill'); fill.style.stroke = color;
    fill.style.strokeDashoffset = GAUGE_CIRC;
    requestAnimationFrame(function () { requestAnimationFrame(function () {
      fill.style.strokeDashoffset = GAUGE_CIRC * (1 - r.score.value / 100);
    }); });
    $('conf-val').textContent = r.score.confidence + '%';
    requestAnimationFrame(function () { $('conf-fill').style.width = r.score.confidence + '%'; });

    // Key metrics
    var m = r.keyMetrics;
    var ex = r.extracted || {};
    var employer = (ex.income && ex.income.employer) ||
      (ex.tenant && ex.tenant.employment && ex.tenant.employment.employer) || 'N/A';
    var lateP = (ex.credit && ex.credit.latePayments != null) ? ex.credit.latePayments : 'N/A';
    var refName = (ex.tenant && ex.tenant.previousLandlord && ex.tenant.previousLandlord.name) || 'N/A';
    var refPhone = (ex.tenant && ex.tenant.previousLandlord && ex.tenant.previousLandlord.phone) || 'N/A';
    var metrics = [
      ['Credit score', m.creditScore != null ? m.creditScore : 'N/A'],
      ['Net income-to-rent', m.netIncomeToRent != null ? m.netIncomeToRent + '\u00d7' : 'N/A'],
      ['Gross income-to-rent', m.grossIncomeToRent != null ? m.grossIncomeToRent + '\u00d7' : 'Unverified'],
      ['Employer', employer],
      ['Collections', m.debtIndicators.collections],
      ['Late payments', lateP],
      ['Rental reference', refName],
      ['Reference phone', refPhone]
    ];
    $('metrics').innerHTML = metrics.map(function (x) {
      return '<div class="metric"><span class="metric-k">' + x[0] + '</span><span class="metric-v">' + escapeHtml(String(x[1])) + '</span></div>';
    }).join('');

    fillList('red-flags', r.redFlags, 'No red flags detected');
    fillList('positives', r.positiveFactors, 'No standout positive factors');
    $('analyst-notes').textContent = r.analystNotes;

    renderExtracted(r.extracted);
    buildPrintReport(r);

    $('results').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function fillList(id, items, emptyMsg) {
    var ul = $(id); ul.innerHTML = '';
    if (!items || !items.length) {
      var li = document.createElement('li'); li.className = 'muted'; li.textContent = emptyMsg; ul.appendChild(li); return;
    }
    items.forEach(function (t) { var li = document.createElement('li'); li.textContent = t; ul.appendChild(li); });
  }

  var FIELD_LABELS = {
    unit: { address: 'Address', unitNumber: 'Unit #', monthlyRent: 'Monthly rent' },
    tenant: { fullName: 'Full name', dateOfBirth: 'Date of birth', currentAddress: 'Current address', phone: 'Phone', email: 'Email' },
    income: { employer: 'Employer', netMonthly: 'Net monthly', grossMonthly: 'Gross monthly',
      payFrequency: 'Pay frequency', ytdEarnings: 'YTD earnings', derivedFrom: 'Derived from', stability: 'Stability' },
    credit: { creditScore: 'Credit score', collections: 'Collections', judgments: 'Judgments', consumerProposals: 'Proposals',
      bankruptcy: 'Bankruptcy', latePayments: 'Late payments', utilization: 'Utilization %', debtObligations: 'Monthly debt' }
  };

  function renderExtracted(ex) {
    var host = $('extracted'); host.innerHTML = '';
    SECTIONS.forEach(function (s) {
      var data = ex[s.key] || {};
      var rows = '';
      if (data._missing) rows = '<div class="ex-row muted">No documents uploaded</div>';
      else if (data._error) rows = '<div class="ex-row muted">Extraction error: ' + escapeHtml(data._error) + '</div>';
      else {
        var labels = FIELD_LABELS[s.key];
        Object.keys(labels).forEach(function (k) {
          var v = data[k];
          if (v === null || v === undefined || v === '') v = '—';
          if (typeof v === 'boolean') v = v ? 'Yes' : 'No';
          rows += '<div class="ex-row"><span>' + labels[k] + '</span><b>' + escapeHtml(String(v)) + '</b></div>';
        });
      }
      host.innerHTML += '<div class="ex-block"><div class="ex-title">' + s.title + '</div>' + rows + '</div>';
    });
  }

  // ---- Printable report (light) ----
  function buildPrintReport(r) {
    var d = new Date(r.generatedAt);
    var when = d.toLocaleString();
    var ex = r.extracted;
    function kv(label, val) { return '<tr><td>' + label + '</td><td>' + escapeHtml(val == null || val === '' ? '—' : String(val)) + '</td></tr>'; }
    function block(title, rowsHtml) { return '<div class="pr-block"><h3>' + title + '</h3><table>' + rowsHtml + '</table></div>'; }

    var unit = ex.unit || {}, t = ex.tenant || {}, inc = ex.income || {}, cr = ex.credit || {};
    var km = r.keyMetrics || {};
    var employer = inc.employer || (t.employment && t.employment.employer) || null;
    var lateP = (cr.latePayments != null) ? cr.latePayments : null;
    var refName = (t.previousLandlord && t.previousLandlord.name) || null;
    var refPhone = (t.previousLandlord && t.previousLandlord.phone) || null;
    var collections = km.debtIndicators ? km.debtIndicators.collections : cr.collections;
    var html =
      '<div class="pr-head"><div class="pr-brand">AI Tenant Analyzer</div><div class="pr-sub">Tenant Screening Report</div>' +
        '<div class="pr-date">' + when + '</div></div>' +
      '<div class="pr-summary">' +
        '<div class="pr-decision pr-' + decisionClass(r.decision) + '">' + r.decision + '</div>' +
        '<div class="pr-score"><b>' + r.score.grade + '</b> &middot; ' + r.score.value + '/100 &middot; ' + r.score.confidence + '% confidence</div>' +
      '</div>' +
      block('Key metrics',
        kv('Credit score', km.creditScore) +
        kv('Net income-to-rent', km.netIncomeToRent != null ? km.netIncomeToRent + '\u00d7' : null) +
        kv('Gross income-to-rent', km.grossIncomeToRent != null ? km.grossIncomeToRent + '\u00d7' : 'Unverified') +
        kv('Employer', employer) +
        kv('Collections', collections) +
        kv('Late payments', lateP) +
        kv('Rental reference name', refName) +
        kv('Rental reference phone', refPhone)) +
      block('Unit information', kv('Address', unit.address) + kv('Unit #', unit.unitNumber) + kv('Monthly rent', unit.monthlyRent != null ? '$' + unit.monthlyRent : null)) +
      block('Tenant information', kv('Full name', t.fullName) + kv('Date of birth', t.dateOfBirth) + kv('Current address', t.currentAddress) + kv('Phone', t.phone) + kv('Email', t.email)) +
      block('Income analysis', kv('Employer', inc.employer) + kv('Net monthly', inc.netMonthly != null ? '$' + inc.netMonthly : null) + kv('Gross monthly', inc.grossMonthly != null ? '$' + inc.grossMonthly : 'Unverified') + kv('Pay frequency', inc.payFrequency) + kv('YTD earnings', inc.ytdEarnings != null ? '$' + inc.ytdEarnings : null) + kv('Derived from', inc.derivedFrom) + kv('Stability', inc.stability)) +
      block('Credit analysis', kv('Credit score', cr.creditScore) + kv('Collections', cr.collections) + kv('Judgments', cr.judgments) + kv('Consumer proposals', cr.consumerProposals) + kv('Bankruptcy', cr.bankruptcy ? 'Yes' : 'No') + kv('Late payments', cr.latePayments) + kv('Utilization', cr.utilization != null ? cr.utilization + '%' : null) + kv('Monthly debt', cr.debtObligations != null ? '$' + cr.debtObligations : null)) +
      '<div class="pr-block"><h3>Score breakdown</h3><table>' +
        kv('Credit (/40)', r.components.credit) + kv('Income (/40)', r.components.income) + kv('Stability (/20)', r.components.employment) + '</table></div>' +
      '<div class="pr-cols"><div class="pr-block"><h3>Red flags</h3>' + listHtml(r.redFlags, 'None detected') + '</div>' +
        '<div class="pr-block"><h3>Positive factors</h3>' + listHtml(r.positiveFactors, 'None') + '</div></div>' +
      '<div class="pr-block"><h3>Analyst summary</h3><p>' + escapeHtml(r.analystNotes) + '</p></div>' +
      '<div class="pr-foot">Generated by AI Tenant Analyzer on ' + when + '. Decision-support only; subject to human review and fair-housing regulations.</div>';
    $('print-report').innerHTML = html;
  }

  function listHtml(items, empty) {
    if (!items || !items.length) return '<p class="pr-muted">' + empty + '</p>';
    return '<ul>' + items.map(function (i) { return '<li>' + escapeHtml(i) + '</li>'; }).join('') + '</ul>';
  }

  function firstSentence(s) { if (!s) return ''; var i = s.indexOf('. '); return i === -1 ? s : s.slice(0, i + 1); }
  function escapeHtml(s) { return String(s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }

  // ---- init ----
  document.addEventListener('DOMContentLoaded', function () {
    buildSections();
    updateAnalyzeState();
    $('analyze-btn').addEventListener('click', analyze);
    $('pdf-btn').addEventListener('click', function () { window.print(); });
    fetch('/api/health').then(function (r) { return r.json(); }).then(function (h) {
      if (h && !h.hasKey) $('demo-banner').hidden = false;
    }).catch(function () {});
  });
})();
