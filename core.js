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

  // ---------- Sample clinic (synthetic, sized like Innovación Clínica: ~€75k/month, 4 rooms, 7 dentists, 4 hygienists) ----------
  const PROFS = {
    imp: [{ name: 'Dra. Vega', cab: 'Gabinete 1' }],
    gen: [{ name: 'Dr. Sol', cab: 'Gabinete 2' }, { name: 'Dra. Prado', cab: 'Gabinete 2' }, { name: 'Dr. Lobo', cab: 'Gabinete 1' }, { name: 'Dra. Núñez', cab: 'Gabinete 2', from: dn(2026, 2, 1) }],
    orto: [{ name: 'Dra. Ruiz', cab: 'Gabinete 3' }],
    endo: [{ name: 'Dr. Marín', cab: 'Gabinete 3' }],
    hyg: [{ name: 'Hig. Lara', cab: 'Gabinete 4' }, { name: 'Hig. Paula', cab: 'Gabinete 4' }, { name: 'Hig. Irene', cab: 'Gabinete 4' }, { name: 'Hig. Marta', cab: 'Gabinete 3' }]
  };
  const CABS = ['Gabinete 1', 'Gabinete 2', 'Gabinete 3', 'Gabinete 4'];
  // cost: direct material / laboratory cost per treatment in 2023 euros (rises about 6% a year).
  const T = {
    limp: { name: 'LIMPIEZA', cat: 'Higiene', price: 50, cost: 3, role: 'hyg' },
    emp: { name: 'EMPASTE COMPOSITE', cat: 'Conservadora', price: 60, cost: 8, role: 'gen', tooth: true },
    endo: { name: 'ENDODONCIA', cat: 'Endodoncia', price: 180, cost: 20, role: 'endo', tooth: true },
    ext: { name: 'EXTRACCIÓN', cat: 'Cirugía', price: 50, cost: 5, role: 'gen', tooth: true },
    cordal: { name: 'EXTRACCIÓN CORDAL', cat: 'Cirugía', price: 90, cost: 10, role: 'imp', tooth: true },
    corona: { name: 'CORONA ZIRCONIO', cat: 'Prótesis', price: 380, cost: 130, role: 'gen', tooth: true },
    imp: { name: 'IMPLANTE', cat: 'Implantología', price: 900, cost: 260, role: 'imp', tooth: true },
    cimp: { name: 'CORONA SOBRE IMPLANTE', cat: 'Implantología', price: 500, cost: 170, role: 'imp', tooth: true },
    ferula: { name: 'FÉRULA DE DESCARGA', cat: 'Prótesis', price: 260, cost: 70, role: 'gen' },
    ortoIni: { name: 'ORTODONCIA · COLOCACIÓN', cat: 'Ortodoncia', price: 800, cost: 220, role: 'orto' },
    ortoRev: { name: 'REVISIÓN ORTODONCIA', cat: 'Ortodoncia', price: 60, cost: 4, role: 'orto' },
    ortoFin: { name: 'ORTODONCIA · RETIRADA', cat: 'Ortodoncia', price: 300, cost: 60, role: 'orto' },
    blanq: { name: 'BLANQUEAMIENTO', cat: 'Estética', price: 300, cost: 45, role: 'gen' },
    protRem: { name: 'PRÓTESIS REMOVIBLE', cat: 'Prótesis', price: 750, cost: 230, role: 'gen' },
    cur: { name: 'CURETAJE POR CUADRANTE', cat: 'Periodoncia', price: 70, cost: 5, role: 'hyg' }
  };
  // Events in the sample history that mirror the 2026 decisions described in the report.
  const EVENTS = {
    promoFrom: dn(2026, 3, 1), promoTo: dn(2026, 6, 30), // orthodontics and implant offer: 15% off
    reviewsFrom: dn(2026, 4, 1), // Google reviews incentive
    newDentist: dn(2026, 2, 1), // Dra. Núñez joins
    endoCut: dn(2026, 9, 1), // endodontist reduces hours
    referralEnd: dn(2026, 9, 1) // a referral agreement ends: fewer new patients
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
    const inflation = (d) => 1 + 0.06 * Math.max(0, (d - dn(2023, 1, 1)) / 365);
    const inPromo = (d) => d >= EVENTS.promoFrom && d <= EVENTS.promoTo;

    function pickProf(role, d) {
      if (role === 'endo' && d >= EVENTS.endoCut && r() < 0.7) role = 'gen';
      const list = PROFS[role].filter((p) => !p.from || d >= p.from);
      const pr = list[ri(0, list.length - 1)];
      const cab = r() < 0.92 ? pr.cab : CABS[ri(0, CABS.length - 1)];
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
    function makePlan(hint, d) {
      const promo = inPromo(d);
      let x = hint === 'orto' && r() < 0.6 ? 0.65 : hint === 'imp' && r() < 0.5 ? 0.55 : r();
      if (promo && r() < 0.18) x = r() < 0.5 ? 0.55 : 0.65; // the offer pulls demand to implants and orthodontics
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
      const disc = (t) => (inPromo(d0) && (T[t].cat === 'Implantología' || T[t].cat === 'Ortodoncia') ? 0.85 : 1);
      const priceOf = (x) => Math.round(T[x.t].price * disc(x.t));
      const total = steps.reduce((a, x) => a + priceOf(x), 0);
      const my = steps.map((x) => {
        const L = { pid: p.id, plan: planId, accept: d0, name: T[x.t].name, cat: T[x.t].cat, price: priceOf(x), cost: null, status: 'Pendiente', done: null, prof: null, cab: null, tooth: x.tooth };
        lines.push(L); return L;
      });
      let scheme = 'session';
      if (total >= 600) { const y = r(); scheme = y < 0.62 ? 'fin' : y < 0.82 ? 'acuenta' : 'session'; }
      else if (total >= 300 && r() < 0.2) scheme = 'acuenta';
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
            const L = my[i]; L.status = 'Realizado'; L.done = d; L.prof = pr.name; L.cab = pr.cab; L.cost = Math.round(t.cost * inflation(d));
            let due = L.price; const use = Math.min(credit, due); credit -= use; due -= use;
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
          lines.push({ pid: p.id, plan: planSeq++, accept: d, name: T.limp.name, cat: T.limp.cat, price: T.limp.price, cost: Math.round(T.limp.cost * inflation(d)), status: 'Realizado', done: d, prof: pr.name, cab: pr.cab, tooth: null });
          pays.push({ pid: p.id, day: d, amount: T.limp.price, method: payMethod(), concept: 'LIMPIEZA' });
          if (r() < (inPromo(d) ? 0.26 : 0.2)) runPlan(p, d, makePlan(null, d));
        }
        if (r() > 0.8) return;
        d += ri(150, 360);
      }
    }
    const newPatient = (id, day) => {
      const p = { id, first: day, age: ri(6, 86), lp: 0.02 + 0.32 * Math.pow(r(), 3) };
      patients.push(p); return p;
    };

    // Existing patient base
    let id = 10000;
    for (let i = 0; i < 4300; i++) {
      const p = newPatient(id++, dn(2008, 1, 1) + ri(0, START - dn(2008, 1, 1) - 1));
      recalls(p, START + ri(0, 365));
    }
    // New patients each month (about 50 first visits a month in 2026)
    const SEASON = [1.1, 1.05, 1.05, 0.95, 1, 0.95, 0.85, 0.55, 1.15, 1.05, 1, 0.8];
    for (let k = mk(START); k < mk(END); k++) {
      const d1 = mkStart(k);
      const trend = 0.9 + 0.1 * Math.min(1, Math.max(0, (d1 - START) / 900)); // slow growth
      const reviews = d1 >= EVENTS.reviewsFrom && d1 < EVENTS.referralEnd ? 1.08 : 1;
      const drop = d1 >= EVENTS.referralEnd ? 0.65 : 1;
      const n = Math.round(52 * SEASON[k % 12] * trend * reviews * drop * (0.9 + r() * 0.2));
      for (let i = 0; i < n; i++) {
        let d = workday(d1 + ri(0, 27));
        const p = newPatient(id++, d);
        const x = r(), role = x < 0.15 ? 'orto' : x < 0.35 ? 'imp' : 'gen';
        let { st } = addAppt(p, d, role, 'PRIMERA VISITA', 'Primera visita');
        if (st !== ST.DONE && (st === ST.REBOOKED || r() < 0.5)) { d = workday(d + ri(5, 15)); ({ st } = addAppt(p, d, role, 'PRIMERA VISITA', 'Primera visita')); }
        if (st !== ST.DONE) continue;
        if (r() < (inPromo(d) ? 0.72 : 0.64)) runPlan(p, d, makePlan(role, d));
        recalls(p, d + ri(180, 380));
      }
    }
    return { patients, appts, lines, pays };
  }

  // Cut the simulated history at an export date, as an MN export would see it.
  // decisions (optional): call results recorded in the app; the simulation lets booked patients come back.
  function snapshot(full, asOf, label, decisions) {
    const H = asOf + 150;
    const ds = {
      source: 'sample', label: label || 'Sample data', asOf,
      patients: full.patients.filter((p) => p.first <= asOf).map((p) => ({ id: p.id, first: p.first, age: p.age })),
      appts: full.appts.filter((a) => a.day <= H).map((a) => (a.day > asOf ? Object.assign({}, a, { status: ST.FUTURE }) : a)),
      lines: full.lines.filter((l) => l.accept <= asOf).map((l) => (l.done != null && l.done > asOf ? Object.assign({}, l, { status: 'Pendiente', done: null, prof: null, cab: null, cost: null }) : l)),
      pays: full.pays.filter((p) => p.day <= asOf)
    };
    ds.simulatedCalls = simulateCallEffects(ds, decisions);
    return prepare(ds);
  }
  // Sample data only: a patient whose call ended in "Booked" gets an appointment 7–20 days later and,
  // in 75% of cases, attends it and completes the next pending treatment. Other call results change nothing.
  function simulateCallEffects(ds, decisions) {
    let n = 0;
    for (const d of decisions || []) {
      if (d.kind !== 'risk' || !d.calls || d.decision === 'Rejected') continue;
      const d0 = fromIso(d.decidedOn);
      for (const [id, c] of Object.entries(d.calls)) {
        if (!c || c.result !== 'Booked') continue;
        const pid = Number(id), r = rng(pid * 7919 + d0);
        const day = d0 + 7 + Math.floor(r() * 14), attends = r() < 0.75;
        const idx = ds.lines.findIndex((l) => l.pid === pid && l.done == null && l.status === 'Pendiente' && l.accept <= d0);
        if (idx < 0) continue;
        const L = ds.lines[idx];
        if (day > ds.asOf) { ds.appts.push({ pid, day, prof: 'Dr. Sol', cab: 'Gabinete 2', desc: L.name, type: 'Tratamiento', status: ST.FUTURE }); n++; continue; }
        ds.appts.push({ pid, day, prof: 'Dr. Sol', cab: 'Gabinete 2', desc: L.name, type: 'Tratamiento', status: attends ? ST.DONE : ST.NOSHOW });
        if (attends) ds.lines[idx] = Object.assign({}, L, { status: 'Realizado', done: day, prof: 'Dr. Sol', cab: 'Gabinete 2', cost: Math.round(L.price * 0.27) });
        n++;
      }
    }
    return n;
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
    ds.hasPatientDates = ds.patients.some((p) => p.first != null);
    const profs = new Set(); ds.lines.forEach((l) => l.prof && profs.add(l.prof));
    ds.profs = Array.from(profs).sort();
    ds.lineCats = Array.from(new Set(ds.lines.map((l) => l.cat).filter(Boolean))).sort();
    ds.lastMonth = mk(ds.asOf + 1) - 1; // latest complete month
    ds.firstMonth = Math.max(mk(Math.min.apply(null, ds.appts.map((a) => a.day).concat([ds.asOf]))), ds.lastMonth - 35);
    const cabs = new Set(); ds.lines.forEach((l) => l.cab && cabs.add(l.cab)); ds.appts.forEach((a) => a.cab && cabs.add(a.cab));
    ds.cabs = Array.from(cabs).sort();
    return ds;
  }

  // ---------- KPI engine (deterministic; the assistant only reads these) ----------
  const inMonth = (d, k) => d != null && d >= mkStart(k) && d <= mkEnd(k);
  function production(ds, k, cab, prof, line) {
    let s = 0;
    for (const l of ds.lines) if (l.done != null && inMonth(l.done, k) && (!cab || l.cab === cab) && (!prof || l.prof === prof) && (!line || l.cat === line)) s += l.price;
    return s;
  }
  function collections(ds, k) { let s = 0; for (const p of ds.pays) if (inMonth(p.day, k)) s += p.amount; return s; }
  // New patients: patient files opened in the month (MN "Fecha Alta"). Falls back to labelled first-visit
  // appointments when the patient table has no registration dates.
  function firstVisits(ds, k) {
    let n = 0;
    if (ds.hasPatientDates) { for (const p of ds.patients) if (inMonth(p.first, k)) n++; return n; }
    for (const a of ds.appts) if (a.type === 'Primera visita' && a.status === ST.DONE && inMonth(a.day, k)) n++;
    return n;
  }
  const isHygienist = (name) => /^hig/i.test(String(name || ''));
  // Direct cost (materials and laboratory) of treatment done in the month; null when the data has no costs.
  function directCost(ds, k, filter) {
    let c = 0, any = false;
    for (const l of ds.lines) if (l.done != null && inMonth(l.done, k) && (!filter || filter(l))) { if (l.cost != null) { c += l.cost; any = true; } }
    return any ? c : null;
  }
  function marginPct(ds, k, filter) {
    let p = 0; for (const l of ds.lines) if (l.done != null && inMonth(l.done, k) && (!filter || filter(l))) p += l.price;
    const c = directCost(ds, k, filter);
    return c == null || !p ? null : (p - c) / p;
  }
  function productionBy(ds, k, field) {
    const m = new Map();
    for (const l of ds.lines) if (l.done != null && inMonth(l.done, k) && l[field]) m.set(l[field], (m.get(l[field]) || 0) + l.price);
    return m;
  }
  // Treatment lines (categories) over k1..k2: count, production, margin, and change against the same months a year earlier.
  function treatmentLines(ds, k1, k2) {
    const cur = new Map(), prev = new Map();
    const add = (m, l) => { const x = m.get(l.cat) || { line: l.cat, count: 0, production: 0, cost: 0, hasCost: false }; x.count++; x.production += l.price; if (l.cost != null) { x.cost += l.cost; x.hasCost = true; } m.set(l.cat, x); };
    for (const l of ds.lines) {
      if (l.done == null || !l.cat) continue;
      if (l.done >= mkStart(k1) && l.done <= mkEnd(k2)) add(cur, l);
      else if (l.done >= mkStart(k1 - 12) && l.done <= mkEnd(k2 - 12)) add(prev, l);
    }
    return Array.from(cur.values()).map((x) => {
      const p = prev.get(x.line);
      return { line: x.line, count: x.count, production: x.production, marginPct: x.hasCost && x.production ? (x.production - x.cost) / x.production : null, productionLastYear: p ? p.production : 0, change: p && p.production ? x.production / p.production - 1 : null };
    }).sort((a, b) => b.production - a.production);
  }
  // How much of what managers need is actually recorded in the loaded data (last three months).
  function dataQuality(ds) {
    const k1 = ds.lastMonth - 2, a0 = mkStart(k1), a1 = Math.min(mkEnd(ds.lastMonth), ds.asOf);
    let past = 0, withOutcome = 0, cancelled = 0;
    for (const a of ds.appts) { if (a.day < a0 || a.day > a1) continue; past++; if (a.status !== ST.FUTURE) withOutcome++; if (a.status === ST.CANCEL || a.status === ST.REBOOKED || a.status === ST.NOSHOW) cancelled++; }
    let lines = 0, withProf = 0, withCost = 0;
    for (const l of ds.lines) { if (l.done == null || l.done < a0 || l.done > a1) continue; lines++; if (l.prof) withProf++; if (l.cost != null) withCost++; }
    return { appointments: past, outcomeRecorded: past ? withOutcome / past : null, cancellationsRecorded: cancelled, treatmentsDone: lines, professionalRecorded: lines ? withProf / lines : null, costRecorded: lines ? withCost / lines : null, patientDates: !!ds.hasPatientDates };
  }
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
    const prod = production(ds, k), cost = directCost(ds, k);
    return {
      month: mkLabel(k), production: prod, productionPrevMonth: production(ds, prev), productionSameMonthLastYear: production(ds, ly),
      directCost: cost, margin: cost == null ? null : prod - cost, marginPct: marginPct(ds, k), marginPctSameMonthLastYear: marginPct(ds, ly),
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
  const FEATURES = ['Days since last attended visit', 'Appointment booked in next 3 weeks', 'Lost visits in last 12 months', 'Share of plan already done', 'Treatment financed', 'Size of pending treatment', 'Called by the clinic in the last 30 days'];
  // cdays: days on which the clinic called this patient (from call outcomes in the decision log)
  function features(x, S, cdays) {
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
    const contacted = !!(cdays && cdays.some((d) => d <= S && d > S - 30));
    const days = lastAtt < 0 ? 365 : Math.min(365, S - lastAtt);
    // Dormant: no attended visit and no newly accepted treatment for 12 months. Reported apart, not scored.
    const dormant = !future && (lastAtt < 0 || S - lastAtt > 365) && S - lastAccept > 365;
    return {
      dormant,
      v: [days / 365, future ? 1 : 0, Math.min(lost12, 5) / 5, done / (done + pending), fin ? 1 : 0, Math.log10(pending) / 4, contacted ? 1 : 0],
      pending, done, paid, prepaid: Math.max(0, paid - done), days, future, lost12, fin, nextDay, contacted
    };
  }
  const sigmoid = (z) => 1 / (1 + Math.exp(-z));
  function auc(scores, labels) {
    const idx = scores.map((s, i) => i).sort((a, b) => scores[a] - scores[b]);
    let sumPos = 0, nPos = 0, nNeg = 0;
    for (let i = 0; i < idx.length;) {
      let j = i; while (j < idx.length && scores[idx[j]] === scores[idx[i]]) j++;
      const avgRank = (i + j + 1) / 2;
      for (let t = i; t < j; t++) if (labels[idx[t]]) { sumPos += avgRank; nPos++; } else nNeg++;
      i = j;
    }
    return nPos && nNeg ? (sumPos - nPos * (nPos + 1) / 2) / (nPos * nNeg) : 0.5;
  }
  // The simple non-AI alternative: no appointment booked and no visit in 60 days.
  const ruleScore = (f) => (!f.future && f.days > 60 ? 1 : 0);
  // contacts: Map patient -> [days called]. Retrained on every import and whenever call outcomes change.
  function trainRisk(ds, contacts) {
    const rows = [];
    for (let j = 0; j <= 12; j++) {
      const S = ds.asOf - 90 - 30 * j;
      ds.by.forEach((x, pid) => {
        const f = features(x, S, contacts && contacts.get(pid)); if (!f || f.dormant) return;
        let y = 1; for (const l of x.lines) if (l.done != null && l.done > S && l.done <= S + 90) { y = 0; break; }
        rows.push({ j, f, y });
      });
    }
    const train = rows.filter((r) => r.j >= 1), test = rows.filter((r) => r.j === 0);
    const w = new Array(FEATURES.length + 1).fill(0);
    if (train.length < 50 || !test.length) return null;
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
    // Rule probabilities, estimated from the training period, used if the model does not beat the rule.
    const trFlag = train.filter((r) => ruleScore(r.f) === 1), trOther = train.filter((r) => ruleScore(r.f) === 0);
    const ruleRates = { flagged: trFlag.length ? avg(trFlag.map((r) => r.y)) : 0.7, other: trOther.length ? avg(trOther.map((r) => r.y)) : 0.2 };
    const aucModel = auc(ps, ys), aucRule = auc(rs, ys);
    const useRule = aucModel <= aucRule;
    const score = (f) => (useRule ? (ruleScore(f) ? ruleRates.flagged : ruleRates.other) : predict(f));
    // Calls made: share of training cases that had a recent call, and what the model learned about them.
    const contactedRows = train.filter((r) => r.f.contacted);
    return {
      weights: w, predict, score, useRule, ruleRates,
      trainRows: train.length, testRows: test.length, testDate: iso(ds.asOf - 90),
      aucModel, aucRule, baseRate: base,
      precisionTop20Model: avg(top.map((t) => t[1])),
      precisionRule: ruleFlag.length ? avg(ruleFlag.map((r) => r.y)) : 0, ruleFlagShare: test.length ? ruleFlag.length / test.length : 0,
      // Calibration on the held-out month: does the average predicted risk match what happened?
      calibration: { predictedMean: avg(ps), observedRate: base, predictedTop20: avg(top.map((t) => t[0])), observedTop20: avg(top.map((t) => t[1])) },
      calls: { trainingCases: contactedRows.length, stallRateCalled: contactedRows.length ? avg(contactedRows.map((r) => r.y)) : null, weight: w[7] }
    };
  }
  function dormantPlans(ds) {
    const o = { patients: 0, pending: 0, prepaid: 0 };
    ds.by.forEach((x) => { const f = features(x, ds.asOf); if (f && f.dormant) { o.patients++; o.pending += f.pending; o.prepaid += f.prepaid; } });
    return o;
  }
  function riskList(ds, model, contacts) {
    const out = [];
    ds.by.forEach((x, pid) => {
      const f = features(x, ds.asOf, contacts && contacts.get(pid)); if (!f || f.dormant) return;
      const p = model ? model.score(f) : (ruleScore(f) ? 0.7 : 0.2);
      const reasons = [];
      if (!f.future) reasons.push('No appointment booked');
      if (f.days > 60) reasons.push(f.days >= 365 ? 'No visit in over a year' : 'No visit in ' + f.days + ' days');
      if (f.lost12 >= 2) reasons.push(f.lost12 + ' missed or cancelled visits this year');
      if (f.done / (f.done + f.pending) < 0.25) reasons.push('Less than a quarter of the plan done');
      if (f.fin) reasons.push('Financed treatment');
      if (f.contacted) reasons.push('Called in the last 30 days');
      out.push({ patient: pid, probability: p, tier: p >= 0.6 ? 'High' : p >= 0.3 ? 'Medium' : 'Low', pending: f.pending, prepaid: f.prepaid, daysSinceVisit: f.days, booked: f.future, lostVisits12m: f.lost12, contacted: f.contacted, expectedLoss: p * f.pending, reasons });
    });
    return out.sort((a, b) => b.expectedLoss - a.expectedLoss);
  }

  // ---------- Learning from the decision log ----------
  const CALLED = ['Booked', 'Declined', 'No answer'];
  // Days on which each patient was called, taken from call outcomes recorded on follow-up decisions.
  function contactsFrom(decisions) {
    const m = new Map();
    for (const d of decisions || []) {
      if (d.kind !== 'risk' || !d.calls) continue;
      const day = fromIso(d.decidedOn);
      for (const [id, c] of Object.entries(d.calls)) {
        if (!c || !CALLED.includes(c.result)) continue;
        const pid = Number(id), cd = c.day ? fromIso(c.day) : day;
        if (!m.has(pid)) m.set(pid, []);
        m.get(pid).push(cd);
      }
    }
    return m;
  }
  const progressedSince = (ds, pid, d0) => { const x = ds.by.get(pid); return !!(x && x.lines.some((l) => l.done != null && l.done > d0 && l.done <= ds.asOf)); };
  // Turns the decision log into what the next recommendations use: track record per kind and
  // the measured response of patients on follow-up call lists.
  function learnFromDecisions(ds, decisions) {
    const byKind = {};
    const fu = { decisions: 0, observed: 0, continued: 0, callsRecorded: 0, booked: 0, reached: { n: 0, continued: 0 }, notReached: { n: 0, continued: 0 } };
    const expectations = [];
    for (const d of decisions || []) {
      const s = byKind[d.kind] || (byKind[d.kind] = { decided: 0, accepted: 0, rejected: 0, reviewed: 0, worked: 0, partly: 0, improvements: [] });
      s.decided++;
      if (d.decision === 'Rejected') { s.rejected++; continue; }
      s.accepted++;
      // Managers' own expectations against what happened (for decisions logged with an expected change).
      if (d.expected && d.expected.pct && d.metric && d.metric.type !== 'prepaid_ids') {
        const ev = evalDecision(ds, d);
        if (ev.change != null && ev.afterMonths >= 1) expectations.push({ title: d.title, expected: d.expected.pct, achieved: ev.change, afterMonths: ev.afterMonths });
      }
      if (d.outcome) {
        s.reviewed++;
        if (d.outcome.verdict === 'Worked') s.worked++; else if (d.outcome.verdict === 'Partly') s.partly++;
        if (d.baseline && d.baseline.value) s.improvements.push((d.outcome.value - d.baseline.value) / d.baseline.value * (d.metric.better === 'down' ? -1 : 1));
      }
      if (d.kind === 'risk' && d.metric && d.metric.ids) {
        const d0 = fromIso(d.decidedOn), mature = ds.asOf >= d0 + 28;
        fu.decisions++;
        for (const pid of d.metric.ids) {
          const c = d.calls && d.calls[pid];
          if (c && CALLED.includes(c.result)) { fu.callsRecorded++; if (c.result === 'Booked') fu.booked++; }
          if (!mature) continue;
          const prog = progressedSince(ds, pid, d0);
          fu.observed++; if (prog) fu.continued++;
          if (c && (c.result === 'Booked' || c.result === 'Declined')) { fu.reached.n++; if (prog) fu.reached.continued++; }
          else if (c && c.result === 'No answer') { fu.notReached.n++; if (prog) fu.notReached.continued++; }
        }
      }
    }
    for (const k in byKind) {
      const s = byKind[k];
      s.avgImprovement = s.improvements.length ? avg(s.improvements) : null;
      s.successRate = s.reviewed ? (s.worked + 0.5 * s.partly) / s.reviewed : null;
      s.rejectionRate = s.decided ? s.rejected / s.decided : 0;
    }
    fu.continuedRate = fu.observed ? fu.continued / fu.observed : null;
    fu.bookedRate = fu.callsRecorded ? fu.booked / fu.callsRecorded : null;
    fu.reachedRate = fu.reached.n ? fu.reached.continued / fu.reached.n : null;
    fu.notReachedRate = fu.notReached.n ? fu.notReached.continued / fu.notReached.n : null;
    const ratios = expectations.map((e) => e.achieved / e.expected);
    const exp = { n: expectations.length, items: expectations, avgRealised: ratios.length ? avg(ratios) : null };
    return { byKind, followUp: fu, expectations: exp };
  }
  // Predicted vs observed for the patients on a follow-up decision (model monitoring).
  function followUpCheck(ds, d) {
    if (!d.predictions || !d.predictions.length) return null;
    const d0 = fromIso(d.decidedOn);
    let stalled = 0;
    for (const p of d.predictions) if (!progressedSince(ds, p.id, d0)) stalled++;
    return { patients: d.predictions.length, predictedStall: d.predictions.reduce((a, p) => a + p.p, 0), observedStall: stalled, daysElapsed: ds.asOf - d0, complete: ds.asOf - d0 >= 90 };
  }

  // ---------- Recommendations (rules over KPIs and model output) ----------
  const eur = (n) => new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(Math.round(n));
  const pct = (x) => (x * 100).toFixed(1).replace('.', ',') + '%';
  function recommendations(ds, model, risk, learned) {
    const recs = [], k = ds.lastMonth, tag = iso(ds.asOf);
    const fu = learned && learned.followUp;
    // 1. Unfinished, prepaid treatment at risk (patients called in the last 30 days are left out)
    const high = risk.filter((r) => r.tier === 'High' && !r.contacted);
    if (high.length) {
      const top = high.slice().sort((a, b) => b.prepaid - a.prepaid || b.pending - a.pending).slice(0, 25);
      const prepaidTop = top.reduce((a, r) => a + r.prepaid, 0), pendingTop = top.reduce((a, r) => a + r.pending, 0);
      // Expected effect: the clinic's own measured response once there is enough history, otherwise a stated assumption.
      let rate = 1 / 3, impact;
      if (fu && fu.observed >= 10) {
        rate = fu.continuedRate;
        impact = 'Measured on ' + fu.observed + ' patients from ' + fu.decisions + ' earlier follow-up decision' + (fu.decisions > 1 ? 's' : '') + ': ' + pct(rate) + ' continued their treatment afterwards. Applied to this list, about ' + eur(pendingTop * rate) + ' of treatment would be completed.';
        if (fu.reachedRate != null && fu.notReachedRate != null) impact += ' Patients reached by phone continued in ' + pct(fu.reachedRate) + ' of cases, against ' + pct(fu.notReachedRate) + ' for those who did not answer.';
      } else {
        impact = 'If one in three books and continues, about ' + eur(pendingTop / 3) + ' of treatment would be completed. This is an assumption until the first follow-up decision has been reviewed; after that the app uses the measured rate.';
      }
      recs.push({
        id: 'risk:' + tag, kind: 'risk', priority: 1,
        title: 'Call ' + top.length + ' patients who are likely to abandon their treatment',
        evidence: high.length + ' patients have a high risk (60% or more) of not continuing their treatment in the next 90 days' + (risk.some((r) => r.contacted) ? ', not counting patients already called in the last 30 days' : '') + '. The ' + top.length + ' with most money at stake have ' + eur(pendingTop) + ' of accepted treatment not yet done, of which ' + eur(prepaidTop) + ' is already paid.',
        action: 'Reception calls these ' + top.length + ' patients this week, starting with those who paid most, offers a date for their next session, and records each call result in the app.',
        impact, expectedRate: rate,
        predictions: top.map((r) => ({ id: r.patient, p: Math.round(r.probability * 1000) / 1000 })),
        metric: { type: 'prepaid_ids', ids: top.map((r) => r.patient), label: 'Paid but unfinished treatment of these ' + top.length + ' patients', fmt: 'eur', better: 'down' }
      });
    }
    // 2. Marketing: new patients falling
    const fvRecent = avg([firstVisits(ds, k), firstVisits(ds, k - 1)]);
    const fvPrior = avg([2, 3, 4, 5, 6, 7].map((i) => firstVisits(ds, k - i)));
    if (fvPrior > 0 && fvRecent <= fvPrior * 0.88) {
      const firstDay = new Map(ds.patients.filter((p) => p.first != null && p.first >= mkStart(k - 13) && p.first <= mkEnd(k - 6)).map((p) => [p.id, p.first]));
      let val = 0; for (const l of ds.lines) { const f = firstDay.get(l.pid); if (f != null && l.accept <= f + 183) val += l.price; }
      const perPatient = firstDay.size ? val / firstDay.size : 0;
      recs.push({
        id: 'acq:' + tag, kind: 'acq', priority: 2,
        title: 'New patients are falling',
        evidence: firstVisits(ds, k) + ' new patients in ' + mkLabel(k, true) + ' and ' + firstVisits(ds, k - 1) + ' in ' + mkLabel(k - 1, true) + ', against an average of ' + Math.round(fvPrior) + ' a month in the six months before (' + pct(fvRecent / fvPrior - 1) + ').',
        action: 'Check where new patients came from in the last months (referrals, reviews, website, insurers) and decide which channel to reinforce. Log the marketing action here with the number of new patients you expect.',
        impact: 'Each new patient accepted about ' + eur(perPatient) + ' of treatment in their first six months, so ' + Math.round(fvPrior - fvRecent) + ' fewer new patients a month is about ' + eur((fvPrior - fvRecent) * perPatient) + ' of future treatment a month.',
        metric: { type: 'new_patients', label: 'New patients per month', fmt: 'int', better: 'up' }
      });
    }
    // 3. Hiring and dentist performance
    const dentists = ds.profs.filter((p) => !isHygienist(p));
    let worstDentist = null;
    for (const p of dentists) {
      const recent = avg([production(ds, k, null, p), production(ds, k - 1, null, p)]);
      const prior = avg([2, 3, 4, 5, 6, 7].map((i) => production(ds, k - i, null, p)));
      const lastYear = avg([production(ds, k - 12, null, p), production(ds, k - 13, null, p)]);
      // Flag only drops against both the recent past and the same months last year, so a promotion or season does not trigger it.
      if (prior >= 2000) {
        const ch = recent / prior - 1, chLy = lastYear ? recent / lastYear - 1 : ch;
        if (chLy <= -0.25 && (!worstDentist || ch < worstDentist.ch)) worstDentist = { p, ch, recent, prior };
      }
    }
    if (worstDentist && worstDentist.ch <= -0.25) {
      recs.push({
        id: 'dentist:' + worstDentist.p + ':' + tag, kind: 'dentist', priority: 3,
        title: worstDentist.p + ' is producing much less than usual',
        evidence: worstDentist.p + ' produced ' + eur(worstDentist.recent) + ' a month in ' + mkLabel(k - 1, true) + '–' + mkLabel(k, true) + ', against ' + eur(worstDentist.prior) + ' a month in the six months before (' + pct(worstDentist.ch) + ').',
        action: 'The CEO and owner-dentist review ' + worstDentist.p + "'s hours and patient flow and decide whether to change the rota or find cover for the lost hours.",
        impact: 'Returning to the usual level would add about ' + eur(worstDentist.prior - worstDentist.recent) + ' of production a month.',
        metric: { type: 'dentist_production', prof: worstDentist.p, label: 'Production of ' + worstDentist.p + ' per month', fmt: 'eur', better: 'up' }
      });
    }
    // A dentist who joined in the last 12 months: is the hire paying off?
    for (const p of dentists) {
      let firstDone = null; for (const l of ds.lines) if (l.prof === p && l.done != null && (firstDone == null || l.done < firstDone)) firstDone = l.done;
      if (firstDone == null || firstDone < ds.asOf - 365 || firstDone > ds.asOf - 120) continue;
      const months = []; for (let i = mk(firstDone) + 1; i <= k; i++) months.push(production(ds, i, null, p));
      const own = avg(months.slice(-3));
      const others = dentists.filter((q) => q !== p).map((q) => avg([0, 1, 2].map((i) => production(ds, k - i, null, q))));
      const othersAvg = avg(others);
      recs.push({
        id: 'hire:' + p + ':' + tag, kind: 'dentist', priority: 3,
        title: 'Review the new dentist: ' + p,
        evidence: p + ' started in ' + mkLabel(mk(firstDone)) + '. In the last three months ' + p + ' produced ' + eur(own) + ' a month; the other dentists averaged ' + eur(othersAvg) + '.',
        action: 'Compare this production with ' + p + "'s salary and hours, and decide whether to keep, extend or change the role. Log the decision with the production you expect.",
        impact: 'Gives the hiring decision a measured result instead of perceived demand.',
        metric: { type: 'dentist_production', prof: p, label: 'Production of ' + p + ' per month', fmt: 'eur', better: 'up' }
      });
    }
    // 4. Treatment lines to promote: high margin but falling volume
    const tl = treatmentLines(ds, k - 2, k).filter((x) => x.production >= 3000 && x.marginPct != null && x.change != null);
    // The line where the most margin (in euros) was lost against last year.
    const lostMargin = (x) => (x.productionLastYear - x.production) * x.marginPct;
    const cand = tl.filter((x) => x.change <= -0.1).sort((a, b) => lostMargin(b) - lostMargin(a))[0];
    if (cand) {
      recs.push({
        id: 'line:' + cand.line + ':' + tag, kind: 'line', priority: 4,
        title: 'Consider promoting ' + cand.line,
        evidence: cand.line + ' keeps ' + pct(cand.marginPct) + ' of its price after materials and lab, but its production in ' + mkLabel(k - 2, true) + '–' + mkLabel(k, true) + ' was ' + eur(cand.production) + ', ' + pct(-cand.change) + ' less than in the same months last year.',
        action: 'Decide whether to promote ' + cand.line + ' (an offer, financing campaign or coordinator follow-up of open quotes). Log it here with the production you expect.',
        impact: 'Recovering last year\'s level would add about ' + eur((cand.productionLastYear - cand.production) / 3) + ' of production a month at a ' + pct(cand.marginPct) + ' margin.',
        metric: { type: 'line_production', line: cand.line, label: cand.line + ' production per month', fmt: 'eur', better: 'up' }
      });
    }
    // 5. Cost and margin: margin after materials and lab falling
    const m3 = avg([0, 1, 2].map((i) => marginPct(ds, k - i)).filter((x) => x != null));
    const m3ly = avg([12, 13, 14].map((i) => marginPct(ds, k - i)).filter((x) => x != null));
    if (m3 && m3ly && m3ly - m3 >= 0.015) {
      const costShare = (i, cat) => { let p = 0, c = 0; for (const l of ds.lines) if (l.done != null && inMonth(l.done, i) && l.cat === cat && l.cost != null) { p += l.price; c += l.cost; } return p ? c / p : null; };
      let worstCat = null;
      for (const cat of ds.lineCats) {
        const now = avg([0, 1, 2].map((i) => costShare(k - i, cat)).filter((x) => x != null)), then = avg([12, 13, 14].map((i) => costShare(k - i, cat)).filter((x) => x != null));
        if (now && then && (!worstCat || now - then > worstCat.d)) worstCat = { cat, d: now - then, now, then };
      }
      recs.push({
        id: 'margin:' + tag, kind: 'margin', priority: 5,
        title: 'Margin after materials and lab is falling',
        evidence: 'Over ' + mkLabel(k - 2, true) + '–' + mkLabel(k, true) + ' the clinic kept ' + pct(m3) + ' of production after materials and lab, against ' + pct(m3ly) + ' in the same months last year.' + (worstCat ? ' The biggest rise in cost share is in ' + worstCat.cat + ' (' + pct(worstCat.then) + ' → ' + pct(worstCat.now) + ' of price).' : ''),
        action: 'The accountant reviews material and laboratory prices' + (worstCat ? ' for ' + worstCat.cat : '') + ', and the CEO decides whether to renegotiate suppliers or adjust prices.',
        impact: 'Each percentage point of margin is worth about ' + eur(avg([0, 1, 2].map((i) => production(ds, k - i))) * 0.01) + ' a month.',
        metric: { type: 'margin_pct', label: 'Margin after materials and lab', fmt: 'pct', better: 'up' }
      });
    }
    // Order by track record: kinds whose past decisions worked rise, kinds usually rejected sink.
    // Kinds with no reviewed decisions keep a neutral score, so the default priority decides.
    const by = (learned && learned.byKind) || {};
    for (const r of recs) {
      const s = by[r.kind];
      r.track = s ? { decided: s.decided, rejected: s.rejected, reviewed: s.reviewed, worked: s.worked, partly: s.partly, avgImprovement: s.avgImprovement } : null;
      let score = s && s.successRate != null ? s.successRate : 0.5;
      if (s && s.decided >= 3 && s.rejectionRate >= 0.6) score -= 0.3;
      r.score = score;
    }
    return recs.sort((a, b) => b.score - a.score || a.priority - b.priority);
  }
  // ---------- Metrics a decision can be measured by ----------
  // Monthly metrics are compared before and after the decision; "prepaid_ids" is a point-in-time amount.
  const METRICS = {
    production: { label: 'Production per month', fmt: 'eur', better: 'up' },
    collections: { label: 'Collections per month', fmt: 'eur', better: 'up' },
    new_patients: { label: 'New patients per month', fmt: 'int', better: 'up' },
    margin_pct: { label: 'Margin after materials and lab', fmt: 'pct', better: 'up' },
    line_production: { label: 'Production of a treatment line per month', fmt: 'eur', better: 'up', param: 'line' },
    line_count: { label: 'Treatments done in a line per month', fmt: 'int', better: 'up', param: 'line' },
    dentist_production: { label: 'Production of a dentist per month', fmt: 'eur', better: 'up', param: 'prof' },
    unearned: { label: 'Paid, not yet done (end of month)', fmt: 'eur', better: 'down' }
  };
  function monthlyValue(ds, m, k) {
    switch (m.type) {
      case 'production': return production(ds, k);
      case 'collections': return collections(ds, k);
      case 'new_patients': case 'first_visits': return firstVisits(ds, k);
      case 'margin_pct': return marginPct(ds, k);
      case 'line_production': return production(ds, k, null, null, m.line);
      case 'line_count': { let n = 0; for (const l of ds.lines) if (l.done != null && inMonth(l.done, k) && l.cat === m.line) n++; return n; }
      case 'dentist_production': return production(ds, k, null, m.prof);
      case 'unearned': return balances(ds, Math.min(mkEnd(k), ds.asOf)).unearned;
      default: return null;
    }
  }
  function prepaidOf(ds, ids) {
    const set = new Set(ids); let s = 0;
    ds.by.forEach((x, pid) => { if (!set.has(pid)) return; let paid = 0, done = 0; for (const p of x.pays) paid += p.amount; for (const l of x.lines) if (l.done != null) done += l.price; s += Math.max(0, paid - done); });
    return s;
  }
  // Current value shown on a recommendation card.
  function evalMetric(ds, m) {
    if (m.type === 'prepaid_ids') return prepaidOf(ds, m.ids);
    return monthlyValue(ds, m, ds.lastMonth);
  }
  // Before/after for a decision: the three full months before the decision month against the full months
  // after it, with the same months a year earlier for seasonality.
  function evalDecision(ds, d) {
    const m = d.metric;
    if (m.type === 'prepaid_ids') {
      return { kind: 'point', before: d.baseline ? d.baseline.value : null, after: prepaidOf(ds, m.ids), afterMonths: Math.max(0, mk(ds.asOf) - mk(fromIso(d.decidedOn))) };
    }
    const k0 = mk(fromIso(d.decidedOn));
    const vals = (a, b) => { const out = []; for (let i = a; i <= b; i++) { const v = monthlyValue(ds, m, i); if (v != null) out.push(v); } return out; };
    const before = avg(vals(k0 - 3, k0 - 1));
    const afterArr = vals(k0 + 1, ds.lastMonth);
    const after = afterArr.length ? avg(afterArr) : null;
    const lastYear = afterArr.length ? avg(vals(k0 + 1 - 12, ds.lastMonth - 12)) : null;
    const beforeLastYear = avg(vals(k0 - 15, k0 - 13));
    const change = after == null || !before ? null : m.fmt === 'pct' ? after - before : after / before - 1;
    const changeLastYear = lastYear == null || !beforeLastYear ? null : m.fmt === 'pct' ? lastYear - beforeLastYear : lastYear / beforeLastYear - 1;
    return { kind: 'monthly', before, after, afterMonths: afterArr.length, lastYear, beforeLastYear, change, changeLastYear, beforeFrom: mkLabel(k0 - 3, true), beforeTo: mkLabel(k0 - 1, true), afterFrom: afterArr.length ? mkLabel(k0 + 1, true) : null, afterTo: afterArr.length ? mkLabel(ds.lastMonth, true) : null };
  }
  function metricLabel(m) {
    if (m.label) return m.label;
    const base = METRICS[m.type];
    if (!base) return m.type;
    if (m.type === 'line_production') return m.line + ' production per month';
    if (m.type === 'line_count') return m.line + ' treatments done per month';
    if (m.type === 'dentist_production') return 'Production of ' + m.prof + ' per month';
    return base.label;
  }

  // ---------- Import (MN Program / Excel exports) ----------
  const norm = (s) => String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
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
    newPatients: 'New patients: patient files opened in the month (MN "Fecha Alta"). Used instead of first visits because MN has no consistent first-visit label yet.',
    margin: 'Margin after materials and lab: production minus the direct cost of materials and laboratory work for the treatment done in the month, as a share of production. It is not net profit: salaries, rent and other overheads are not deducted.',
    treatmentLines: 'Treatment lines: treatment categories (implants, orthodontics, prosthodontics…), with treatments done, production, margin after materials and lab, and change against the same months last year.',
    dentist: 'Production by dentist: production of treatment done by each professional.',
    lostVisits: 'Lost visits: no-shows plus cancellations without a new date. Only measurable once reception records appointment outcomes; today MN entries rarely carry a status.',
    decisionEvaluation: 'Decision evaluation: for monthly metrics, the average of the three full months before the decision month against the average of the full months after it, shown next to the same months a year earlier to separate the decision from seasonality. This is a before/after comparison, not proof of cause.',
    risk: 'Risk: a logistic regression trained on this clinic\'s own history estimates the probability that a patient with accepted, unfinished treatment completes nothing in the next 90 days. Inputs: days since last attended visit, whether an appointment is booked in the next 3 weeks, lost visits in the last 12 months, share of the plan already done, financing, size of the pending treatment, and whether the clinic called the patient in the last 30 days (from call results recorded in the decision log). It is retrained on every import and whenever call results change. If it does not rank patients better than the simple rule "no appointment booked and no visit in 60 days" on the latest held-out month, the app uses the rule instead.'
  };

  const IC = {
    dn, iso, fromIso, mk, mkStart, mkEnd, mkLabel, mkShortYear, dayLabel, weekday, WEEKDAYS, ST, FEATURES, DEFINITIONS,
    simulate, snapshot, prepare, overview, series, production, collections, firstVisits, visitStats, lostByWeekday, lostByProfessional,
    balances, treatmentMix, topPatients, trainRisk, riskList, dormantPlans, contactsFrom, learnFromDecisions, followUpCheck, CALLED, recommendations, evalMetric, detect, fromTables, eur, pct,
    METRICS, monthlyValue, evalDecision, metricLabel, treatmentLines, dataQuality, marginPct, directCost, productionBy, isHygienist, EVENTS
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = IC; else G.IC = IC;
})(typeof window !== 'undefined' ? window : globalThis);
