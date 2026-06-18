// scoring.js
// AI Tenant Analyzer — deterministic scoring engine (Section 5 of the master spec).
// Pure functions only. Claude (extraction) supplies RAW data; this engine does ALL math/grading.
// UMD wrapper at the bottom: identical behavior in Node (module.exports) and the browser (window.TenantScoring).

(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TenantScoring = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var clamp = function (n, lo, hi) { return Math.max(lo, Math.min(hi, n)); };
  var num = function (v, d) { d = d === undefined ? 0 : d; return (typeof v === 'number' && !Number.isNaN(v)) ? v : d; };

  // 1) CREDIT PROFILE — 40 points
  function scoreCredit(credit) {
    credit = credit || {};
    var s = credit.beaconScore;
    var base;
    if (s == null) base = 0;            // DECISION: unknown beacon scores 0 AND lowers confidence.
    else if (s >= 800) base = 40;
    else if (s >= 750) base = 37;
    else if (s >= 700) base = 34;
    else if (s >= 650) base = 28;
    else if (s >= 600) base = 20;
    else if (s >= 550) base = 10;
    else base = 0;

    var late = num(credit.latePayments);
    var collections = num(credit.collections);
    var pts = base - late * 1 - collections * 5;
    if (credit.consumerProposal) pts -= 15;
    if (credit.bankruptcy) pts -= 25;

    var severe = (collections > 0 ? 1 : 0) + (credit.consumerProposal ? 1 : 0) + (credit.bankruptcy ? 1 : 0);
    return { points: clamp(pts, 0, 40), base: base, highRisk: severe >= 2,
      breakdown: { base: base, late: late, collections: collections,
        consumerProposal: !!credit.consumerProposal, bankruptcy: !!credit.bankruptcy } };
  }

  // 2) INCOME QUALIFICATION — 40 points
  var REQUIRED_NET_MULT = 2.0;
  var REQUIRED_GROSS_MULT = 2.5;

  function scoreIncome(income, rent) {
    income = income || {};
    var net = income.netMonthly, gross = income.grossMonthly;
    if (!rent || rent <= 0 || net == null) {
      return { points: 0, base: 0, grossBonus: 0, netRatio: null, grossRatio: null,
        meetsNet: false, meetsGross: false, grossVerified: gross != null,
        required: { netDollars: rent ? Math.round(rent * REQUIRED_NET_MULT) : null,
          grossDollars: rent ? Math.round(rent * REQUIRED_GROSS_MULT) : null } };
    }
    var netRatio = net / rent, base;
    if (netRatio >= 3.0) base = 40;
    else if (netRatio >= 2.75) base = 36;
    else if (netRatio >= 2.5) base = 32;
    else if (netRatio >= 2.25) base = 25;
    else if (netRatio >= 2.0) base = 20;
    else base = 0;

    var grossRatio = (gross != null && gross > 0) ? gross / rent : null, grossBonus = 0;
    if (grossRatio != null) {
      if (grossRatio >= 3.0) grossBonus = 5;
      else if (grossRatio >= 2.75) grossBonus = 3;
      else if (grossRatio >= 2.5) grossBonus = 1;
    }
    return { points: clamp(base + grossBonus, 0, 40), base: base, grossBonus: grossBonus,
      netRatio: netRatio, grossRatio: grossRatio, grossVerified: grossRatio != null,
      meetsNet: netRatio >= REQUIRED_NET_MULT,
      meetsGross: grossRatio == null ? null : grossRatio >= REQUIRED_GROSS_MULT,
      required: { netDollars: Math.round(rent * REQUIRED_NET_MULT), grossDollars: Math.round(rent * REQUIRED_GROSS_MULT) } };
  }

  // 3) EMPLOYMENT & STABILITY — 20 points
  function scoreEmployment(emp) {
    emp = emp || {};
    var verified = emp.verified === true, y = emp.years;
    var unverified = !verified || y == null;   // DECISION: boundaries -> higher tier (>= top-down)
    var base;
    if (unverified) base = 5;                  // DECISION: unverified length -> conservative lowest tier
    else if (y >= 5) base = 20;
    else if (y >= 3) base = 17;
    else if (y >= 2) base = 15;
    else if (y >= 1) base = 10;
    else base = 5;

    var adj = 0;
    if (!unverified) {
      if (emp.type === 'full_time') adj += 2;
      if (emp.type === 'government') adj += 2;
      if (emp.type === 'self_employed' && emp.selfEmployedStrongDocs) adj += 1;
    }
    if (emp.frequentJobChanges) adj -= 3;
    if (emp.type === 'contract') adj -= 2;
    return { points: clamp(base + adj, 0, 20), base: base, adjustment: adj, unverified: unverified };
  }

  function toGrade(total) {
    if (total >= 95) return 'A+';
    if (total >= 90) return 'A';
    if (total >= 85) return 'B+';
    if (total >= 80) return 'B';
    if (total >= 70) return 'C+';
    if (total >= 60) return 'C';
    return 'D';
  }

  function computeConfidence(ctx) {
    var c = 100, reasons = [];
    var ded = function (cond, amt, why) { if (cond) { c -= amt; reasons.push(why); } };
    ded(ctx.missingProperty, 8, 'missing property info');
    ded(ctx.missingCredit, 20, 'missing credit data');
    ded(ctx.missingIncome, 20, 'missing income data');
    ded(ctx.grossUnverified, 5, 'gross income unverified');
    ded(ctx.employmentUnverified, 8, 'unverified employment length');
    ded(ctx.lowScanQuality, 10, 'low-quality scans');
    ded(ctx.missingPages, 8, 'missing pages');
    ded(ctx.inconsistent, 12, 'inconsistent information');
    ded(ctx.irregularIncome, 6, 'irregular income');
    return { confidence: clamp(Math.round(c), 0, 100), reasons: reasons };
  }

  function buildTriggers(c) {
    var t = [];
    if (num(c.credit.collections) > 0) t.push('Collections detected');
    if (c.credit.consumerProposal) t.push('Consumer proposal');
    if (c.credit.bankruptcy) t.push('Bankruptcy');
    if (c.income.meetsNet === false || c.income.meetsGross === false) t.push('Income below requirements');
    if (num(c.credit.latePayments) >= 2) t.push('Multiple late payments'); // DECISION: "multiple" = >= 2
    if (c.employment.unverified) t.push('Unverified employment');
    if (c.docs.missingProperty || c.docs.missingCredit || c.docs.missingIncome) t.push('Missing documents');
    if (c.docs.inconsistent) t.push('Inconsistent information');
    if (c.docs.fraudIndicators) t.push('Potential fraud indicators');
    return t;
  }

  function buildRedFlags(c) {
    var f = [];
    if (num(c.credit.collections) > 0) f.push('Collections');
    if (c.credit.bankruptcy) f.push('Bankruptcy');
    if (c.credit.consumerProposal) f.push('Consumer Proposal');
    if (c.income.meetsNet === false || c.income.meetsGross === false) f.push('Income Deficiency');
    if (c.employment.unverified || c.employment.points <= 5) f.push('Unstable Employment');
    if (c.bank && num(c.bank.nsfCount) >= 3) f.push('Multiple NSF Events');
    return f;
  }

  function decideRecommendation(c) {
    if (c.credit.bankruptcy || c.credit.consumerProposal || c.income.meetsNet === false || c.grade === 'D')
      return 'REJECTED';
    if (c.triggers.length > 0) return 'MANUAL REVIEW';
    if (c.total >= 85) return 'APPROVED';
    if (c.total >= 70) return 'APPROVED WITH CONDITIONS';
    return 'MANUAL REVIEW'; // DECISION: clean 60-69 -> Manual Review (spec left this gap)
  }

  var titleCase = function (s) { return s.toLowerCase().replace(/\b\w/g, function (m) { return m.toUpperCase(); }); };

  function buildExplanation(c) {
    var bits = [];
    if (c.credit.beaconScore != null) bits.push('a ' + c.credit.beaconScore + ' beacon score');
    var derog = (num(c.credit.collections) ? 1 : 0) + (c.credit.bankruptcy ? 1 : 0) + (c.credit.consumerProposal ? 1 : 0);
    bits.push(derog === 0 ? 'no derogatory events' : derog + ' derogatory item(s)');
    if (c.income.netRatio != null) bits.push('net income at ' + c.income.netRatio.toFixed(1) + '\u00d7 rent');
    bits.push(c.employment.unverified ? 'unverified employment' : 'verified employment');
    var article = /^[AEIOU]/.test(c.grade) ? 'an' : 'a';
    var s1 = 'Applicant receives ' + article + ' ' + c.grade + ' (' + c.total + '/100) based on ' + bits.join(', ') + '.';
    var s2 = ' Recommendation: ' + titleCase(c.recommendation) + '.';
    var s3 = c.triggers.length ? ' Flagged for: ' + c.triggers.join(', ') + '.' : '';
    return (s1 + s2 + s3).trim();
  }

  function analyze(input) {
    input = input || {};
    var rent = num(input.rent, 0);
    var credit = input.credit || {}, income = input.income || {}, employment = input.employment || {};
    var bank = input.bank || { present: false }, docs = input.docs || {};

    var creditR = scoreCredit(credit);
    var incomeR = scoreIncome(income, rent);
    var empR = scoreEmployment(employment);

    var total = Math.round(creditR.points + incomeR.points + empR.points);
    var grade = toGrade(total);

    var missingProperty = docs.hasProperty === false;
    var missingCredit = docs.hasCredit === false || credit.beaconScore == null;
    var missingIncome = docs.hasIncome === false || income.netMonthly == null;

    var triggers = buildTriggers({
      credit: { collections: num(credit.collections), latePayments: num(credit.latePayments),
        consumerProposal: credit.consumerProposal, bankruptcy: credit.bankruptcy },
      income: { meetsNet: incomeR.meetsNet, meetsGross: incomeR.meetsGross },
      employment: empR,
      docs: { missingProperty: missingProperty, missingCredit: missingCredit, missingIncome: missingIncome,
        inconsistent: !!docs.inconsistent, fraudIndicators: !!docs.fraudIndicators }
    });

    var redFlags = buildRedFlags({
      credit: { collections: num(credit.collections), bankruptcy: credit.bankruptcy, consumerProposal: credit.consumerProposal },
      income: { meetsNet: incomeR.meetsNet, meetsGross: incomeR.meetsGross },
      employment: empR, bank: bank
    });

    var recommendation = decideRecommendation({
      total: total, grade: grade, income: { meetsNet: incomeR.meetsNet }, credit: credit, triggers: triggers
    });

    var conf = computeConfidence({
      missingProperty: missingProperty, missingCredit: missingCredit, missingIncome: missingIncome,
      grossUnverified: incomeR.grossVerified === false, employmentUnverified: empR.unverified,
      lowScanQuality: !!docs.lowScanQuality, missingPages: !!docs.missingPages,
      inconsistent: !!docs.inconsistent, irregularIncome: !!income.irregular
    });

    var explanation = buildExplanation({
      grade: grade, total: total,
      credit: { beaconScore: credit.beaconScore == null ? null : credit.beaconScore,
        collections: num(credit.collections), bankruptcy: credit.bankruptcy, consumerProposal: credit.consumerProposal },
      income: incomeR, employment: empR, recommendation: recommendation, triggers: triggers
    });

    return {
      rent: rent, score: total, grade: grade,
      confidence: conf.confidence, confidenceReasons: conf.reasons,
      recommendation: recommendation, explanation: explanation,
      components: { credit: creditR.points, income: incomeR.points, employment: empR.points },
      detail: { credit: creditR, income: incomeR, employment: empR },
      triggers: triggers, redFlags: redFlags,
      manualReviewRequired: triggers.length > 0 || recommendation === 'MANUAL REVIEW'
    };
  }

  return {
    analyze: analyze, scoreCredit: scoreCredit, scoreIncome: scoreIncome, scoreEmployment: scoreEmployment,
    toGrade: toGrade, computeConfidence: computeConfidence, decideRecommendation: decideRecommendation,
    REQUIRED_NET_MULT: REQUIRED_NET_MULT, REQUIRED_GROSS_MULT: REQUIRED_GROSS_MULT
  };
});
