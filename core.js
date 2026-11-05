/* Innovación Clínica · Management app — core logic (no UI).
   Sample data simulation, KPI engine, risk model, recommendations, import.
   Works in the browser (window.IC) and in Node (module.exports) for testing. */
(function (G) {
  'use strict';

  // ---------- Dates as UTC day numbers ----------
  const DAY = 86400000;
  const dn = (y, m, d) => Math.floor(Date.UTC(y, m - 1, d) / DAY);
  const toDate = (n) => new Date(n * DAY);
  const mk = (n) => { const t = toDate(n); return t.getUTCFullYear() * 12 + t.getUTCMonth(); };
  const mkStart = (k) => dn(Math.floor(k / 12), (k % 12) + 1, 1);
  const mkEnd = (k) => mkStart(k + 1) - 1;
  const weekday = (n) => (toDate(n).getUTCDay() + 6) % 7; // 0 = Monday
  const iso = (n) => toDate(n).toISOString().slice(0, 10);
  const fromIso = (s) => { const [y, m, d] = s.split('-').map(Number); return dn(y, m, d); };
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const mkLabel = (k, short) => (short ? MONTHS[k % 12].slice(0, 3) : MONTHS[k % 12]) + (short ? '' : ' ' + Math.floor(k / 12));
  const mkShortYear = (k) => MONTHS[k % 12].slice(0, 3) + ' ' + String(Math.floor(k / 12)).slice(2);
  const dayLabel = (n) => { const t = toDate(n); return t.getUTCDate() + ' ' + MONTHS[t.getUTCMonth()].slice(0, 3) + ' ' + t.getUTCFullYear(); };

  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---------- Status vocabulary (mirrors MN Program agenda states) ----------
  const ST = {
    DONE: 'Realizada', REBOOKED: 'Cancelada refijada', CANCEL: 'Cancelada no refijada',
    NOSHOW: 'No llegó', FUTURE: 'Programada'
  };
  const isLost = (s) => s === ST.CANCEL || s === ST.NOSHOW;

  // ---------- Sample clinic (synthetic) ----------
  const PROFS = {
    imp: [{ name: 'Dra. Vega', cab: 'Gabinete 1' }],
    gen: [{ name: 'Dr. Sol', cab: 'Gabinete 2' }, { name: 'Dra. Prado', cab: 'Gabinete 5' }],
    orto: [{ name: 'Dra. Ruiz', cab: 'Gabinete 3' }],
    endo: [{ name: 'Dr. Marín', cab: 'Gabinete 4' }],
    hyg: [{ name: 'Hig. Lara', cab: 'Gabinete 5' }, { name: 'Hig. Paula', cab: 'Gabinete 3' }]
  };
  const CABS = ['Gabinete 1', 'Gabinete 2', 'Gabinete 3', 'Gabinete 4', 'Gabinete 5'];
  const T = {
    limp: { name: 'LIMPIEZA', cat: 'Higiene', price: 50, role: 'hyg' },
    emp: { name: 'EMPASTE COMPOSITE', cat: 'Conservadora', price: 60, role: 'gen', tooth: true },
    endo: { name: 'ENDODONCIA', cat: 'Endodoncia', price: 180, role: 'endo', tooth: true },
    ext: { name: 'EXTRACCIÓN', cat: 'Cirugía', price: 50, role: 'gen', tooth: true },
    cordal: { name: 'EXTRACCIÓN CORDAL', cat: 'Cirugía', price: 90, role: 'imp', tooth: true },
    corona: { name: 'CORONA ZIRCONIO', cat: 'Prótesis', price: 380, role: 'gen', tooth: true },
    imp: { name: 'IMPLANTE', cat: 'Implantología', price: 900, role: 'imp', tooth: true },
    cimp: { name: 'CORONA SOBRE IMPLANTE', cat: 'Implantología', price: 500, role: 'imp', tooth: true },
    ferula: { name: 'FÉRULA DE DESCARGA', cat: 'Prótesis', price: 260, role: 'gen' },
    ortoIni: { name: 'ORTODONCIA · COLOCACIÓN', cat: 'Ortodoncia', price: 800, role: 'orto' },
    ortoRev: { name: 'REVISIÓN ORTODONCIA', cat: 'Ortodoncia', price: 60, role: 'orto' },
    ortoFin: { name: 'ORTODONCIA · RETIRADA', cat: 'Ortodoncia', price: 300, role: 'orto' },
    blanq: { name: 'BLANQUEAMIENTO', cat: 'Estética', price: 300, role: 'gen' },
    protRem: { name: 'PRÓTESIS REMOVIBLE', cat: 'Prótesis', price: 750, role: 'gen' },
    cur: { name: 'CURETAJE POR CUADRANTE', cat: 'Periodoncia', price: 70, role: 'hyg' }
  };

  function simulate(seed) {
    const r = rng(seed || 20261104);
    const ri = (a, b) => a + Math.floor(r() * (b - a + 1));
    const START = dn(2023, 11, 1), END = dn(2027, 6, 1);
    const patients = [], appts = [], lines = [], pays = [];
    let planSeq = 1;

    const workday = (d) => { const w = weekday(d); return w === 5 ? d + 2 + ri(0, 4) : w === 6 ? d + 1 + ri(0, 4) : d; };
    const tooth = () => [1, 2, 3, 4][ri(0, 3)] * 10 + ri(1, 8);
    const payMethod = () => { const x = r(); return x < 0.6 ? 'Tarjeta' : x < 0.9 ? 'Efectivo' : 'Transferencia'; };

    function pickProf(role, d) {
      if (role === 'endo' && d >= dn(2026, 9, 1) && r() < 0.7) role = 'gen'; // endodontist cuts hours from Sep 2026
      const list = PROFS[role];
      const pr = list[ri(0, list.length - 1)];
      const cab = r() < 0.9 ? pr.cab : CABS[ri(0, CABS.length - 1)];
      return { name: pr.name, cab };
    }
    function outcome(p, d) {
      const mon = weekday(d) === 0;
      if (r() >= Math.min(0.65, p.lp * (mon ? 1.8 : 1) + (mon ? 0.05 : 0) + 0.03)) return ST.DONE;
      const x = r();
      return x < 0.42 ? ST.REBOOKED : x < 0.74 ? ST.CANCEL : ST.NOSHOW;
    }
    function addAppt(p, d, role, desc, type) {
      const pr = pickProf(role, d);
      const st = outcome(p, d);
      appts.push({ pid: p.id, day: d, prof: pr.name, cab: pr.cab, desc, type, status: st });
      return { st, pr };
    }
    function makePlan(hint) {
      const x = hint === 'orto' && r() < 0.6 ? 0.65 : hint === 'imp' && r() < 0.5 ? 0.55 : r();
      const S = (t, g1, g2) => ({ t, gap: ri(g1, g2), tooth: T[t].tooth ? tooth() : null });
      const s = [];
      if (x < 0.36) { if (r() < 0.4) s.push(S('limp', 0, 0)); const n = ri(1, 3); for (let i = 0; i < n; i++) s.push(S('emp', 7, 16)); }
      else if (x < 0.50) { s.push(S('endo', 7, 14), S('corona', 14, 24)); }
      else if (x < 0.62) {
        if (r() < 0.5) s.push(S('ext', 7, 14));
        s.push(S('imp', s.length ? 60 : 10, s.length ? 90 : 25));
        const two = r() < 0.25; if (two) s.push(S('imp', 7, 14));
        s.push(S('cimp', 90, 120)); if (two) s.push(S('cimp', 7, 14));
      }
      else if (x < 0.69) { s.push(S('ortoIni', 10, 21)); const n = ri(10, 14); for (let i = 0; i < n; i++) s.push(S('ortoRev', 28, 35)); s.push(S('ortoFin', 28, 40)); }
      else if (x < 0.77) { for (let i = 0; i < 4; i++) s.push(S('cur', 7, 10)); }
      else if (x < 0.82) s.push(S('protRem', 14, 28));
      else if (x < 0.88) s.push(S('ferula', 10, 20));
      else if (x < 0.93) s.push(S('blanq', 7, 20));
      else s.push(S('cordal', 7, 20));
      return s;
    }
    function runPlan(p, d0, steps) {
      const planId = planSeq++;
      const total = steps.reduce((a, x) => a + T[x.t].price, 0);
      const my = steps.map((x) => {
        const L = { pid: p.id, plan: planId, accept: d0, name: T[x.t].name, cat: T[x.t].cat, price: T[x.t].price, status: 'Pendiente', done: null, prof: null, cab: null, tooth: x.tooth };
        lines.push(L); return L;
      });
      let scheme = 'session';
      if (total >= 1200) { const y = r(); scheme = y < 0.42 ? 'fin' : y < 0.72 ? 'acuenta' : 'session'; }
      else if (total >= 400 && r() < 0.15) scheme = 'acuenta';
      let credit = 0;
      if (scheme === 'fin') { credit = total; pays.push({ pid: p.id, day: workday(d0 + ri(0, 6)), amount: total, method: 'Financiación', concept: 'PAGO A CUENTA · FINANCIACIÓN' }); }
      if (scheme === 'acuenta') { credit = Math.round(total * 0.5 / 10) * 10; pays.push({ pid: p.id, day: d0, amount: credit, method: r() < 0.5 ? 'Transferencia' : 'Tarjeta', concept: 'PAGO A CUENTA' }); }
      let d = d0;
      for (let i = 0; i < steps.length; i++) {
        const st0 = steps[i], t = T[st0.t];
        d = workday(d + st0.gap);
        let tries = 0;
        for (;;) {
          if (d > END) return;
          const { st, pr } = addAppt(p, d, t.role, t.name + (st0.tooth ? ' ' + st0.tooth : ''), 'Tratamiento');
          if (st === ST.DONE) {
            const L = my[i]; L.status = 'Realizado'; L.done = d; L.prof = pr.name; L.cab = pr.cab;
            let due = t.price; const use = Math.min(credit, due); credit -= use; due -= use;
            if (due > 0 && r() > 0.02) pays.push({ pid: p.id, day: d, amount: due, method: payMethod(), concept: t.name });
            break;
          }
          tries++;
          if (st === ST.REBOOKED) { d = workday(d + ri(3, 10)); continue; }
          if (r() < 0.28 + p.lp || tries > 4) return; // patient drops out mid-treatment
          d = workday(d + ri(14, 45));
        }
        if (i < steps.length - 1 && r() < 0.012 + 0.10 * p.lp - (scheme === 'fin' ? 0.006 : 0)) return;
      }
    }
    function recalls(p, d) {
      while (d < END) {
        d = workday(d);
        const { st, pr } = addAppt(p, d, 'hyg', 'REVISIÓN Y LIMPIEZA', 'Revisión');
        if (st === ST.DONE) {
          lines.push({ pid: p.id, plan: planSeq++, accept: d, name: T.limp.name, cat: T.limp.cat, price: T.limp.price, status: 'Realizado', done: d, prof: pr.name, cab: pr.cab, tooth: null });
          pays.push({ pid: p.id, day: d, amount: T.limp.price, method: payMethod(), concept: 'LIMPIEZA' });
          if (r() < 0.22) runPlan(p, d, makePlan());
        }
        if (r() > 0.74) return;
        d += ri(150, 360);
      }
    }
    const newPatient = (id, day) => {
      const p = { id, first: day, age: ri(6, 86), lp: 0.02 + 0.32 * Math.pow(r(), 3) };
      patients.push(p); return p;
    };

    // Existing patient base
    let id = 10000;
    for (let i = 0; i < 10000; i++) {
      const p = newPatient(id++, dn(2008, 1, 1) + ri(0, START - dn(2008, 1, 1) - 1));
      recalls(p, START + ri(0, 365));
    }
    // New patients each month
    const SEASON = [1.1, 1.05, 1.05, 0.95, 1, 0.95, 0.85, 0.55, 1.15, 1.05, 1, 0.8];
    for (let k = mk(START); k < mk(END); k++) {
      const drop = k >= mk(dn(2026, 9, 1)) ? 0.7 : 1; // referral agreement ended in Sep 2026
      const n = Math.round(60 * SEASON[k % 12] * drop * (0.9 + r() * 0.2));
      for (let i = 0; i < n; i++) {
        let d = workday(mkStart(k) + ri(0, 27));
        const p = newPatient(id++, d);
        const x = r(), role = x < 0.15 ? 'orto' : x < 0.35 ? 'imp' : 'gen';
        let { st } = addAppt(p, d, role, 'PRIMERA VISITA', 'Primera visita');
        if (st !== ST.DONE && (st === ST.REBOOKED || r() < 0.5)) { d = workday(d + ri(5, 15)); ({ st } = addAppt(p, d, role, 'PRIMERA VISITA', 'Primera visita')); }
        if (st !== ST.DONE) continue;
        if (r() < 0.64) runPlan(p, d, makePlan(role));
        recalls(p, d + ri(180, 380));
      }
    }
    return { patients, appts, lines, pays };
  }

  // Cut the simulated history at an export date, as an MN export would see it.
  function snapshot(full, asOf, label) {
    const H = asOf + 150;
    const ds = {
      source: 'sample', label: label || 'Sample data', asOf,
      patients: full.patients.filter((p) => p.first <= asOf).map((p) => ({ id: p.id, first: p.first, age: p.age })),
      appts: full.appts.filter((a) => a.day <= H).map((a) => (a.day > asOf ? Object.assign({}, a, { status: ST.FUTURE }) : a)),
      lines: full.lines.filter((l) => l.accept <= asOf).map((l) => (l.done != null && l.done > asOf ? Object.assign({}, l, { status: 'Pendiente', done: null, prof: null, cab: null }) : l)),
      pays: full.pays.filter((p) => p.day <= asOf)
    };
    return prepare(ds);
  }

  // Index by patient; sort by day.
  function prepare(ds) {
    const by = new Map();
    const get = (pid) => { let x = by.get(pid); if (!x) { x = { appts: [], lines: [], pays: [] }; by.set(pid, x); } return x; };
    ds.appts.forEach((a) => get(a.pid).appts.push(a));
    ds.lines.forEach((l) => get(l.pid).lines.push(l));
    ds.pays.forEach((p) => get(p.pid).pays.push(p));
    by.forEach((x) => { x.appts.sort((a, b) => a.day - b.day); x.pays.sort((a, b) => a.day - b.day); });
    ds.by = by;
    ds.lastMonth = mk(ds.asOf + 1) - 1; // latest complete month
    ds.firstMonth = Math.max(mk(Math.min.apply(null, ds.appts.map((a) => a.day).concat([ds.asOf]))), ds.lastMonth - 35);
    const cabs = new Set(); ds.lines.forEach((l) => l.cab && cabs.add(l.cab)); ds.appts.forEach((a) => a.cab && cabs.add(a.cab));
    ds.cabs = Array.from(cabs).sort();
    return ds;
  }

  // ---------- KPI engine (deterministic; the assistant only reads these) ----------
  const inMonth = (d, k) => d != null && d >= mkStart(k) && d <= mkEnd(k);
  function production(ds, k, cab) {
    let s = 0; for (const l of ds.lines) if (l.done != null && inMonth(l.done, k) && (!cab || l.cab === cab)) s += l.price; return s;
  }
  function collections(ds, k) { let s = 0; for (const p of ds.pays) if (inMonth(p.day, k)) s += p.amount; return s; }
  function firstVisits(ds, k) { let n = 0; for (const a of ds.appts) if (a.type === 'Primera visita' && a.status === ST.DONE && inMonth(a.day, k)) n++; return n; }
  function visitStats(ds, k1, k2, filter) {
    const o = { total: 0, done: 0, lost: 0, noShow: 0, cancelled: 0, rebooked: 0 };
    const a0 = mkStart(k1), a1 = mkEnd(k2);
    for (const a of ds.appts) {
      if (a.day < a0 || a.day > a1 || a.status === ST.FUTURE) continue;
      if (filter && !filter(a)) continue;
      o.total++;
      if (a.status === ST.DONE) o.done++;
      else if (a.status === ST.NOSHOW) { o.noShow++; o.lost++; }
      else if (a.status === ST.CANCEL) { o.cancelled++; o.lost++; }
      else if (a.status === ST.REBOOKED) o.rebooked++;
    }
    o.lostRate = o.total ? o.lost / o.total : 0;
    return o;
  }
  function lostByWeekday(ds, k1, k2) {
    return [0, 1, 2, 3, 4].map((w) => Object.assign({ weekday: WEEKDAYS[w], wd: w }, visitStats(ds, k1, k2, (a) => weekday(a.day) === w)));
  }
  function lostByProfessional(ds, k1, k2) {
    const names = Array.from(new Set(ds.appts.map((a) => a.prof).filter(Boolean))).sort();
    return names.map((n) => Object.assign({ professional: n }, visitStats(ds, k1, k2, (a) => a.prof === n)));
  }
  // Patient balance: paid minus value of treatment done, up to a day.
  function balances(ds, day, ids) {
    let unearned = 0, receivable = 0, nU = 0, nR = 0;
    const set = ids ? new Set(ids) : null;
    ds.by.forEach((x, pid) => {
      if (set && !set.has(pid)) return;
      let paid = 0, done = 0;
      for (const p of x.pays) if (p.day <= day) paid += p.amount;
      for (const l of x.lines) if (l.done != null && l.done <= day) done += l.price;
      const b = paid - done;
      if (b > 0.5) { unearned += b; nU++; } else if (b < -0.5) { receivable += -b; nR++; }
    });
    return { unearned, receivable, patientsUnearned: nU, patientsReceivable: nR };
  }
  function treatmentMix(ds, k1, k2) {
    const m = new Map();
    for (const l of ds.lines) {
      if (l.done == null || l.done < mkStart(k1) || l.done > mkEnd(k2)) continue;
      const x = m.get(l.name) || { treatment: l.name, category: l.cat, count: 0, value: 0 };
      x.count++; x.value += l.price; m.set(l.name, x);
    }
    return Array.from(m.values()).sort((a, b) => b.count - a.count || b.value - a.value);
  }
  function topPatients(ds, k1, k2, n) {
    const m = new Map();
    for (const l of ds.lines) if (l.done != null && l.done >= mkStart(k1) && l.done <= mkEnd(k2)) m.set(l.pid, (m.get(l.pid) || 0) + l.price);
    return Array.from(m, ([pid, value]) => ({ patient: pid, value })).sort((a, b) => b.value - a.value).slice(0, n || 10);
  }
  function avg(arr) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0; }

  function overview(ds, k) {
    const prev = k - 1, ly = k - 12;
    const prior6 = []; for (let i = 1; i <= 6; i++) prior6.push(firstVisits(ds, k - i));
    const endDay = Math.min(mkEnd(k), ds.asOf);
    const bal = balances(ds, endDay), balPrev = balances(ds, mkEnd(prev));
    const vs = visitStats(ds, k, k), vsPrev = visitStats(ds, prev, prev);
    return {
      month: mkLabel(k), production: production(ds, k), productionPrevMonth: production(ds, prev), productionSameMonthLastYear: production(ds, ly),
      collections: collections(ds, k), collectionsPrevMonth: collections(ds, prev),
      unearnedRevenue: bal.unearned, unearnedPatients: bal.patientsUnearned, unearnedPrevMonthEnd: balPrev.unearned,
      receivable: bal.receivable, receivablePatients: bal.patientsReceivable,
      firstVisits: firstVisits(ds, k), firstVisitsAvgPrior6: Math.round(avg(prior6) * 10) / 10,
      visits: vs.total, lostVisits: vs.lost, lostRate: vs.lostRate, lostRatePrevMonth: vsPrev.lostRate,
      noShows: vs.noShow, cancelledNotRebooked: vs.cancelled, cancelledRebooked: vs.rebooked,
      balanceDate: iso(endDay)
    };
  }
  function series(ds, metric, n) {
    const out = [];
    for (let k = ds.lastMonth - (n || 12) + 1; k <= ds.lastMonth; k++) {
      const v = metric === 'collections' ? collections(ds, k) : metric === 'first_visits' ? firstVisits(ds, k) : metric === 'lost_rate' ? visitStats(ds, k, k).lostRate : production(ds, k);
      out.push({ month: mkShortYear(k), k, value: v });
    }
    return out;
  }

  // ---------- Risk model: probability that a patient with accepted, unfinished treatment does not progress within 90 days ----------
  const FEATURES = ['Days since last attended visit', 'Appointment booked in next 3 weeks', 'Lost visits in last 12 months', 'Share of plan already done', 'Treatment financed', 'Size of pending treatment'];
  function features(x, S) {
    let pending = 0, done = 0, paid = 0, fin = false, lastAtt = -1, lost12 = 0, future = false, nextDay = null, lastAccept = -1;
    for (const l of x.lines) {
      if (l.accept > S) continue;
      if (l.done != null && l.done <= S) done += l.price;
      else if (l.status !== 'Cancelado') { pending += l.price; if (l.accept > lastAccept) lastAccept = l.accept; }
    }
    if (pending <= 0) return null;
    for (const a of x.appts) {
      if (a.day <= S) { if (a.status === ST.DONE) lastAtt = a.day; if (a.day > S - 365 && isLost(a.status)) lost12++; }
      else if (a.day <= S + 21) { future = true; if (nextDay == null) nextDay = a.day; }
    }
    for (const p of x.pays) if (p.day <= S) { paid += p.amount; if (p.method === 'Financiación') fin = true; }
    const days = lastAtt < 0 ? 365 : Math.min(365, S - lastAtt);
    // Dormant: no attended visit and no newly accepted treatment for 12 months. Reported apart, not scored.
    const dormant = !future && (lastAtt < 0 || S - lastAtt > 365) && S - lastAccept > 365;
    return {
      dormant,
      v: [days / 365, future ? 1 : 0, Math.min(lost12, 5) / 5, done / (done + pending), fin ? 1 : 0, Math.log10(pending) / 4],
      pending, done, paid, prepaid: Math.max(0, paid - done), days, future, lost12, fin, nextDay
    };
  }
  const sigmoid = (z) => 1 / (1 + Math.exp(-z));
  function auc(scores, labels) {
    const idx = scores.map((s, i) => i).sort((a, b) => scores[a] - scores[b]);
    let rank = 0, sumPos = 0, nPos = 0, nNeg = 0;
    for (let i = 0; i < idx.length;) {
      let j = i; while (j < idx.length && scores[idx[j]] === scores[idx[i]]) j++;
      const avgRank = (i + j + 1) / 2;
      for (let t = i; t < j; t++) if (labels[idx[t]]) { sumPos += avgRank; nPos++; } else nNeg++;
      rank = j; i = j;
    }
    return nPos && nNeg ? (sumPos - nPos * (nPos + 1) / 2) / (nPos * nNeg) : 0.5;
  }
  const ruleScore = (f) => (!f.future && f.days > 60 ? 1 : 0);
  function trainRisk(ds) {
    const rows = [];
    for (let j = 0; j <= 12; j++) {
      const S = ds.asOf - 90 - 30 * j;
      ds.by.forEach((x) => {
        const f = features(x, S); if (!f || f.dormant) return;
        let y = 1; for (const l of x.lines) if (l.done != null && l.done > S && l.done <= S + 90) { y = 0; break; }
        rows.push({ j, f, y });
      });
    }
    const train = rows.filter((r) => r.j >= 1), test = rows.filter((r) => r.j === 0);
    const w = new Array(FEATURES.length + 1).fill(0);
    if (train.length < 50) return null;
    const lr = 0.8, l2 = 0.001, n = train.length;
    for (let it = 0; it < 600; it++) {
      const g = new Array(w.length).fill(0);
      for (const r of train) {
        let z = w[0]; for (let i = 0; i < r.f.v.length; i++) z += w[i + 1] * r.f.v[i];
        const e = sigmoid(z) - r.y; g[0] += e; for (let i = 0; i < r.f.v.length; i++) g[i + 1] += e * r.f.v[i];
      }
      for (let i = 0; i < w.length; i++) w[i] -= lr * (g[i] / n + (i ? l2 * w[i] : 0));
    }
    const predict = (f) => { let z = w[0]; for (let i = 0; i < f.v.length; i++) z += w[i + 1] * f.v[i]; return sigmoid(z); };
    const ps = test.map((r) => predict(r.f)), ys = test.map((r) => r.y), rs = test.map((r) => ruleScore(r.f));
    const base = avg(ys);
    const topN = Math.max(1, Math.round(test.length * 0.2));
    const top = ps.map((p, i) => [p, ys[i]]).sort((a, b) => b[0] - a[0]).slice(0, topN);
    const ruleFlag = test.filter((r) => ruleScore(r.f) === 1);
    return {
      weights: w, predict,
      trainRows: train.length, testRows: test.length, testDate: iso(ds.asOf - 90),
      aucModel: auc(ps, ys), aucRule: auc(rs, ys), baseRate: base,
      precisionTop20Model: avg(top.map((t) => t[1])),
      precisionRule: ruleFlag.length ? avg(ruleFlag.map((r) => r.y)) : 0, ruleFlagShare: test.length ? ruleFlag.length / test.length : 0
    };
  }
  function dormantPlans(ds) {
    const o = { patients: 0, pending: 0, prepaid: 0 };
    ds.by.forEach((x) => { const f = features(x, ds.asOf); if (f && f.dormant) { o.patients++; o.pending += f.pending; o.prepaid += f.prepaid; } });
    return o;
  }
  function riskList(ds, model) {
    const out = [];
    ds.by.forEach((x, pid) => {
      const f = features(x, ds.asOf); if (!f || f.dormant) return;
      const p = model ? model.predict(f) : (ruleScore(f) ? 0.7 : 0.2);
      const reasons = [];
      if (!f.future) reasons.push('No appointment booked');
      if (f.days > 60) reasons.push(f.days >= 365 ? 'No visit in over a year' : 'No visit in ' + f.days + ' days');
      if (f.lost12 >= 2) reasons.push(f.lost12 + ' missed or cancelled visits this year');
      if (f.done / (f.done + f.pending) < 0.25) reasons.push('Less than a quarter of the plan done');
      if (f.fin) reasons.push('Financed treatment');
      out.push({ patient: pid, probability: p, tier: p >= 0.6 ? 'High' : p >= 0.3 ? 'Medium' : 'Low', pending: f.pending, prepaid: f.prepaid, daysSinceVisit: f.days, booked: f.future, lostVisits12m: f.lost12, expectedLoss: p * f.pending, reasons });
    });
    return out.sort((a, b) => b.expectedLoss - a.expectedLoss);
  }

  // ---------- Recommendations (rules over KPIs and model output) ----------
  const eur = (n) => new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(Math.round(n));
  const pct = (x) => (x * 100).toFixed(1).replace('.', ',') + '%';
  function recommendations(ds, model, risk) {
    const recs = [], k = ds.lastMonth, tag = iso(ds.asOf);
    // 1. Unfinished, prepaid treatment at risk
    const high = risk.filter((r) => r.tier === 'High');
    if (high.length) {
      const top = high.slice().sort((a, b) => b.prepaid - a.prepaid || b.pending - a.pending).slice(0, 25);
      const prepaidTop = top.reduce((a, r) => a + r.prepaid, 0), pendingTop = top.reduce((a, r) => a + r.pending, 0);
      recs.push({
        id: 'risk:' + tag, kind: 'risk', priority: 1,
        title: 'Call ' + top.length + ' patients who are likely to abandon their treatment',
        evidence: high.length + ' patients have a high risk (60% or more) of not continuing their treatment in the next 90 days. The ' + top.length + ' with most money at stake have ' + eur(pendingTop) + ' of accepted treatment not yet done, of which ' + eur(prepaidTop) + ' is already paid.',
        action: 'Reception calls these ' + top.length + ' patients this week, starting with those who paid most, and offers a date for their next session.',
        impact: 'If one in three books and continues, about ' + eur(pendingTop / 3) + ' of treatment would be completed. This is an assumption to check at review.',
        metric: { type: 'prepaid_ids', ids: top.map((r) => r.patient), label: 'Paid but unfinished treatment of these ' + top.length + ' patients', fmt: 'eur', better: 'down' }
      });
    }
    // 2. Lost visits concentrated on one weekday
    const wd = lostByWeekday(ds, k - 2, k), all = visitStats(ds, k - 2, k);
    const worst = wd.slice().sort((a, b) => b.lostRate - a.lostRate)[0];
    const others = visitStats(ds, k - 2, k, (a) => weekday(a.day) !== worst.wd);
    if (worst.total >= 60 && worst.lostRate >= others.lostRate * 1.3) {
      const excess = Math.round((worst.lostRate - others.lostRate) * worst.total / 3);
      recs.push({
        id: 'lost:' + worst.wd + ':' + tag, kind: 'lost', priority: 2,
        title: 'Cut lost visits on ' + worst.weekday + 's',
        evidence: 'From ' + mkLabel(k - 2, true) + ' to ' + mkLabel(k, true) + ', ' + pct(worst.lostRate) + ' of ' + worst.weekday + ' visits were lost (no-show or cancelled without a new date), against ' + pct(others.lostRate) + ' on other days. That is about ' + excess + ' extra lost visits a month.',
        action: 'Confirm every ' + worst.weekday + ' appointment by WhatsApp or phone on the previous Friday, and offer the slot to a waiting patient when someone cancels.',
        impact: 'Bringing ' + worst.weekday + 's to the average of other days would recover about ' + excess + ' visits a month.',
        metric: { type: 'lost_weekday', wd: worst.wd, label: 'Lost-visit rate on ' + worst.weekday + 's (latest month)', fmt: 'pct', better: 'down' }
      });
    }
    // 3. First visits falling
    const fvRecent = avg([firstVisits(ds, k), firstVisits(ds, k - 1)]);
    const fvPrior = avg([2, 3, 4, 5, 6, 7].map((i) => firstVisits(ds, k - i)));
    if (fvPrior > 0 && fvRecent <= fvPrior * 0.88) {
      const firstDay = new Map(ds.patients.filter((p) => p.first != null && p.first >= mkStart(k - 13) && p.first <= mkEnd(k - 6)).map((p) => [p.id, p.first]));
      let val = 0; for (const l of ds.lines) { const f = firstDay.get(l.pid); if (f != null && l.accept <= f + 183) val += l.price; }
      const perPatient = firstDay.size ? val / firstDay.size : 0;
      recs.push({
        id: 'acq:' + tag, kind: 'acq', priority: 3,
        title: 'First visits are falling',
        evidence: firstVisits(ds, k) + ' first visits in ' + mkLabel(k, true) + ' and ' + firstVisits(ds, k - 1) + ' in ' + mkLabel(k - 1, true) + ', against an average of ' + Math.round(fvPrior) + ' a month in the six months before (' + pct(fvRecent / fvPrior - 1) + ').',
        action: 'Review where new patients come from (referrals, insurers, website, word of mouth) and restart the channel that dropped.',
        impact: 'Each new patient accepted about ' + eur(perPatient) + ' of treatment on average in their first six months.',
        metric: { type: 'first_visits', label: 'First visits (latest month)', fmt: 'int', better: 'up' }
      });
    }
    // 4. A treatment room producing less than usual
    let worstCab = null;
    for (const c of ds.cabs) {
      const recent = avg([production(ds, k, c), production(ds, k - 1, c)]);
      const prior = avg([2, 3, 4, 5, 6, 7].map((i) => production(ds, k - i, c)));
      if (prior > 2000) { const ch = recent / prior - 1; if (!worstCab || ch < worstCab.ch) worstCab = { c, ch, recent, prior }; }
    }
    if (worstCab && worstCab.ch <= -0.15) {
      recs.push({
        id: 'cab:' + worstCab.c + ':' + tag, kind: 'cab', priority: 4,
        title: worstCab.c + ' is producing less than usual',
        evidence: worstCab.c + ' produced ' + eur(worstCab.recent) + ' a month in ' + mkLabel(k - 1, true) + '–' + mkLabel(k, true) + ', against ' + eur(worstCab.prior) + ' a month in the six months before (' + pct(worstCab.ch) + ').',
        action: 'Check the ' + worstCab.c + ' schedule: free hours, absences and which professionals use it. Give idle hours to the professionals with the longest waiting lists.',
        impact: 'Returning to its usual level would add about ' + eur(worstCab.prior - worstCab.recent) + ' of production a month.',
        metric: { type: 'cab_prod', cab: worstCab.c, label: worstCab.c + ' production (latest month)', fmt: 'eur', better: 'up' }
      });
    }
    // 5. Treatment done but not paid
    const bal = balances(ds, ds.asOf);
    if (bal.receivable > 2500) {
      recs.push({
        id: 'ar:' + tag, kind: 'ar', priority: 5,
        title: 'Collect treatment that was done but not paid',
        evidence: bal.patientsReceivable + ' patients owe a total of ' + eur(bal.receivable) + ' for treatment already done.',
        action: 'Accounting sends a reminder to each patient and reception asks for payment at their next visit.',
        impact: 'Collecting half would bring in about ' + eur(bal.receivable / 2) + '.',
        metric: { type: 'receivable', label: 'Treatment done but not paid', fmt: 'eur', better: 'down' }
      });
    }
    return recs.sort((a, b) => a.priority - b.priority);
  }
  function evalMetric(ds, m) {
    const k = ds.lastMonth;
    if (m.type === 'prepaid_ids') { const set = new Set(m.ids); let s = 0; ds.by.forEach((x, pid) => { if (!set.has(pid)) return; let paid = 0, done = 0; for (const p of x.pays) paid += p.amount; for (const l of x.lines) if (l.done != null) done += l.price; s += Math.max(0, paid - done); }); return s; }
    if (m.type === 'lost_weekday') return visitStats(ds, k, k, (a) => weekday(a.day) === m.wd).lostRate;
    if (m.type === 'first_visits') return firstVisits(ds, k);
    if (m.type === 'cab_prod') return production(ds, k, m.cab);
    if (m.type === 'receivable') return balances(ds, ds.asOf).receivable;
    return null;
  }

  // ---------- Import (MN Program / Excel exports) ----------
  const norm = (s) => String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  function parseDay(v) {
    if (v == null || v === '') return null;
    if (v instanceof Date && !isNaN(v)) return dn(v.getFullYear(), v.getMonth() + 1, v.getDate());
    if (typeof v === 'number' && v > 20000 && v < 80000) return v - 25569; // Excel serial
    const s = String(v).trim();
    let m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
    if (m) { let y = +m[3]; if (y < 100) y += 2000; return dn(y, +m[2], +m[1]); }
    m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) return dn(+m[1], +m[2], +m[3]);
    return null;
  }
  function parseNum(v) {
    if (typeof v === 'number') return v;
    if (v == null) return 0;
    let s = String(v).replace(/[€\s]/g, '');
    if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
    const n = parseFloat(s); return isNaN(n) ? 0 : n;
  }
  function pick(row, names) {
    for (const k of Object.keys(row)) { const n = norm(k); if (names.includes(n)) return row[k]; }
    return undefined;
  }
  const COLS = {
    patient: ['numero paciente', 'n paciente', 'paciente', 'numero', 'id paciente', 'patient'],
    date: ['fecha', 'fecha cita', 'date'],
    status: ['estado', 'status'],
    treatment: ['tratamiento', 'descripcion tratamiento', 'treatment'],
    amount: ['importe', 'total', 'amount']
  };
  function detect(headers) {
    const h = headers.map(norm);
    const has = (x) => h.some((c) => x.includes(c));
    if (has(['tratamiento', 'treatment']) && has(['importe', 'total', 'precio', 'amount'])) return 'lines';
    if (has(['forma de cobro', 'forma cobro', 'metodo de pago', 'fecha cobro'])) return 'pays';
    if (has(['estado', 'status']) && has(['fecha', 'fecha cita', 'date'])) return 'appts';
    if (has(['fecha alta', 'alta'])) return 'patients';
    return null;
  }
  function fromTables(tables, label) {
    const ds = { source: 'import', label: label || 'Imported data', patients: [], appts: [], lines: [], pays: [] };
    const warn = [];
    const pid = (r) => { const v = pick(r, COLS.patient); const n = parseInt(String(v).replace(/\D/g, ''), 10); return isNaN(n) ? null : n; };
    for (const t of tables) {
      if (t.kind === 'patients') t.rows.forEach((r) => { const id = pid(r); if (id != null) ds.patients.push({ id, first: parseDay(pick(r, ['fecha alta', 'alta'])), age: parseNum(pick(r, ['edad', 'age'])) || null }); });
      if (t.kind === 'appts') t.rows.forEach((r) => {
        const id = pid(r), day = parseDay(pick(r, COLS.date)); if (id == null || day == null) return;
        const desc = String(pick(r, ['descripcion', 'description', 'motivo']) || '');
        const tipo = norm(pick(r, ['tipo', 'tipo cita', 'type']) || '');
        let status = String(pick(r, COLS.status) || '').trim();
        const sn = norm(status);
        status = sn.includes('refijada') && !sn.includes('no refijada') ? ST.REBOOKED : sn.includes('no refijada') || sn === 'cancelada' ? ST.CANCEL : sn.includes('no lleg') || sn.includes('no contesta') ? ST.NOSHOW : sn.includes('realizada') || sn.includes('consulta') || sn.includes('sala') ? ST.DONE : ST.FUTURE;
        const type = tipo.includes('primera') || norm(desc).includes('primera visita') ? 'Primera visita' : tipo.includes('revision') ? 'Revisión' : 'Tratamiento';
        ds.appts.push({ pid: id, day, prof: String(pick(r, ['profesional', 'doctor', 'usuario']) || ''), cab: String(pick(r, ['gabinete', 'cabinet', 'sala']) || ''), desc, type, status });
      });
      if (t.kind === 'lines') t.rows.forEach((r, i) => {
        const id = pid(r); if (id == null) return;
        const done = parseDay(pick(r, ['fecha realizacion', 'fecha realizado', 'realizado el', 'done date']));
        const st = norm(pick(r, COLS.status) || (done != null ? 'realizado' : 'pendiente'));
        ds.lines.push({ pid: id, plan: pick(r, ['presupuesto', 'n presupuesto', 'plan']) || i, accept: parseDay(pick(r, ['fecha aceptacion', 'fecha presupuesto', 'fecha'])) || done, name: String(pick(r, COLS.treatment) || '').toUpperCase(), cat: String(pick(r, ['categoria', 'especialidad', 'category']) || ''), price: parseNum(pick(r, ['importe', 'total', 'precio', 'amount'])), status: st.includes('cancel') ? 'Cancelado' : (st.includes('realiz') && done != null) ? 'Realizado' : 'Pendiente', done: st.includes('realiz') ? done : null, prof: String(pick(r, ['profesional', 'doctor', 'usuario']) || ''), cab: String(pick(r, ['gabinete', 'cabinet']) || '') || null });
      });
      if (t.kind === 'pays') t.rows.forEach((r) => {
        const id = pid(r), day = parseDay(pick(r, ['fecha cobro', 'fecha', 'date'])); if (id == null || day == null) return;
        ds.pays.push({ pid: id, day, amount: parseNum(pick(r, ['importe', 'total', 'amount'])), method: String(pick(r, ['forma de cobro', 'forma cobro', 'metodo de pago']) || ''), concept: String(pick(r, ['concepto', 'concept']) || '') });
      });
    }
    if (!ds.appts.length) warn.push('No appointments table found: lost visits and first visits will be empty.');
    if (!ds.lines.length) warn.push('No treatments table found: production, treatment mix and risk need it.');
    if (!ds.pays.length) warn.push('No payments table found: collections and unearned revenue need it.');
    const days = [].concat(ds.appts.filter((a) => a.status !== ST.FUTURE).map((a) => a.day), ds.pays.map((p) => p.day), ds.lines.filter((l) => l.done != null).map((l) => l.done));
    if (!days.length) throw new Error('No dated rows found. Check that the files have the expected columns.');
    ds.asOf = Math.max.apply(null, days);
    if (!ds.patients.length) { const ids = new Set(); ds.appts.forEach((a) => ids.add(a.pid)); ds.lines.forEach((l) => ids.add(l.pid)); ids.forEach((id) => ds.patients.push({ id, first: null, age: null })); }
    prepare(ds);
    ds.warnings = warn;
    return ds;
  }

  const DEFINITIONS = {
    production: 'Production: value (list price) of treatment marked as done in the month, by date done. This is revenue earned.',
    collections: 'Collections: money received in the month (card, cash, transfer, financing), by payment date.',
    unearned: 'Unearned revenue (paid but not yet done): for each patient, payments received minus value of treatment done, counted when positive, at the end of the period. Calculated per patient because MN Program does not link payments to specific treatments.',
    receivable: 'Done but not paid: for each patient, value of treatment done minus payments, counted when positive.',
    firstVisits: 'First visits: attended appointments of type "Primera visita" in the month.',
    lostVisits: 'Lost visits: no-shows plus cancellations without a new date, as a share of all appointments in the period. Cancellations with a new date (refijadas) are not lost.',
    cabinet: 'Production by treatment room: production of treatment done in each room (gabinete).',
    risk: 'Risk: a logistic regression trained on this clinic\'s own history estimates the probability that a patient with accepted, unfinished treatment completes nothing in the next 90 days. Inputs: days since last attended visit, whether an appointment is booked in the next 3 weeks, lost visits in the last 12 months, share of the plan already done, financing, and size of the pending treatment.'
  };

  const IC = {
    dn, iso, fromIso, mk, mkStart, mkEnd, mkLabel, mkShortYear, dayLabel, weekday, WEEKDAYS, ST, FEATURES, DEFINITIONS,
    simulate, snapshot, prepare, overview, series, production, collections, firstVisits, visitStats, lostByWeekday, lostByProfessional,
    balances, treatmentMix, topPatients, trainRisk, riskList, dormantPlans, recommendations, evalMetric, detect, fromTables, eur, pct
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = IC; else G.IC = IC;
})(typeof window !== 'undefined' ? window : globalThis);
