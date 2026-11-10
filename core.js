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
  const todayDn = () => { const t = new Date(); return dn(t.getFullYear(), t.getMonth() + 1, t.getDate()); };
  const mkEnd = (k) => mkStart(k + 1) - 1;
  const weekday = (n) => (toDate(n).getUTCDay() + 6) % 7; // 0 = Monday
  const iso = (n) => toDate(n).toISOString().slice(0, 10);
  const fromIso = (s) => { const [y, m, d] = s.split('-').map(Number); return dn(y, m, d); };
  // ---------- Language: Spanish for the clinic (default), English for the course ----------
  let LANG = 'es';
  const L = (en, es) => (LANG === 'es' ? es : en);
  const setLang = (l) => { LANG = l === 'en' ? 'en' : 'es'; };
  const getLang = () => LANG;
  const MONTHS_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const MONTHS_ES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const WEEKDAYS_ES = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
  const months = () => (LANG === 'es' ? MONTHS_ES : MONTHS_EN);
  const weekdayName = (w) => (LANG === 'es' ? WEEKDAYS_ES : WEEKDAYS)[w];
  const mkLabel = (k, short) => (short ? months()[k % 12].slice(0, 3) : months()[k % 12]) + (short ? '' : ' ' + Math.floor(k / 12));
  const mkShortYear = (k) => months()[k % 12].slice(0, 3) + ' ' + String(Math.floor(k / 12)).slice(2);
  const dayLabel = (n) => { const t = toDate(n), m = months()[t.getUTCMonth()].slice(0, 3); return t.getUTCDate() + ' ' + (LANG === 'es' ? m.toLowerCase() : m) + ' ' + t.getUTCFullYear(); };

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
  // MN has these states, but reception today marks outcomes by colour instead: red "anula la consulta"
  // (cancelled or no-show, not told apart) and green "actuación realizada". ANNULLED is that red mark.
  const ST = {
    DONE: 'Realizada', REBOOKED: 'Cancelada refijada', CANCEL: 'Cancelada no refijada',
    NOSHOW: 'No llegó', ANNULLED: 'Anulada', FUTURE: 'Programada'
  };
  const isLost = (s) => s === ST.CANCEL || s === ST.NOSHOW || s === ST.ANNULLED;

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
      pays: full.pays.filter((p) => p.day <= asOf),
      partes: { lines: [], pays: [] }, pending: [] // daily sheets and the pending list come only from the clinic's real files
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
    ds.pays.forEach((p) => { if (p.pid != null) get(p.pid).pays.push(p); });
    by.forEach((x) => { x.appts.sort((a, b) => a.day - b.day); x.pays.sort((a, b) => a.day - b.day); });
    ds.by = by;
    ds.hasPatientDates = ds.patients.some((p) => p.first != null);
    const profs = new Set(); ds.lines.forEach((l) => l.prof && profs.add(l.prof));
    ds.profs = Array.from(profs).sort();
    ds.lineCats = Array.from(new Set(ds.lines.map((l) => l.cat).filter(Boolean))).sort();
    // Latest complete month: a month whose remaining days are only a weekend counts as complete (data to Friday 30 October covers October).
    { let e = ds.asOf; while (mk(e + 1) === mk(e) && [0, 6].includes(toDate(e + 1).getUTCDay())) e++; ds.lastMonth = mk(e + 1) - 1; }
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
  // New patients: patient files opened in the month (MN "Fecha Alta"). Without registration dates, each
  // patient's first first-visit appointment ("1 consulta" in MN) that was not marked lost. A patient with
  // several first-visit entries counts once, in the month of the earliest; the accountant removes these
  // repeats by hand in Excel today.
  function firstVisits(ds, k) {
    let n = 0;
    if (ds.hasPatientDates) { for (const p of ds.patients) if (inMonth(p.first, k)) n++; return n; }
    if (!ds.firstVisitDay) {
      ds.firstVisitDay = new Map();
      for (const a of ds.appts) {
        if (a.type !== 'Primera visita' || a.day > ds.asOf || !(a.status === ST.DONE || a.status === ST.FUTURE)) continue;
        const d = ds.firstVisitDay.get(a.pid); if (d == null || a.day < d) ds.firstVisitDay.set(a.pid, a.day);
      }
    }
    ds.firstVisitDay.forEach((d) => { if (inMonth(d, k)) n++; });
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
    let past = 0, withOutcome = 0, cancelled = 0, annulled = 0;
    for (const a of ds.appts) {
      if (a.day < a0 || a.day > a1) continue;
      past++; if (a.status !== ST.FUTURE) withOutcome++;
      if (a.status === ST.CANCEL || a.status === ST.REBOOKED || a.status === ST.NOSHOW || a.status === ST.ANNULLED) cancelled++;
      if (a.status === ST.ANNULLED) annulled++;
    }
    let lines = 0, withProf = 0, withCost = 0;
    for (const l of ds.lines) { if (l.done == null || l.done < a0 || l.done > a1) continue; lines++; if (l.prof) withProf++; if (l.cost != null) withCost++; }
    return { appointments: past, outcomeRecorded: past ? withOutcome / past : null, cancellationsRecorded: cancelled, lostWithoutReason: annulled, treatmentsDone: lines, professionalRecorded: lines ? withProf / lines : null, costRecorded: lines ? withCost / lines : null, patientDates: !!ds.hasPatientDates };
  }
  function visitStats(ds, k1, k2, filter) {
    const o = { total: 0, done: 0, lost: 0, noShow: 0, cancelled: 0, annulled: 0, rebooked: 0 };
    const a0 = mkStart(k1), a1 = mkEnd(k2);
    for (const a of ds.appts) {
      if (a.day < a0 || a.day > a1 || a.status === ST.FUTURE) continue;
      if (filter && !filter(a)) continue;
      o.total++;
      if (a.status === ST.DONE) o.done++;
      else if (a.status === ST.NOSHOW) { o.noShow++; o.lost++; }
      else if (a.status === ST.CANCEL) { o.cancelled++; o.lost++; }
      else if (a.status === ST.ANNULLED) { o.annulled++; o.lost++; }
      else if (a.status === ST.REBOOKED) o.rebooked++;
    }
    o.lostRate = o.total ? o.lost / o.total : 0;
    return o;
  }
  function lostByWeekday(ds, k1, k2) {
    return [0, 1, 2, 3, 4].map((w) => Object.assign({ weekday: weekdayName(w), wd: w }, visitStats(ds, k1, k2, (a) => weekday(a.day) === w)));
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
      if (!f.future) reasons.push(L('No appointment booked', 'Sin cita reservada'));
      if (f.days > 60) reasons.push(f.days >= 365 ? L('No visit in over a year', 'Sin visita en más de un año') : L('No visit in ' + f.days + ' days', 'Sin visita en ' + f.days + ' días'));
      if (f.lost12 >= 2) reasons.push(L(f.lost12 + ' missed or cancelled visits this year', f.lost12 + ' citas perdidas o anuladas este año'));
      if (f.done / (f.done + f.pending) < 0.25) reasons.push(L('Less than a quarter of the plan done', 'Menos de un cuarto del plan hecho'));
      if (f.fin) reasons.push(L('Financed treatment', 'Tratamiento financiado'));
      if (f.contacted) reasons.push(L('Called in the last 30 days', 'Llamado en los últimos 30 días'));
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
      if (d.expected && d.expected.pct && d.metric && d.metric.type !== 'prepaid_ids' && d.metric.type !== 'pending_old') {
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
    const span = mkLabel(k - 2, true) + '–' + mkLabel(k, true);
    // 1. Unfinished, prepaid treatment at risk (patients called in the last 30 days are left out)
    const high = risk.filter((r) => r.tier === 'High' && !r.contacted);
    if (high.length) {
      const top = high.slice().sort((a, b) => b.prepaid - a.prepaid || b.pending - a.pending).slice(0, 25);
      const n = top.length, prepaidTop = top.reduce((a, r) => a + r.prepaid, 0), pendingTop = top.reduce((a, r) => a + r.pending, 0);
      // Expected effect: the clinic's own measured response once there is enough history, otherwise a stated assumption.
      let rate = 1 / 3, impact;
      if (fu && fu.observed >= 10) {
        rate = fu.continuedRate;
        impact = L('Measured on ' + fu.observed + ' patients from ' + fu.decisions + ' earlier follow-up decision' + (fu.decisions > 1 ? 's' : '') + ': ' + pct(rate) + ' continued their treatment afterwards. Applied to this list, about ' + eur(pendingTop * rate) + ' of treatment would be completed.',
          'Medido en ' + fu.observed + ' pacientes de ' + fu.decisions + ' decisi' + (fu.decisions > 1 ? 'ones' : 'ón') + ' de seguimiento anteriores: el ' + pct(rate) + ' continuó su tratamiento después. Aplicado a esta lista, se completarían unos ' + eur(pendingTop * rate) + ' de tratamiento.');
        if (fu.reachedRate != null && fu.notReachedRate != null) impact += L(' Patients reached by phone continued in ' + pct(fu.reachedRate) + ' of cases, against ' + pct(fu.notReachedRate) + ' for those who did not answer.', ' Los pacientes que contestaron continuaron en el ' + pct(fu.reachedRate) + ' de los casos, frente al ' + pct(fu.notReachedRate) + ' de los que no contestaron.');
      } else {
        impact = L('If one in three books and continues, about ' + eur(pendingTop / 3) + ' of treatment would be completed. This is an assumption until the first follow-up decision has been reviewed; after that the app uses the measured rate.',
          'Si uno de cada tres reserva y continúa, se completarían unos ' + eur(pendingTop / 3) + ' de tratamiento. Es una suposición hasta que se revise la primera decisión de seguimiento; a partir de entonces la app usa la tasa medida.');
      }
      const metric = { type: 'prepaid_ids', ids: top.map((r) => r.patient), fmt: 'eur', better: 'down' };
      metric.label = metricLabel(metric);
      recs.push({
        id: 'risk:' + tag, kind: 'risk', priority: 1,
        title: L('Call ' + n + ' patients who are likely to abandon their treatment', 'Llamar a ' + n + ' pacientes con riesgo de abandonar su tratamiento'),
        evidence: L(high.length + ' patients have a high risk (60% or more) of not continuing their treatment in the next 90 days' + (risk.some((r) => r.contacted) ? ', not counting patients already called in the last 30 days' : '') + '. The ' + n + ' with most money at stake have ' + eur(pendingTop) + ' of accepted treatment not yet done, of which ' + eur(prepaidTop) + ' is already paid.',
          high.length + ' pacientes tienen un riesgo alto (60% o más) de no continuar su tratamiento en los próximos 90 días' + (risk.some((r) => r.contacted) ? ', sin contar los ya llamados en los últimos 30 días' : '') + '. Los ' + n + ' con más dinero en juego tienen ' + eur(pendingTop) + ' de tratamiento aceptado sin hacer, de los que ' + eur(prepaidTop) + ' ya están pagados.'),
        action: L('Reception calls these ' + n + ' patients this week, starting with those who paid most, offers a date for their next session, and records each call result in the app.',
          'Recepción llama a estos ' + n + ' pacientes esta semana, empezando por los que más han pagado, les ofrece fecha para la siguiente sesión y anota el resultado de cada llamada en la app.'),
        impact, expectedRate: rate,
        predictions: top.map((r) => ({ id: r.patient, p: Math.round(r.probability * 1000) / 1000 })),
        metric
      });
    }
    // 2. Marketing: new patients falling
    const fvRecent = avg([firstVisits(ds, k), firstVisits(ds, k - 1)]);
    const fvPrior = avg([2, 3, 4, 5, 6, 7].map((i) => firstVisits(ds, k - i)));
    if (fvPrior > 0 && fvRecent <= fvPrior * 0.88) {
      const firstDay = new Map(ds.patients.filter((p) => p.first != null && p.first >= mkStart(k - 13) && p.first <= mkEnd(k - 6)).map((p) => [p.id, p.first]));
      let val = 0; for (const l of ds.lines) { const f = firstDay.get(l.pid); if (f != null && l.accept <= f + 183) val += l.price; }
      const perPatient = firstDay.size ? val / firstDay.size : 0;
      const metric = { type: 'new_patients', fmt: 'int', better: 'up' }; metric.label = metricLabel(metric);
      recs.push({
        id: 'acq:' + tag, kind: 'acq', priority: 2,
        title: L('New patients are falling', 'Bajan los pacientes nuevos'),
        evidence: L(firstVisits(ds, k) + ' new patients in ' + mkLabel(k, true) + ' and ' + firstVisits(ds, k - 1) + ' in ' + mkLabel(k - 1, true) + ', against an average of ' + Math.round(fvPrior) + ' a month in the six months before (' + pct(fvRecent / fvPrior - 1) + ').',
          firstVisits(ds, k) + ' pacientes nuevos en ' + mkLabel(k, true) + ' y ' + firstVisits(ds, k - 1) + ' en ' + mkLabel(k - 1, true) + ', frente a una media de ' + Math.round(fvPrior) + ' al mes en los seis meses anteriores (' + pct(fvRecent / fvPrior - 1) + ').'),
        action: L('Ask every new patient how they found the clinic and record it, then reinforce the channel that brings most (Instagram giveaways have worked better than flyers). Log the marketing action here with the number of new patients you expect.',
          'Preguntar a cada paciente nuevo cómo conoció la clínica y anotarlo, y reforzar el canal que más trae (los sorteos de Instagram han funcionado mejor que los folletos). Registrar aquí la acción de marketing con el número de pacientes nuevos que se espera.'),
        impact: L('Each new patient accepted about ' + eur(perPatient) + ' of treatment in their first six months, so ' + Math.round(fvPrior - fvRecent) + ' fewer new patients a month is about ' + eur((fvPrior - fvRecent) * perPatient) + ' of future treatment a month.',
          'Cada paciente nuevo aceptó unos ' + eur(perPatient) + ' de tratamiento en sus seis primeros meses, así que ' + Math.round(fvPrior - fvRecent) + ' pacientes nuevos menos al mes son unos ' + eur((fvPrior - fvRecent) * perPatient) + ' de tratamiento futuro al mes.'),
        metric
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
      const w = worstDentist, metric = { type: 'dentist_production', prof: w.p, fmt: 'eur', better: 'up' }; metric.label = metricLabel(metric);
      recs.push({
        id: 'dentist:' + w.p + ':' + tag, kind: 'dentist', priority: 3,
        title: L(w.p + ' is producing much less than usual', w.p + ' está produciendo mucho menos de lo habitual'),
        evidence: L(w.p + ' produced ' + eur(w.recent) + ' a month in ' + mkLabel(k - 1, true) + '–' + mkLabel(k, true) + ', against ' + eur(w.prior) + ' a month in the six months before (' + pct(w.ch) + ').',
          w.p + ' produjo ' + eur(w.recent) + ' al mes en ' + mkLabel(k - 1, true) + '–' + mkLabel(k, true) + ', frente a ' + eur(w.prior) + ' al mes en los seis meses anteriores (' + pct(w.ch) + ').'),
        action: L('The CEO and owner-dentist review ' + w.p + "'s hours and patient flow and decide whether to change the rota or find cover for the lost hours.",
          'La gerencia y la dirección clínica revisan las horas y el flujo de pacientes de ' + w.p + ' y deciden si cambiar el horario o cubrir las horas perdidas.'),
        impact: L('Returning to the usual level would add about ' + eur(w.prior - w.recent) + ' of production a month.', 'Volver al nivel habitual sumaría unos ' + eur(w.prior - w.recent) + ' de producción al mes.'),
        metric
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
      const metric = { type: 'dentist_production', prof: p, fmt: 'eur', better: 'up' }; metric.label = metricLabel(metric);
      recs.push({
        id: 'hire:' + p + ':' + tag, kind: 'dentist', priority: 3,
        title: L('Review the new dentist: ' + p, 'Revisar la nueva contratación: ' + p),
        evidence: L(p + ' started in ' + mkLabel(mk(firstDone)) + '. In the last three months ' + p + ' produced ' + eur(own) + ' a month; the other dentists averaged ' + eur(othersAvg) + '.',
          p + ' empezó en ' + mkLabel(mk(firstDone)) + '. En los últimos tres meses produjo ' + eur(own) + ' al mes; el resto de odontólogos, ' + eur(othersAvg) + ' de media.'),
        action: L('Compare this production with ' + p + "'s salary and hours, and decide whether to keep, extend or change the role. Log the decision with the production you expect.",
          'Comparar esta producción con el sueldo y las horas de ' + p + ' y decidir si mantener, ampliar o cambiar el puesto. Registrar la decisión con la producción que se espera.'),
        impact: L('Gives the hiring decision a measured result instead of perceived demand.', 'Da a la decisión de contratar un resultado medido en lugar de una demanda percibida.'),
        metric
      });
    }
    // 4. Treatment lines to promote: high margin but falling volume
    const tl = treatmentLines(ds, k - 2, k).filter((x) => x.production >= 3000 && x.marginPct != null && x.change != null);
    // The line where the most margin (in euros) was lost against last year.
    const lostMargin = (x) => (x.productionLastYear - x.production) * x.marginPct;
    const cand = tl.filter((x) => x.change <= -0.1).sort((a, b) => lostMargin(b) - lostMargin(a))[0];
    if (cand) {
      const metric = { type: 'line_production', line: cand.line, fmt: 'eur', better: 'up' }; metric.label = metricLabel(metric);
      recs.push({
        id: 'line:' + cand.line + ':' + tag, kind: 'line', priority: 4,
        title: L('Consider promoting ' + cand.line, 'Valorar impulsar ' + cand.line),
        evidence: L(cand.line + ' keeps ' + pct(cand.marginPct) + ' of its price after materials and lab, but its production in ' + span + ' was ' + eur(cand.production) + ', ' + pct(-cand.change) + ' less than in the same months last year.',
          cand.line + ' conserva el ' + pct(cand.marginPct) + ' de su precio tras materiales y laboratorio, pero su producción en ' + span + ' fue de ' + eur(cand.production) + ', un ' + pct(-cand.change) + ' menos que en los mismos meses del año pasado.'),
        action: L('Decide how to promote ' + cand.line + ' to patients already in the clinic (financing, coordinator follow-up of open quotes). Flyer discounts have not brought new patients; offers work once the patient is inside. Log it here with the production you expect.',
          'Decidir cómo impulsar ' + cand.line + ' entre los pacientes que ya vienen a la clínica (financiación, seguimiento de presupuestos abiertos). Los descuentos en folletos no han traído pacientes nuevos; las ofertas funcionan cuando el paciente ya está dentro. Registrarlo aquí con la producción que se espera.'),
        impact: L('Recovering last year\'s level would add about ' + eur((cand.productionLastYear - cand.production) / 3) + ' of production a month at a ' + pct(cand.marginPct) + ' margin.',
          'Recuperar el nivel del año pasado sumaría unos ' + eur((cand.productionLastYear - cand.production) / 3) + ' de producción al mes con un margen del ' + pct(cand.marginPct) + '.'),
        metric
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
      const metric = { type: 'margin_pct', fmt: 'pct', better: 'up' }; metric.label = metricLabel(metric);
      recs.push({
        id: 'margin:' + tag, kind: 'margin', priority: 5,
        title: L('Margin after materials and lab is falling', 'Baja el margen tras materiales y laboratorio'),
        evidence: L('Over ' + span + ' the clinic kept ' + pct(m3) + ' of production after materials and lab, against ' + pct(m3ly) + ' in the same months last year.' + (worstCat ? ' The biggest rise in cost share is in ' + worstCat.cat + ' (' + pct(worstCat.then) + ' → ' + pct(worstCat.now) + ' of price).' : ''),
          'En ' + span + ' la clínica conservó el ' + pct(m3) + ' de la producción tras materiales y laboratorio, frente al ' + pct(m3ly) + ' en los mismos meses del año pasado.' + (worstCat ? ' La mayor subida del peso del coste está en ' + worstCat.cat + ' (' + pct(worstCat.then) + ' → ' + pct(worstCat.now) + ' del precio).' : '')),
        action: L('The accountant reviews material and laboratory prices' + (worstCat ? ' for ' + worstCat.cat : '') + ', and the CEO decides whether to renegotiate suppliers or adjust prices.',
          'Contabilidad revisa los precios de materiales y laboratorio' + (worstCat ? ' de ' + worstCat.cat : '') + ' y la gerencia decide si renegociar con proveedores o ajustar precios.'),
        impact: L('Each percentage point of margin is worth about ' + eur(avg([0, 1, 2].map((i) => production(ds, k - i))) * 0.01) + ' a month.', 'Cada punto de margen vale unos ' + eur(avg([0, 1, 2].map((i) => production(ds, k - i))) * 0.01) + ' al mes.'),
        metric
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
    production: { get label() { return L('Production per month', 'Producción al mes'); }, fmt: 'eur', better: 'up' },
    collections: { get label() { return L('Collections per month', 'Cobros al mes'); }, fmt: 'eur', better: 'up' },
    new_patients: { get label() { return L('New patients per month', 'Pacientes nuevos al mes'); }, fmt: 'int', better: 'up' },
    margin_pct: { get label() { return L('Margin after materials and lab', 'Margen tras materiales y laboratorio'); }, fmt: 'pct', better: 'up' },
    line_production: { get label() { return L('Production of a treatment line per month', 'Producción de una línea de tratamiento al mes'); }, fmt: 'eur', better: 'up', param: 'line' },
    line_count: { get label() { return L('Treatments done in a line per month', 'Tratamientos hechos de una línea al mes'); }, fmt: 'int', better: 'up', param: 'line' },
    dentist_production: { get label() { return L('Production of a dentist per month', 'Producción de un odontólogo al mes'); }, fmt: 'eur', better: 'up', param: 'prof' },
    unearned: { get label() { return L('Paid, not yet done (end of month)', 'Cobrado y no realizado (fin de mes)'); }, fmt: 'eur', better: 'down' },
    pending_old: { get label() { return L('Pending treatment older than 6 months (MN list)', 'Pendiente con más de 6 meses (lista de MN)'); }, fmt: 'eur', better: 'down', point: true }
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
      default: return null; // point-in-time metrics (prepaid_ids, pending_old) have no monthly value
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
    if (m.type === 'pending_old') return pendingOld(ds);
    return monthlyValue(ds, m, ds.lastMonth);
  }
  // Before/after for a decision: the three full months before the decision month against the full months
  // after it, with the same months a year earlier for seasonality.
  function evalDecision(ds, d) {
    const m = d.metric;
    if (m.type === 'prepaid_ids' || m.type === 'pending_old') {
      return { kind: 'point', before: d.baseline ? d.baseline.value : null, after: m.type === 'pending_old' ? pendingOld(ds) : prepaidOf(ds, m.ids), afterMonths: Math.max(0, mk(ds.asOf) - mk(fromIso(d.decidedOn))) };
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
  // Label in the current language, worked out from the metric itself (stored labels may be in the other language).
  function metricLabel(m) {
    if (!m) return '';
    if (m.type === 'prepaid_ids' && m.ids) return L('Paid but unfinished treatment of these ' + m.ids.length + ' patients', 'Tratamiento pagado sin terminar de estos ' + m.ids.length + ' pacientes');
    if (m.type === 'line_production') return L(m.line + ' production per month', 'Producción de ' + m.line + ' al mes');
    if (m.type === 'line_count') return L(m.line + ' treatments done per month', 'Tratamientos de ' + m.line + ' hechos al mes');
    if (m.type === 'dentist_production') return L('Production of ' + m.prof + ' per month', 'Producción de ' + m.prof + ' al mes');
    if (METRICS[m.type]) return METRICS[m.type].label;
    return m.label || m.type;
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
    patient: ['numero paciente', 'n paciente', 'numero cliente', 'n cliente', 'clientes numero cliente', 'paciente', 'numero', 'id paciente', 'patient'],
    date: ['fecha', 'fecha cita', 'date'],
    status: ['estado', 'status'],
    treatment: ['tratamiento', 'descripcion tratamiento', 'treatment'],
    amount: ['importe', 'total', 'amount']
  };
  function detect(headers) {
    const h = headers.map(norm);
    const has = (x) => h.some((c) => x.includes(c));
    // MN patient list (template "MSIM Saldos"): one row per patient, with registration date and totals
    if (has(['numero cliente', 'n cliente']) && has(['fecha alta', 'total cobrado', 'fecha ultima actuacion'])) return 'patients';
    if (has(['tratamiento', 'treatment']) && has(['importe', 'total', 'precio', 'amount'])) return 'lines';
    if (has(['forma de cobro', 'forma cobro', 'metodo de pago', 'fecha cobro'])) return 'pays';
    if (has(['estado', 'status']) && has(['fecha', 'fecha cita', 'date'])) return 'appts';
    if (has(['fecha alta', 'alta'])) return 'patients';
    return null;
  }
  // Appointment outcome from the MN state, or, when reception left the state untouched, from the colour
  // they actually use: red "anula la consulta" (cancelled or no-show) and green "actuación realizada".
  function apptStatus(state, colour) {
    const sn = norm(state), cn = norm(colour);
    if (sn.includes('refijada') && !sn.includes('no refijada')) return ST.REBOOKED;
    if (sn.includes('no refijada') || sn === 'cancelada') return ST.CANCEL;
    if (sn.includes('no lleg') || sn.includes('no contesta')) return ST.NOSHOW;
    if (sn.includes('realizad') || sn.includes('en consulta') || sn.includes('sala de espera')) return ST.DONE;
    if (cn.includes('anula') || cn.includes('rojo') || cn === 'red' || cn.includes('salmon')) return ST.ANNULLED;
    if (cn.includes('realizad') || cn.includes('verde') || cn === 'green') return ST.DONE;
    return ST.FUTURE;
  }
  function fromTables(tables, label) {
    const ds = { source: 'import', label: label || L('Imported data', 'Datos importados'), patients: [], appts: [], lines: [], pays: [], partes: { lines: [], pays: [] }, pending: [] };
    const warn = [];
    // The first patient column that holds a number (an export may carry an empty or a name "Paciente" column too).
    const pid = (r) => {
      for (const k of Object.keys(r)) {
        if (!COLS.patient.includes(norm(k))) continue;
        const n = parseInt(String(r[k] == null ? '' : r[k]).replace(/\.0+$/, '').replace(/\D/g, ''), 10);
        if (!isNaN(n)) return n;
      }
      return null;
    };
    const txt = (v) => String(v == null ? '' : v).trim();
    for (const t of tables) {
      if (t.kind === 'patients') t.rows.forEach((r) => {
        const id = pid(r); if (id == null) return;
        const lastCol = pick(r, ['fecha ultima actuacion']), nextCol = pick(r, ['f proxima actuacion', 'fecha proxima actuacion']);
        ds.patients.push({ id, first: parseDay(pick(r, ['fecha alta', 'alta'])), age: parseNum(pick(r, ['edad', 'age'])) || null,
          last: lastCol === undefined ? undefined : parseDay(lastCol), next: nextCol === undefined ? undefined : parseDay(nextCol),
          state: txt(pick(r, ['estado'])), baja: parseDay(pick(r, ['fecha baja'])),
          paid: ((v) => (v === undefined || v === '' ? undefined : parseNum(v)))(pick(r, ['total cobrado', 'total cobro'])),
          billed: ((v) => (v === undefined || v === '' ? undefined : parseNum(v)))(pick(r, ['total facturado'])) });
      });
      if (t.kind === 'parte') t.rows.forEach((r) => {
        const day = parseDay(pick(r, ['fecha'])), id = pid(r); if (day == null || id == null) return;
        ds.partes.lines.push({ day, doctor: txt(pick(r, ['doctor'])), pid: id, desc: txt(pick(r, ['descripcion'])), cobrado: parseNum(pick(r, ['cobrado'])), fp: txt(pick(r, ['f p'])),
          realizada: parseNum(pick(r, ['realizada'])), valoracion: parseNum(pick(r, ['valoracion'])), especial: parseNum(pick(r, ['especial'])), seguro: parseNum(pick(r, ['seguro'])), line: txt(pick(r, ['linea'])) || null, act: txt(pick(r, ['acto'])) || null,
          src: norm(pick(r, ['hoja'])) === 'produccion' ? 'produccion' : 'doctor' });
      });
      if (t.kind === 'parte_pay') t.rows.forEach((r) => {
        const day = parseDay(pick(r, ['fecha'])); if (day == null) return;
        const concept = txt(pick(r, ['concepto']));
        ds.partes.pays.push({ day, tab: txt(pick(r, ['hoja'])), pid: pid(r), concept, code: txt(pick(r, ['codigo'])) || payCode(concept), method: txt(pick(r, ['forma de cobro'])), total: parseNum(pick(r, ['total'])) });
      });
      if (t.kind === 'pending') t.rows.forEach((r) => {
        const day = parseDay(pick(r, ['fecha tratamiento'])); if (day == null) return;
        const acc = norm(pick(r, ['presupuesto aceptado'])), src = pick(r, ['fuente de contacto']), b = txt(pick(r, ['n presupuesto', 'presupuesto']));
        ds.pending.push({ day, desc: txt(pick(r, ['descripcion'])), amount: parseNum(pick(r, ['importe'])), price: parseNum(pick(r, ['precio'])), discount: parseNum(pick(r, ['descuento'])),
          budget: b.replace(/\.0+$/, ''), accepted: acc ? (acc === 'si' || acc === 'yes' || acc === 's') : null, user: txt(pick(r, ['usuario'])), origin: txt(pick(r, ['origen'])),
          collected: parseNum(pick(r, ['importe cobrado'])), source: src === undefined ? undefined : txt(src), pid: pid(r), from: t.from.split(' · ')[0] });
      });
      if (t.kind === 'appts') t.rows.forEach((r) => {
        const id = pid(r), day = parseDay(pick(r, COLS.date.concat(['fecha actuacion']))); if (id == null || day == null) return;
        const desc = String(pick(r, ['descripcion', 'description', 'motivo']) || '');
        const tipo = norm(pick(r, ['tipo', 'tipo cita', 'type']) || ''), nd = norm(desc);
        let status = apptStatus(pick(r, COLS.status), pick(r, ['color', 'colour', 'color cita']));
        // MN's own agenda export has no state or colour, only the "Cancelada" and "Actuación Realizada" flags,
        // which reception rarely uses: an appointment not flagged as cancelled counts as attended if it falls on or
        // before the date of the other data (set below, once every file is read), and as booked after it.
        let inferred = false;
        if (t.mnAgenda) {
          const canc = norm(pick(r, ['cancelada'])), done = norm(pick(r, ['actuacion realizada']));
          if (['true', 'si', 's', 'verdadero', '1'].includes(canc)) status = ST.CANCEL;
          else if (done === 'si' || done === 's') status = ST.DONE;
          else { status = ST.FUTURE; inferred = true; }
        }
        // MN marks first visits as "1 consulta".
        const type = tipo.includes('primera') || nd.includes('primera visita') || /(^| )1 consulta/.test(nd) ? 'Primera visita' : tipo.includes('revision') ? 'Revisión' : 'Tratamiento';
        ds.appts.push({ pid: id, day, prof: String(pick(r, ['profesional', 'doctor', 'usuario']) || ''), cab: String(pick(r, ['gabinete', 'cabinet', 'sala']) || ''), desc, type, status, inferred });
      });
      if (t.kind === 'lines') t.rows.forEach((r, i) => {
        const id = pid(r); if (id == null) return;
        const done = parseDay(pick(r, ['fecha realizacion', 'fecha realizado', 'realizado el', 'done date']));
        const st = norm(pick(r, COLS.status) || (done != null ? 'realizado' : 'pendiente'));
        ds.lines.push({ pid: id, plan: pick(r, ['presupuesto', 'n presupuesto', 'plan']) || i, accept: parseDay(pick(r, ['fecha aceptacion', 'fecha presupuesto', 'fecha'])) || done, name: String(pick(r, COLS.treatment) || '').toUpperCase(), cat: String(pick(r, ['categoria', 'especialidad', 'category']) || ''), price: parseNum(pick(r, ['importe', 'total', 'precio', 'amount'])), status: st.includes('cancel') ? 'Cancelado' : (st.includes('realiz') && done != null) ? 'Realizado' : 'Pendiente', done: st.includes('realiz') ? done : null, prof: String(pick(r, ['profesional', 'doctor', 'usuario']) || ''), cab: String(pick(r, ['gabinete', 'cabinet']) || '') || null });
      });
      // A payment without a patient number (MN's payment export has none) still counts in the clinic's totals.
      if (t.kind === 'pays') t.rows.forEach((r) => {
        const id = pid(r), day = parseDay(pick(r, ['fecha cobro', 'fecha', 'date'])); if (day == null) return;
        ds.pays.push({ pid: id, day, amount: parseNum(pick(r, ['importe', 'total', 'amount'])), method: String(pick(r, ['forma de cobro', 'forma cobro', 'metodo de pago']) || ''), concept: String(pick(r, ['concepto', 'concept', 'descripcion']) || '') });
      });
    }
    // The same pending line exported in two files (the full list and a monthly one) is counted once. Identical
    // lines inside one file are real (two units of the same quote) and all stay: per line, the most any one
    // file holds is kept.
    {
      const key = (x) => [x.day, x.desc, x.amount, x.budget, x.pid].join('|'), most = new Map(), per = new Map();
      ds.pending.forEach((x) => { const k = key(x), f = k + '#' + x.from; per.set(f, (per.get(f) || 0) + 1); most.set(k, Math.max(most.get(k) || 0, per.get(f))); });
      const kept = new Map();
      ds.pending = ds.pending.filter((x) => { const k = key(x), n = (kept.get(k) || 0) + 1; kept.set(k, n); return n <= most.get(k); });
    }
    // Without an MN treatment export, the daily sheets are the production record: each doctor-tab line with an
    // amount becomes treatment done (by that doctor, in its cleaned treatment line) and what was paid that day a
    // payment. With an MN treatment export loaded, the sheets are only checked, never counted twice.
    const P = ds.partes;
    // Payments are recorded in MN: on the days MN's payment export covers, the sheets' payments are not added again.
    const mnPayDays = ds.pays.length ? [Math.min.apply(null, ds.pays.map((p) => p.day)), Math.max.apply(null, ds.pays.map((p) => p.day))] : null;
    const inMN = (day) => !!mnPayDays && day >= mnPayDays[0] && day <= mnPayDays[1];
    if (!ds.lines.length && P.lines.length) {
      const M = matchPartes(P);
      const asLine = (l, value) => { const c = l.line || cleanText(l.desc).line; ds.lines.push({ pid: l.pid, plan: 'parte', accept: l.day, name: up(l.desc), cat: c ? LINE_ES[c] : 'Sin clasificar', price: value, cost: null, status: 'Realizado', done: l.day, prof: l.doctor, cab: null }); };
      for (const l of M.doc) {
        const v = M.clinicValue(l); if (v > 0) asLine(l, v);
        if (l.cobrado > 0 && !inMN(l.day)) ds.pays.push({ pid: l.pid, day: l.day, amount: l.cobrado, method: l.fp, concept: l.desc });
      }
      for (const l of M.extra) if (l.realizada > 0) asLine(l, l.realizada);
      for (const p of P.pays) if (p.pid != null && p.total > 0 && !inMN(p.day)) ds.pays.push({ pid: p.pid, day: p.day, amount: p.total, method: p.method, concept: p.concept });
      ds.fromPartes = true;
    }
    // MN's pending list, when it carries the patient number, is each patient's accepted treatment not yet done: it
    // feeds the follow-up risk model and "paid, not yet done". Lines a later daily sheet already shows as done are
    // left out here (their work is counted from the sheet) and listed apart as "probably already done".
    if (ds.pending.some((x) => x.pid != null)) {
      const doneItems = new Set(pendingLikelyDone(ds).matches.map((m) => m.item));
      ds.pending.forEach((x, i) => {
        if (x.pid == null || !(x.amount > 0) || doneItems.has(x)) return;
        const c = cleanText(x.desc).line;
        ds.lines.push({ pid: x.pid, plan: x.budget || 'pend-' + i, accept: x.day, name: up(x.desc), cat: c ? LINE_ES[c] : 'Sin clasificar', price: x.amount, cost: null, status: 'Pendiente', done: null, prof: '', cab: null }); // MN's user name would add a second "dentist"
      });
    }
    // "Paid, not yet done" needs payments by patient: true when nearly every payment carries a patient number.
    ds.paysWithPatient = ds.pays.length > 0 && ds.pays.filter((p) => p.pid != null).length / ds.pays.length > 0.9;
    if (!ds.appts.length && !P.lines.length) warn.push(L('No appointments table found: lost visits and first visits will be empty.', 'No hay tabla de agenda: las citas perdidas y las primeras visitas saldrán vacías.'));
    if (!ds.lines.length) warn.push(L('No treatments table or daily sheets found: production, treatment mix and risk need one of them.', 'No hay tabla de tratamientos ni partes diarios: la producción, las líneas y el riesgo necesitan uno de los dos.'));
    if (!ds.pays.length && !P.lines.length) warn.push(L('No payments table found: collections and unearned revenue need it.', 'No hay tabla de cobros: los cobros y lo cobrado no realizado la necesitan.'));
    const now = new Date(), today = dn(now.getFullYear(), now.getMonth() + 1, now.getDate());
    // The agenda export reaches into the future: its appointments count as attended up to the date of the rest of the
    // data (payments, daily sheets, treatments), never up to today, so a later "today" does not invent visits.
    { const ref = [].concat(ds.pays.map((p) => p.day), P.lines.map((l) => l.day), ds.lines.filter((l) => l.done != null).map((l) => l.done)).filter((d) => d != null && d <= today);
      const cut = ref.length ? ref.reduce((a, b) => Math.max(a, b), -Infinity) : today;
      ds.appts.forEach((a) => { if (a.inferred) { a.status = a.day <= cut ? ST.DONE : ST.FUTURE; delete a.inferred; } }); }
    const days = [].concat(ds.appts.filter((a) => a.status !== ST.FUTURE).map((a) => a.day), ds.pays.map((p) => p.day), ds.lines.filter((l) => l.done != null).map((l) => l.done),
      P.lines.map((l) => l.day), P.pays.map((p) => p.day), ds.pending.map((x) => x.day), ds.patients.map((p) => p.first), ds.patients.map((p) => p.last)).filter((d) => d != null && d <= today);
    if (!days.length) throw new Error(L('No dated rows found. Check that the files have the expected columns.', 'No hay filas con fecha. Comprueba que los archivos tienen las columnas esperadas.'));
    ds.asOf = days.reduce((a, b) => Math.max(a, b), -Infinity);
    if (!ds.patients.length) { const ids = new Set(); ds.appts.forEach((a) => ids.add(a.pid)); ds.lines.forEach((l) => ids.add(l.pid)); ids.forEach((id) => ds.patients.push({ id, first: null, age: null })); }
    prepare(ds);
    ds.warnings = warn;
    return ds;
  }

  // ---------- Patient key (re-identification in the browser) ----------
  // The exports, the shared decision log and the assistant only carry patient numbers. A key file that
  // stays on the clinic's computer maps each number to a name. The page reads it into memory and adds
  // the names on screen; nothing here stores, shares or sends them.
  const NAME_COLS = ['nombre', 'nombre y apellidos', 'nombre completo', 'nombre paciente', 'paciente nombre', 'name', 'full name'];
  const SURNAME_COLS = ['apellidos', 'apellido', 'primer apellido', 'surname', 'last name'];
  function keyFromRows(rows) {
    const out = new Map();
    for (const r of rows) {
      const raw = pick(r, COLS.patient);
      const id = parseInt(String(raw == null ? '' : raw).replace(/\D/g, ''), 10);
      if (isNaN(id)) continue;
      const name = [pick(r, NAME_COLS), pick(r, SURNAME_COLS)].filter((v) => v != null && String(v).trim()).map((v) => String(v).trim()).join(' ');
      if (name) out.set(id, name);
    }
    return out;
  }
  // Fictitious names for the synthetic sample patients, so the feature can be shown without real data.
  function sampleNames(ids) {
    const F = ['Lucía', 'Carmen', 'María', 'Ana', 'Isabel', 'Laura', 'Elena', 'Paula', 'Marta', 'Sofía', 'Antonio', 'Manuel', 'José', 'Francisco', 'David', 'Juan', 'Javier', 'Daniel', 'Carlos', 'Miguel'];
    const S1 = ['García', 'Martínez', 'López', 'Sánchez', 'Pérez', 'Gómez', 'Martín', 'Jiménez', 'Ruiz', 'Hernández', 'Díaz', 'Moreno', 'Muñoz', 'Álvarez', 'Romero', 'Navarro', 'Torres', 'Domínguez', 'Gil', 'Vázquez'];
    const out = new Map();
    for (const id of ids) {
      const r = rng(id * 104729 + 17);
      out.set(id, F[Math.floor(r() * F.length)] + ' ' + S1[Math.floor(r() * S1.length)] + ' ' + S1[Math.floor(r() * S1.length)]);
    }
    return out;
  }

  // ---------- Cleaning layer v1: free text from reception's daily sheets ----------
  // Reception describes each visit in free text ("Limp+Ortop+Cons", "6 IOI y 5 exos", "Rv. Orto."). The layer
  // turns each text into treatment acts, the clinic's own treatment lines (the letters reception already puts
  // on payments: G general, O orthodontics, PF fixed prosthesis, PR removable prosthesis, IM implants), tooth
  // numbers and events (no-show, urgency, complaint). Order: the clinic's dictionary of texts a person has
  // confirmed, then rules, then the patient's other lines the same days; what is left goes to a review queue.
  const LINE_CODES = ['G', 'O', 'PF', 'PR', 'IM'];
  const LINE_ORDER = ['IM', 'PF', 'PR', 'O', 'G']; // a row with several lines is counted in the first of these
  // Line names stay in Spanish in the data (like MN's own categories); lineName() translates for display.
  const LINE_ES = { G: 'General', O: 'Ortodoncia', PF: 'Prótesis fija', PR: 'Prótesis removible', IM: 'Implantes' };
  const LINE_EN = { G: 'General dentistry', O: 'Orthodontics', PF: 'Fixed prosthesis', PR: 'Removable prosthesis', IM: 'Implants' };
  const lineName = (c) => (LANG === 'es' ? LINE_ES : LINE_EN)[c] || c;
  const up = (s) => String(s == null ? '' : s).normalize('NFD').replace(/\p{M}/gu, '').toUpperCase().replace(/\s+/g, ' ').trim();
  const ACTS = [
    { key: 'allon', re: /\bALL ?-?ON ?-?(FOUR|4|SIX|6)\b|QUAD-? ?CIGOMA|PROTOCOLO (QUAD|ALL)/, line: 'IM', es: 'All-on-4/6 (arcada completa)', en: 'All-on-4/6 full arch', text: 'ALL-ON-4' },
    { key: 'implant', re: /\bIOI\b|\bIMPLANTES?\b|CIGOMATIC/, line: 'IM', tooth: true, es: 'Implante', en: 'Implant', text: 'IMPLANTE (IOI)' },
    { key: 'graft', re: /ELEVACION|INJERTO|\bHUESO\b|\bPRF\b|MEMBRANA|REGENERACION/, line: 'IM', es: 'Injerto o elevación de seno', en: 'Bone graft or sinus lift', text: 'INJERTO / ELEVACIÓN' },
    { key: 'hybrid', re: /HIBRIDA|ATORNILLAD|\bPMMA\b/, line: 'PF', es: 'Prótesis fija sobre implantes', en: 'Fixed prosthesis on implants', text: 'PRÓTESIS HÍBRIDA' },
    { key: 'crown', re: /\bCSIS?\b|\bCORONAS?\b|\bFUNDAS?\b|PUENTE|ZIRCONIO|METAL ?CERAMICA|CARILLA/, line: 'PF', tooth: true, es: 'Corona, funda o puente', en: 'Crown or bridge', text: 'CORONA' },
    { key: 'guard', re: /MICHIGAN|FERULA (DE )?DESCARGA/, line: 'PF', es: 'Férula de descarga', en: 'Night guard', text: 'FÉRULA DE DESCARGA' },
    { key: 'prep', re: /TALLADO|\bPROVI\b|PROVISIONAL/, line: 'PF', es: 'Tallado o provisional', en: 'Preparation or temporary', text: 'TALLADO / PROVISIONAL' },
    { key: 'removable', re: /COMPOSTURA|REMOVIBLE|DENTADURA|ESQUELETIC|ACRILIC|PROTESIS COMPLETA|ANADI+R|GANCHO|DIENTES? (DE (LA )?)?PROTESI|PIEZAS? (A |DE )?(LA )?PROTESI|ARREGLO PROTESI|REBASE/, line: 'PR', es: 'Prótesis removible o compostura', en: 'Removable prosthesis or repair', text: 'PRÓTESIS REMOVIBLE' },
    { key: 'ortho', re: /\bBRK|\bBRACKETS?\b|\bBKTS?\b|\bORTO\b|ORTODON|TWIN ?BLOCK|ESSIX|DISYUNTOR|MASCARA|\bREFI|INVISA|ALINEAD|ALIGNER|RETENEDOR|\bFERULAS\b/, line: 'O', es: 'Ortodoncia', en: 'Orthodontics', text: 'ORTODONCIA' },
    { key: 'endo', re: /\bENDO|APERTURA|RECUBR|PULP/, line: 'G', tooth: true, es: 'Endodoncia', en: 'Root canal', text: 'ENDODONCIA' },
    { key: 'extraction', re: /\bEXOS?\b|EXODON|EXTRAC|QUISTE|LEGRADO|LEGARDO|CORDAL/, line: 'G', tooth: true, es: 'Extracción o cirugía menor', en: 'Extraction or minor surgery', text: 'EXTRACCIÓN' },
    { key: 'filling', re: /EMPASTE|\bOBTU|\bRECO\b|RECONSTR|\bCIERRE\b|\bPIN\b|COMPOSITE/, line: 'G', tooth: true, es: 'Empaste o reconstrucción', en: 'Filling or build-up', text: 'EMPASTE' },
    { key: 'hygiene', re: /\bLIMP|\bPERIO|CURETAJE|RASPADO|MANTENIMIENTO|PROFILAXIS/, line: 'G', es: 'Limpieza o periodoncia', en: 'Cleaning or periodontics', text: 'LIMPIEZA' },
    { key: 'whitening', re: /BLANQUE/, line: 'G', es: 'Blanqueamiento', en: 'Whitening', text: 'BLANQUEAMIENTO' },
    { key: 'xray', re: /\bORTOP\b|ORTOPANTO|\bTAC\b|RADIOG|\bRX\b|ESCANER/, line: 'G', es: 'Radiografía o TAC', en: 'X-ray or CT scan', text: 'ORTOPANTOMOGRAFÍA' },
    { key: 'checkup', re: /\bCONS\b|CONSULTA|VALORA|\bPRESU|ESTUDIO|\bESTUD\b|\bREV|\bRV\b|\bREVI|\bRERV|PRIMERA VISITA|\bVISITA\b|URGENCIA/, line: 'G', es: 'Revisión, consulta o presupuesto', en: 'Check-up, consultation or quote', text: 'REVISIÓN' },
    { key: 'step', re: /MEDIDAS|PRUEBA|ENTREG|DEFINITIVO|\bFASE\b|IMPRESION|\bCEMENT|\bCEMTR|AJUST|ESTRUCTURA/, line: null, es: 'Paso de una prótesis o aparato', en: 'Step of a prosthesis or appliance', text: 'PRUEBA / ENTREGA' }
  ];
  const ACT = Object.fromEntries(ACTS.map((a) => [a.key, a]));
  const actLabel = (k) => (ACT[k] ? (LANG === 'es' ? ACT[k].es : ACT[k].en) : k);
  const TEXT_EVENTS = [
    { key: 'noshow', re: /NO VIENE|NO VINO|NO ACUDE|NO SE PRESENTA|NO LLEGO|NO ASISTE/, es: 'Falta (no vino)', en: 'No-show' },
    { key: 'resched', re: /SE CAMBIA|CAMBIA AL|CAMBIO DE CITA|APLAZA|\bANULA/, es: 'Cambio de cita', en: 'Rescheduled' },
    { key: 'urgent', re: /URGENCIA/, es: 'Urgencia', en: 'Urgent visit' },
    { key: 'complaint', re: /DOLOR|MOLESTIA|PARTID|CAID[OA]|MUERDE|ENTRA COMIDA|DESPEGAD|\bROT[OA]\b|SE MUEVE|LIMAR|NO SE QUEDO BIEN/, es: 'Queja o reparación', en: 'Complaint or repair' },
    { key: 'payment', re: /\bPAGA\b|\bPAGO\b|A CUENTA/, es: 'Nota de pago', en: 'Payment note' },
    { key: 'nothing', re: /^NADA\b|NADA QUE|\bVER\b|\bMINUTOS?\b/, es: 'Sin tratamiento', en: 'No treatment' }
  ];
  const eventLabel = (k) => { const e = TEXT_EVENTS.find((x) => x.key === k); return e ? (LANG === 'es' ? e.es : e.en) : k; };
  const QTY_NOUN = [[/^(EMPASTES?|OBTU)/, 'filling'], [/^(EXOS?|EXTRAC)/, 'extraction'], [/^(IOI|IMPLANTE)/, 'implant'], [/^(BRK|BRACKET|BKT)/, 'ortho'], [/^(CORONA|FUNDA|CARILLA|CSI)/, 'crown'], [/^ENDO/, 'endo']];
  // Removes numbers that are not teeth: amounts, dates, durations, quantities of pieces.
  const notTeeth = (t) => t.replace(/\d+[.,]\d+(\s*\*\s*\d+)?/g, ' ').replace(/\d+\s*€/g, ' ').replace(/\d+\s*\/\s*\d+/g, ' ')
    .replace(/\b\d+\s*(MESES|MES|M\b|MIN\w*|H\b|HORAS?|PIEZAS?|G\b|DIAS?|SEMANAS?|ANOS?|FERULAS?)/g, ' ').replace(/\b\d+(ª|A)\b/g, ' ');
  const mainLine = (lines) => LINE_ORDER.find((c) => lines.includes(c)) || null;
  const dictKey = (s) => up(s).replace(/\d+/g, '#').replace(/[^A-Z#ª ]+/g, ' ').replace(/\s+/g, ' ').trim();
  // dict: { dictKey: { line: 'G'|'O'|'PF'|'PR'|'IM'|'NONE' } } — texts a person has confirmed.
  function cleanText(desc, dict) {
    const t = up(desc);
    let acts = ACTS.filter((a) => a.re.test(t)).map((a) => a.key);
    // Package rules: a full-arch protocol includes its implants and prosthesis; a prosthesis "on implants"
    // is prosthesis work; on a hybrid, "composite" and "zirconio" are materials; a specific act makes the
    // generic words (check-up, try-in, delivery) part of that act.
    if (acts.includes('allon')) acts = acts.filter((k) => ['allon', 'extraction', 'graft'].includes(k));
    if (acts.some((k) => ['hybrid', 'crown', 'prep', 'removable', 'guard'].includes(k)) && /SOBRE\s+(\d+\s+)?(IMPLANT|IOI)/.test(t)) acts = acts.filter((k) => k !== 'implant');
    if (acts.includes('hybrid')) acts = acts.filter((k) => k !== 'filling' && k !== 'crown');
    if (acts.includes('removable')) acts = acts.filter((k) => k !== 'prep' && k !== 'ortho');
    const specific = acts.filter((k) => k !== 'checkup' && k !== 'step');
    if (specific.length) acts = specific;
    const events = TEXT_EVENTS.filter((e) => e.re.test(t)).map((e) => e.key);
    const clean = notTeeth(t);
    const teeth = Array.from(new Set((clean.match(/\b([1-4][1-8]|[5-8][1-5])\b/g) || [])));
    const qty = {};
    for (const m of t.matchAll(/\b(\d{1,2})\s*([A-Z]+)/g)) { const q = QTY_NOUN.find(([re]) => re.test(m[2])); if (q && acts.includes(q[1]) && +m[1] > 0) qty[q[1]] = +m[1]; }
    const toothActs = acts.filter((k) => ACT[k].tooth);
    if (toothActs.length === 1 && !qty[toothActs[0]] && teeth.length > 1) qty[toothActs[0]] = teeth.length;
    const money = /\d+([.,]\d+)?\s*€|\d+[.,]\d+\s*\*\s*\d|QUEDAN\s+\d+/.test(t);
    let lines = Array.from(new Set(acts.map((k) => ACT[k].line).filter(Boolean)));
    let status = lines.length ? 'rules' : acts.length ? 'step' : events.length ? 'event' : 'queue';
    const d = dict && dict[dictKey(desc)];
    if (d && d.line) { status = 'dict'; lines = d.line === 'NONE' ? [] : [d.line]; }
    return { text: String(desc == null ? '' : desc), acts: acts.map((k) => ({ key: k, qty: qty[k] || 1 })), lines, line: mainLine(lines), events, teeth, money, status };
  }
  // Payment method as reception writes it (T, E, EF, E/T…) or as MN names it.
  function payKind(v) {
    const s = norm(v);
    if (!s) return 'unknown';
    if (/^(e t|t e|ef t|t ef)$/.test(s) || (s.includes('efect') && s.includes('tarj'))) return 'mixed';
    if (s === 't' || s.includes('tarj') || s.includes('card') || s.includes('datafono')) return 'card';
    if (s === 'e' || s === 'ef' || s.includes('efect') || s.includes('cash') || s.includes('contado')) return 'cash';
    if (s.includes('transf') || s === 'tr' || s === 'trf') return 'transfer';
    if (s.includes('financ') || s === 'fin') return 'financing';
    return 'other';
  }
  const payCode = (concept) => { const m = String(concept || '').trim().match(/^(PF|PR|IM|I|G|O)\b/i); return m ? (m[1].toUpperCase() === 'I' ? 'IM' : m[1].toUpperCase()) : null; };

  // Pairs each doctor-tab line with its copy in the PRODUCCION tab (same day, patient and text). The two can
  // differ on purpose: the doctor's tab holds the base of the dentist's share, while PRODUCCION holds the clinic's
  // production (implants and prosthesis at their full value). Lines only in PRODUCCION go to the doctor whose
  // name starts the same way.
  function matchPartes(P) {
    const doc = P.lines.filter((l) => l.src !== 'produccion'), prod = P.lines.filter((l) => l.src === 'produccion');
    const prodDays = new Set(prod.map((l) => l.day));
    const key = (l) => l.day + '|' + l.pid + '|' + up(l.desc);
    const pk = new Map(); prod.forEach((l) => { const k = key(l); if (!pk.has(k)) pk.set(k, []); pk.get(k).push(l); });
    const pair = new Map(), used = new Set();
    for (const r of doc) { const c = (pk.get(key(r)) || []).find((l) => !used.has(l)); if (c) { used.add(c); pair.set(r, c); } }
    const tabs = Array.from(new Set(doc.map((l) => l.doctor)));
    const first = (s) => norm(s).split(' ')[0];
    const tabOf = (name) => tabs.find((t) => first(t) && first(t) === first(name)) || name;
    const extra = prod.filter((l) => !used.has(l)).map((l) => Object.assign({}, l, { doctor: tabOf(l.doctor) }));
    const clinicValue = (r) => (prodDays.has(r.day) && pair.has(r) ? pair.get(r).realizada || 0 : r.realizada || 0);
    return { doc, prod, prodDays, pair, extra, clinicValue };
  }

  // Daily sheets report: production, collections and the dentist's share by doctor, the check against the
  // PRODUCCION tab, the cleaning of the free text, production by treatment line and events written in the text.
  // opts.rate: dentist's share of the base (the clinic's sheets use 40% of production plus insurance fees,
  // plus the fixed amounts in the Especial column); opts.dict: texts a person has confirmed.
  function partesReport(ds, opts) {
    const P = ds.partes; if (!P || !P.lines || !P.lines.length) return null;
    const rate = opts && opts.rate != null ? opts.rate : 0.4, dict = (opts && opts.dict) || {};
    const M = matchPartes(P);
    const days = Array.from(new Set(P.lines.map((l) => l.day).concat((P.pays || []).map((p) => p.day)))).sort((a, b) => a - b);
    // Cleaning, then context: a try-in or delivery takes the line of the same patient's other work these days.
    const formC = (l) => ({ text: l.desc, acts: (l.act ? [{ key: l.act, qty: 1 }] : []), lines: [l.line], line: l.line, events: [], teeth: [], money: false, status: 'form' });
    const rows = M.doc.map((l) => Object.assign({}, l, { src0: l, clinic: M.clinicValue(l), c: l.line ? formC(l) : cleanText(l.desc, dict) }));
    const extraRows = M.extra.filter((l) => l.realizada > 0 || l.cobrado > 0).map((l) => Object.assign({}, l, { clinic: l.realizada || 0, onlyProd: true, c: cleanText(l.desc, dict) }));
    const all = rows.concat(extraRows);
    const ctx = new Map();
    const addCtx = (pid, line) => { if (pid == null || !line) return; let s = ctx.get(pid); if (!s) { s = new Set(); ctx.set(pid, s); } s.add(line); };
    all.forEach((r) => r.c.lines.forEach((x) => addCtx(r.pid, x)));
    (P.pays || []).forEach((p) => addCtx(p.pid, p.code || payCode(p.concept)));
    (ds.pending || []).forEach((p) => { if (p.pid != null) addCtx(p.pid, cleanText(p.desc).line); });
    all.forEach((r) => {
      if (r.c.status !== 'step') return;
      const s = ctx.get(r.pid);
      if (s && s.size) { const line = mainLine(Array.from(s)); r.c = Object.assign({}, r.c, { lines: [line], line, status: 'context' }); } else r.c = Object.assign({}, r.c, { status: 'queue' });
    });
    // By doctor: clinic production, the base of the dentist's share (doctor's tab + insurance fees), share, collections
    const byDoc = new Map();
    const docOf = (name) => { let x = byDoc.get(name); if (!x) { x = { doctor: name, days: new Set(), lines: 0, production: 0, base: 0, insurance: 0, collected: 0, special: 0, card: 0, cash: 0, otherPay: 0 }; byDoc.set(name, x); } return x; };
    for (const r of rows) {
      const x = docOf(r.doctor);
      x.days.add(r.day); x.lines++; x.production += r.clinic; x.base += (r.realizada || 0) + (r.seguro || 0); x.insurance += r.seguro || 0; x.collected += r.cobrado || 0; x.special += r.especial || 0;
      const k = payKind(r.fp); if (r.cobrado) { if (k === 'card') x.card += r.cobrado; else if (k === 'cash') x.cash += r.cobrado; else x.otherPay += r.cobrado; }
    }
    for (const r of extraRows) { const x = docOf(r.doctor); x.days.add(r.day); x.production += r.clinic; }
    const doctors = Array.from(byDoc.values()).map((x) => Object.assign(x, { days: x.days.size, share: rate * x.base + x.special })).sort((a, b) => b.production - a.production);
    const clinicPays = (P.pays || []).reduce((a, p) => a + (p.total || 0), 0);
    // Check against the PRODUCCION tab, on the days that have one.
    const check = { days: Array.from(M.prodDays).sort((a, b) => a - b), missing: [], extra: [], different: [] };
    for (const r of rows) {
      if (!M.prodDays.has(r.day)) continue;
      const p = M.pair.get(r.src0);
      if (!p) { if (r.realizada > 0 || r.cobrado > 0) check.missing.push({ day: r.day, doctor: r.doctor, pid: r.pid, desc: r.desc, amount: r.realizada || r.cobrado }); continue; }
      if (Math.abs((p.realizada || 0) - (r.realizada || 0)) > 0.5 || Math.abs((p.cobrado || 0) - (r.cobrado || 0)) > 0.5) check.different.push({ day: r.day, doctor: r.doctor, pid: r.pid, desc: r.desc, line: r.c.line, sheet: r.realizada || 0, prod: p.realizada || 0, sheetPaid: r.cobrado || 0, prodPaid: p.cobrado || 0 });
    }
    extraRows.forEach((l) => check.extra.push({ day: l.day, doctor: l.doctor, pid: l.pid, desc: l.desc, amount: l.realizada || l.cobrado }));
    check.ok = !!M.prod.length && !check.missing.length && !check.extra.length && !check.different.length;
    check.diffImplantProsthesis = check.different.filter((x) => ['IM', 'PF', 'PR'].includes(x.line) || /DEFINITIV|ENTREG|PRUEBA/.test(up(x.desc))).length;
    // Cleaning coverage over the doctor tabs' lines
    const cov = { total: rows.length, form: 0, dict: 0, rules: 0, context: 0, event: 0, queue: 0 };
    rows.forEach((r) => { cov[r.c.status === 'step' ? 'queue' : r.c.status]++; });
    const distinct = new Set(rows.map((r) => up(r.desc))).size;
    const queueMap = new Map();
    rows.filter((r) => r.c.status === 'queue').forEach((r) => { const k = dictKey(r.desc); const x = queueMap.get(k) || { key: k, text: r.desc, n: 0 }; x.n++; queueMap.set(k, x); });
    // Clinic production by treatment line (each row counted once, in its main line)
    const byLine = {}; LINE_CODES.concat(['?']).forEach((c) => { byLine[c] = { production: 0, rows: 0 }; });
    all.forEach((r) => { if (!(r.clinic > 0)) return; const c = r.c.line || '?'; byLine[c].production += r.clinic; byLine[c].rows++; });
    const paysByCode = {}; (P.pays || []).forEach((p) => { const c = p.code || payCode(p.concept) || '?'; paysByCode[c] = (paysByCode[c] || 0) + (p.total || 0); });
    const events = {}; TEXT_EVENTS.forEach((e) => { events[e.key] = 0; });
    rows.forEach((r) => r.c.events.forEach((e) => { events[e]++; }));
    const fpWritten = Array.from(new Set(rows.map((r) => String(r.fp || '').trim()).filter(Boolean)));
    const sum = (k) => doctors.reduce((a, x) => a + x[k], 0);
    return {
      days, rate, doctors, rows, extraRows, clinicPays, hasProd: M.prod.length > 0,
      totals: { production: sum('production'), base: sum('base'), insurance: sum('insurance'), collected: sum('collected') + clinicPays, collectedInSheets: sum('collected'), special: sum('special'), share: sum('share'), lines: rows.length, withAmount: rows.filter((r) => r.realizada > 0 || r.cobrado > 0).length },
      check, coverage: cov, distinct, queue: Array.from(queueMap.values()).sort((a, b) => b.n - a.n), byLine, paysByCode, events, fpWritten,
      teethRows: rows.filter((r) => r.c.teeth.length).length, multiRows: rows.filter((r) => r.c.acts.length > 1).length, moneyRows: rows.filter((r) => r.c.money).length
    };
  }

  // Pending treatment (MN "Presupuestos aceptados no realizados"): what is planned, accepted and paid (the
  // accountant treats it all as accepted, because reception often forgets the tick) but not recorded as done.
  const AGE_BUCKETS = [[0, 90], [91, 182], [183, 365], [366, 100000]];
  function pendingReport(ds) {
    const items = ds.pending; if (!items || !items.length) return null;
    const asOf = ds.asOf, total = items.reduce((a, x) => a + x.amount, 0);
    const age = (x) => asOf - x.day;
    const buckets = AGE_BUCKETS.map(([a, b]) => { const xs = items.filter((x) => age(x) >= a && age(x) <= b); return { from: a, to: b, n: xs.length, amount: xs.reduce((s, x) => s + x.amount, 0) }; });
    const byLine = {}; LINE_CODES.concat(['?']).forEach((c) => { byLine[c] = { amount: 0, n: 0 }; });
    items.forEach((x) => { const c = cleanText(x.desc).line || '?'; byLine[c].amount += x.amount; byLine[c].n++; });
    const old = items.filter((x) => age(x) > 182).sort((a, b) => b.amount - a.amount);
    const budgets = new Map();
    items.forEach((x) => { const k = x.budget || '—'; const b = budgets.get(k) || { budget: k, n: 0, amount: 0, first: x.day }; b.n++; b.amount += x.amount; b.first = Math.min(b.first, x.day); budgets.set(k, b); });
    const top = Array.from(budgets.values()).filter((b) => b.budget !== '—').sort((a, b) => b.amount - a.amount);
    const share = (f) => { const xs = items.filter(f); return total ? xs.reduce((s, x) => s + x.amount, 0) / total : 0; };
    const knownFlag = items.filter((x) => x.accepted != null).length;
    return {
      asOf, total, n: items.length, budgets: top.length, buckets, byLine, old, oldAmount: old.reduce((a, x) => a + x.amount, 0),
      topBudgets: top.slice(0, 10), top20Share: total ? top.slice(0, 20).reduce((a, b) => a + b.amount, 0) / total : 0,
      flags: {
        acceptedShare: knownFlag ? share((x) => x.accepted === true) : null, acceptedLines: items.filter((x) => x.accepted === true).length,
        userShare: items.filter((x) => x.user).length / items.length, collectedShare: items.filter((x) => x.collected > 0).length / items.length,
        sourceShare: items.some((x) => x.source !== undefined) ? items.filter((x) => x.source).length / items.length : null
      },
      oldest: Math.min.apply(null, items.map((x) => x.day)), newest: Math.max.apply(null, items.map((x) => x.day))
    };
  }
  const pendingOld = (ds) => { const r = pendingReport(ds); return r ? r.oldAmount : 0; };

  // Pending lines the daily sheets say are probably done already: the same patient has a later sheet line of the
  // same treatment line, or a delivery (entrega, cementar, colocar…), with a value close to the pending amount.
  // MN still lists them because reception wrote the work in the sheet, not in MN. Needs the patient number in the
  // pending export. Each sheet line backs one pending line at most; the PRODUCCION tab's value is preferred.
  const DELIVERY = /ENTREG|CEMENT|COLOC|DEFINITIV|\bIOI\b|IMPLANT|HIBRID|ALL ON|PROTESIS|PRÓTESIS/;
  function pendingLikelyDone(ds) {
    const all = ds.pending || [], items = all.filter((x) => x.pid != null && x.amount > 0);
    if (!all.length) return { available: null, matches: [], amount: 0 };
    if (!items.length) return { available: false, matches: [], amount: 0 };
    const keep = new Map(); // one sheet line per patient, day and text (PRODUCCION over the doctor's tab)
    ((ds.partes && ds.partes.lines) || []).forEach((l) => {
      const v = l.realizada || 0; if (!(v > 0) && !(l.especial > 0)) return;
      const k = l.pid + '|' + l.day + '|' + up(l.desc).trim(), cur = keep.get(k);
      if (!cur || (l.src === 'produccion' && cur.src !== 'produccion')) keep.set(k, l);
    });
    const byPid = new Map(); keep.forEach((l) => { const a = byPid.get(l.pid) || []; a.push(l); byPid.set(l.pid, a); });
    const used = new Set(), out = [];
    items.slice().sort((a, b) => b.amount - a.amount).forEach((x) => {
      const xl = cleanText(x.desc).line;
      let best = null, bs = 0;
      (byPid.get(x.pid) || []).forEach((l) => {
        if (used.has(l) || l.day < x.day - 14) return;
        const ll = l.line || cleanText(l.desc).line, v = l.realizada || 0;
        const s = (ll && xl && ll === xl ? 2 : 0) + (DELIVERY.test(up(l.desc)) ? 1 : 0) + (v > 0 && Math.abs(v - x.amount) / x.amount <= 0.05 ? 3 : v > 0 && Math.abs(v - x.amount) / x.amount <= 0.3 ? 2 : 0);
        if (s > bs || (s === bs && best && Math.abs(v - x.amount) < Math.abs((best.realizada || 0) - x.amount))) { bs = s; best = l; }
      });
      if (!best || bs < 3) return;
      used.add(best);
      out.push({ item: x, line: best, confidence: bs >= 4 ? 'high' : 'medium' });
    });
    return { available: true, matches: out, amount: out.reduce((s, m) => s + m.item.amount, 0) };
  }

  // Patient base: files opened, who has really been seen, who is due a recall.
  function patientBase(ds) {
    if (!ds.patients || !ds.patients.length) return null;
    const asOf = ds.asOf;
    const fromExport = ds.patients.some((p) => p.last !== undefined);
    let active12 = 0, active24 = 0, noVisit = 0, withNext = 0, bajas = 0;
    const recall = [];
    for (const p of ds.patients) {
      let last = null, next = null;
      if (fromExport) { last = p.last != null && p.last <= asOf ? p.last : null; next = p.next != null && p.next > asOf ? p.next : null; }
      else {
        const x = ds.by.get(p.id);
        if (x) for (const a of x.appts) { if (a.day <= asOf && a.status === ST.DONE) last = a.day; else if (a.day > asOf && next == null) next = a.day; }
      }
      if (p.baja != null) bajas++;
      if (last == null) { noVisit++; continue; }
      if (next != null) withNext++;
      if (last >= asOf - 365) { active12++; if (next == null) recall.push({ patient: p.id, last }); }
      if (last >= asOf - 730) active24++;
    }
    recall.sort((a, b) => a.last - b.last);
    const k = ds.lastMonth, y = Math.floor(k / 12);
    const count = (k1, k2) => ds.patients.filter((p) => p.first != null && p.first >= mkStart(k1) && p.first <= mkEnd(k2)).length;
    const ytd = { from: y * 12, to: k, cur: count(y * 12, k), prev: count(y * 12 - 12, k - 12) };
    ytd.change = ytd.prev ? ytd.cur / ytd.prev - 1 : null;
    const months = []; for (let i = k - 23; i <= k; i++) months.push({ k: i, n: count(i, i) });
    return { files: ds.patients.length, active12, active24, noVisit, withNext, bajas, recall, recallN: recall.length, ytd, months, fromExport };
  }

  // One patient's file, by number: everything the loaded data holds about that patient, for the assistant.
  // Numbers and figures only; the name is never part of it (the screen adds it from the key).
  function patientDetail(ds, id, risk) {
    const pid = Number(id), asOf = ds.asOf;
    if (!pid) return { found: false, note: 'Give a patient number.' };
    const p = ds.patients.find((x) => x.id === pid) || null;
    const x = ds.by.get(pid) || { appts: [], lines: [], pays: [] };
    const P = ds.partes || { lines: [], pays: [] };
    const sheet = P.lines.filter((l) => l.pid === pid && l.src !== 'produccion').sort((a, b) => a.day - b.day);
    const onAccount = P.pays.filter((q) => q.pid === pid).sort((a, b) => a.day - b.day);
    const pend = (ds.pending || []).filter((q) => q.pid === pid).sort((a, b) => a.day - b.day);
    if (!p && !x.appts.length && !x.lines.length && !x.pays.length && !sheet.length && !pend.length) return { patient: pid, found: false, note: 'No data for this patient number in the files loaded.' };
    const sum = (a, f) => a.reduce((s, v) => s + (f(v) || 0), 0);
    const d = (n) => (n == null ? null : iso(n));
    const done = x.lines.filter((l) => l.status === 'Realizado').sort((a, b) => (a.done || 0) - (b.done || 0));
    const open = x.lines.filter((l) => l.status === 'Pendiente');
    const past = x.appts.filter((a) => a.day <= asOf), future = x.appts.filter((a) => a.day > asOf);
    const seen = past.filter((a) => a.status === ST.DONE);
    const byLine = {}; done.forEach((l) => { const c = l.cat || 'Sin clasificar'; byLine[c] = (byLine[c] || 0) + l.price; });
    const r = (risk || []).find((q) => q.patient === pid);
    const pendingIn = (ds.pending || []).length ? (ds.pending.some((q) => q.pid != null) ? 'by patient' : 'no patient column') : 'not loaded';
    return {
      patient: pid, found: true, dataUpTo: d(asOf),
      file: p ? { registered: d(p.first), age: p.age, state: p.state || null, discharged: d(p.baja), lastVisitInMN: p.last === undefined ? undefined : d(p.last), nextVisitInMN: p.next === undefined ? undefined : d(p.next), totalCollectedInMN: p.paid, totalBilledInMN: p.billed } : null,
      visits: { past: past.length, lost: past.filter((a) => isLost(a.status)).length, lastSeen: seen.length ? d(seen[seen.length - 1].day) : null,
        upcoming: future.slice(0, 5).map((a) => ({ date: d(a.day), doctor: a.prof, reason: a.desc })),
        recent: past.slice(-8).map((a) => ({ date: d(a.day), doctor: a.prof, reason: a.desc, outcome: a.status })) },
      treatmentsDone: { count: done.length, value: sum(done, (l) => l.price), byLine, recent: done.slice(-10).map((l) => ({ date: d(l.done), treatment: l.name, line: l.cat, value: l.price, doctor: l.prof })) },
      treatmentsAcceptedNotDone: { count: open.length, value: sum(open, (l) => l.price), items: open.slice(0, 10).map((l) => ({ accepted: d(l.accept), treatment: l.name, value: l.price })) },
      payments: { count: x.pays.length, total: sum(x.pays, (q) => q.amount), recent: x.pays.slice(-10).map((q) => ({ date: d(q.day), amount: q.amount, method: q.method, concept: q.concept })) },
      dailySheets: { lines: sheet.length, done: sum(sheet, (l) => l.realizada), collected: sum(sheet, (l) => l.cobrado), recent: sheet.slice(-12).map((l) => ({ date: d(l.day), doctor: l.doctor, text: l.desc, done: l.realizada, collected: l.cobrado, method: l.fp, line: l.line || cleanText(l.desc).line || null })),
        paymentsOnAccount: onAccount.map((q) => ({ date: d(q.day), concept: q.concept, line: q.code || null, method: q.method, amount: q.total })) },
      pendingProduction: pendingIn === 'by patient' ? { lines: pend.length, amount: sum(pend, (q) => q.amount), items: pend.slice(0, 10).map((q) => ({ date: d(q.day), treatment: q.desc, amount: q.amount, quote: q.budget || null })) }
        : { available: false, note: pendingIn === 'not loaded' ? 'No pending list loaded.' : 'The pending list loaded has no patient number column, so it cannot be split by patient.' },
      followUpRisk: r ? { probability: r.probability, tier: r.tier, acceptedNotDone: r.pending, paidNotDone: r.prepaid, daysSinceVisit: r.daysSinceVisit, booked: r.booked, reasons: r.reasons } : null
    };
  }

  // ---------- Reading the clinic's files: MN exports and reception's daily sheets ----------
  // sheets: [{ name, aoa }] with each sheet as rows of cells (dates as Date, "YYYY-MM-DD" or Excel serials).
  // Daily sheets carry patient names: they are taken out of the data and returned apart as a key (number ->
  // name) that the page keeps only in memory or in the encrypted copy on this computer.
  const KNOWN_HEADERS = new Set(['fecha', 'fecha alta', 'fecha actuacion', 'fecha tratamiento', 'fecha cobro', 'n paciente', 'numero cliente', 'clientes numero cliente', 'numero paciente', 'paciente', 'nombre', 'usuario', 'descripcion',
    'cobrado', 'f p', 'realizada', 'pte cobr', 't costes', 'valoracion', 'especial', 'seguro', 'notas', 'nota', 'actuacion', 'concepto', 'forma cobro', 'forma de cobro', 'total', 'importe', 'estado', 'precio', 'descuento',
    'presupuesto aceptado', 'n presupuesto', 'tipo tratamiento', 'origen', 'importe cobrado', 'fuente de contacto', 'realizado', 'fecha realizacion', 'fecha baja', 'fecha creacion', 'f proxima actuacion', 'edad', 'tipo paciente',
    'total cobrado', 'total cobro', 'total facturado', 'expedientes', 'fecha ultima actuacion', 'profesional', 'gabinete', 'tratamiento', 'color', 'cobrado en el dia', 'a pagar', 'seguros', 'gastos', 'especiales']);
  function tablesFromSheets(sheets, fileName) {
    const tables = [], skipped = [], ignored = [], names = new Map();
    const num = (v) => (v === '' || v == null ? 0 : parseNum(v));
    const pidOf = (v) => { const n = parseInt(String(v == null ? '' : v).replace(/\.0+$/, '').replace(/\D/g, ''), 10); return isNaN(n) ? null : n; };
    for (const sh of sheets) {
      const aoa = (sh.aoa || []).map((r) => (Array.isArray(r) ? r : []));
      const from = fileName + (sheets.length > 1 ? ' · ' + sh.name : '');
      let hr = -1, best = 0;
      for (let i = 0; i < Math.min(4, aoa.length); i++) {
        const texts = aoa[i].filter((v) => typeof v === 'string' && /[a-zA-Z]/.test(v) && !/^\d{4}-\d\d-\d\d/.test(v));
        const score = texts.filter((v) => KNOWN_HEADERS.has(norm(v))).length * 10 + texts.length;
        const keyHdr = texts.length === 2 && texts.some((v) => /nombre/i.test(v)) && texts.some((v) => /n[uú]mero|n[º°.]/i.test(v)); // a names key: Nº + Nombre
        if ((texts.length >= 3 || keyHdr) && score > best) { best = score; hr = i; }
      }
      if (hr < 0) { if (aoa.some((r) => r.some((v) => v !== '' && v != null))) skipped.push(from); continue; }
      const hdr = aoa[hr].map((v) => String(v == null ? '' : v).trim()), H = hdr.map(norm);
      const has = (k) => H.includes(k);
      const col = (...ks) => { for (const k of ks) { const i = H.indexOf(k); if (i >= 0) return i; } return -1; };
      const body = aoa.slice(hr + 1);
      // Names key (patient number + name and nothing else): read into the names key, never into the data
      if (H.filter(Boolean).length <= 3 && col('numero cliente', 'n cliente', 'numero paciente', 'n paciente', 'clientes numero cliente') >= 0 && col('nombre', 'nombre y apellidos', 'nombre completo', 'paciente') >= 0) {
        const iP = col('numero cliente', 'n cliente', 'numero paciente', 'n paciente', 'clientes numero cliente'), iN = col('nombre', 'nombre y apellidos', 'nombre completo', 'paciente');
        for (const r of body) { const pid = pidOf(r[iP]); if (pid != null && String(r[iN] || '').trim()) names.set(pid, String(r[iN]).trim()); }
        continue;
      }
      // Daily sheet: one tab per doctor, or the PRODUCCION tab that consolidates them
      if (has('fecha actuacion') && col('clientes numero cliente', 'numero cliente', 'n paciente') >= 0 && (has('realizada') || has('valoracion'))) {
        const iD = col('fecha actuacion'), iP = col('clientes numero cliente', 'numero cliente', 'n paciente'), iN = col('nombre', 'paciente'), iU = col('usuario'), iDe = col('descripcion'),
          iC = col('cobrado'), iF = col('f p', 'fp', 'forma de pago', 'forma cobro'), iR = col('realizada'), iPt = col('pte cobr'), iV = col('valoracion'), iE = col('especial'), iS = col('seguro', 'sg');
        const isProd = norm(sh.name) === 'produccion', rows = [];
        for (const r of body) {
          const day = parseDay(r[iD]), pid = pidOf(r[iP]);
          if (day == null || pid == null) continue;
          if (iN >= 0 && String(r[iN] || '').trim()) names.set(pid, String(r[iN]).trim());
          rows.push({ 'Fecha': iso(day), 'Doctor': isProd ? String(iU >= 0 ? r[iU] : '').trim() : sh.name, 'Nº Paciente': pid, 'Descripción': String(iDe >= 0 && r[iDe] != null ? r[iDe] : '').trim(),
            'Cobrado': iC >= 0 ? num(r[iC]) : 0, 'F.P.': iF >= 0 ? String(r[iF] == null ? '' : r[iF]).trim() : '', 'Realizada': iR >= 0 ? num(r[iR]) : 0, 'Pte. Cobr': iPt >= 0 ? num(r[iPt]) : 0,
            'Valoración': iV >= 0 ? num(r[iV]) : 0, 'Especial': iE >= 0 ? num(r[iE]) : 0, 'Seguro': iS >= 0 && typeof r[iS] === 'number' ? r[iS] : 0, 'Hoja': isProd ? 'PRODUCCION' : 'Doctor' });
        }
        tables.push({ kind: 'parte', rows, from }); continue;
      }
      // Daily sheet: payments not tied to a doctor (payments on account, with the line letter in front)
      if ((has('actuacion') || has('concepto')) && has('fecha alta') && !has('fecha cobro')) {
        const iD = col('fecha alta'), iP = col('n paciente', 'numero cliente', 'numero paciente'), iN = col('paciente', 'nombre'), iCo = col('actuacion', 'concepto'), iF = col('forma cobro', 'forma de cobro'), iT = col('total', 'importe');
        const rows = [];
        for (const r of body) {
          const day = parseDay(r[iD]); if (day == null) continue;
          const pid = iP >= 0 ? pidOf(r[iP]) : null;
          if (pid != null && iN >= 0 && String(r[iN] || '').trim()) names.set(pid, String(r[iN]).trim());
          let amount = iT >= 0 ? num(r[iT]) : 0;
          if (iT < 0) { for (let j = r.length - 1; j > iCo; j--) { if (j !== iF && r[j] !== '' && r[j] != null && !isNaN(parseNum(r[j])) && parseNum(r[j]) !== 0) { amount = parseNum(r[j]); break; } } }
          const concept = String(r[iCo] == null ? '' : r[iCo]).trim();
          rows.push({ 'Fecha': iso(day), 'Hoja': sh.name, 'Nº Paciente': pid == null ? '' : pid, 'Concepto': concept, 'Código': payCode(concept) || '', 'Forma de cobro': iF >= 0 ? String(r[iF] || '').trim() : '', 'Total': amount });
        }
        tables.push({ kind: 'parte_pay', rows, from }); continue;
      }
      // Daily sheet: reception's own summary tab (not needed: the app recomputes it)
      if (has('cobrado en el dia') || (norm(sh.name) === 'resumen' && has('a pagar'))) { ignored.push(from); continue; }
      const objs = body.filter((r) => r.some((v) => v !== '' && v != null)).map((r) => { const o = {}; hdr.forEach((h, i) => { if (h) o[h] = r[i] == null ? '' : r[i]; }); return o; });
      // MN agenda export ("Fecha Actuación", "Hora Inicio Actuación", "Clientes.Número Cliente"): appointments
      if (has('fecha actuacion') && has('hora inicio actuacion') && col('clientes numero cliente', 'numero cliente') >= 0) {
        objs.forEach((o) => { Object.keys(o).forEach((k) => { if (['paciente', 'nombre', 'nif', 'movil paciente', 'telefono paciente'].includes(norm(k))) delete o[k]; }); });
        tables.push({ kind: 'appts', rows: objs, from, mnAgenda: true }); continue;
      }
      // MN "Presupuestos aceptados no realizados": patient name and NIF columns are dropped
      if (has('fecha tratamiento') && (has('presupuesto aceptado') || has('n presupuesto'))) {
        objs.forEach((o) => { Object.keys(o).forEach((k) => { if (['paciente', 'nif', 'nombre', 'movil paciente', 'telefono paciente', 'domicilio', 'codigo postal'].includes(norm(k))) delete o[k]; }); });
        tables.push({ kind: 'pending', rows: objs, from }); continue;
      }
      const kind = detect(hdr);
      if (kind) tables.push({ kind, rows: objs, from }); else skipped.push(from);
    }
    return { tables, skipped, ignored, names };
  }

  const DEFINITIONS = {
    get partes() { return L('Daily sheets: the Excel reception fills in each day, one tab per dentist (what was done, what was paid, how), plus payments on account in the Clínica tab and the PRODUCCION tab that consolidates them. The dentist\'s share is the clinic\'s own rule written on the sheets: 40% of production plus the fixed amounts in the Especial column.', 'Partes diarios: el Excel que rellena recepción cada día, una pestaña por odontólogo (qué se hizo, qué se cobró y cómo), más los cobros a cuenta de la pestaña Clínica y la pestaña PRODUCCION que los consolida. Lo que corresponde al doctor es la regla escrita en los propios partes: el 40% de lo producido más los importes fijos de la columna Especial.'); },
    get cleaning() { return L('Cleaning of free text: each description becomes treatment acts, a treatment line (G, O, PF, PR, IM: the letters reception already writes on payments), tooth numbers and events. First the clinic\'s dictionary of texts a person confirmed, then rules, then the same patient\'s other work those days; the rest waits in a review queue. An AI suggestion can help with the queue, but a person confirms.', 'Limpieza del texto libre: cada descripción se convierte en actos, una línea de tratamiento (G, O, PF, PR, IM: las letras que recepción ya pone en los cobros), números de diente y sucesos. Primero el diccionario de textos que una persona ha confirmado, después las reglas y después el resto del trabajo del mismo paciente esos días; lo demás espera en una cola de revisión. La IA puede proponer, pero confirma una persona.'); },
    get pending() { return L('Pending production: treatment in MN\'s "Presupuestos aceptados no realizados" list, by the date of the treatment. The accountant treats it all as accepted and paid, because reception often forgets to tick "Presupuesto Aceptado". The figure falls as completed work is entered in MN; lines older than six months are the most likely to be work already done and not entered.', 'Producción pendiente: tratamiento de la lista "Presupuestos aceptados no realizados" de MN, por fecha del tratamiento. La contable lo considera todo aceptado y cobrado, porque recepción a menudo olvida marcar "Presupuesto Aceptado". La cifra baja a medida que el trabajo hecho se mete en MN; las líneas con más de seis meses son las más probables de ser trabajo ya hecho y no metido.'); },
    get production() { return L('Production: value (list price) of treatment marked as done in the month, by date done. This is revenue earned.', 'Producción: valor (precio de tarifa) del tratamiento marcado como realizado en el mes, por fecha de realización. Es el ingreso ganado.'); },
    get collections() { return L('Collections: money received in the month (card, cash, transfer, financing), by payment date.', 'Cobros: dinero recibido en el mes (tarjeta, efectivo, transferencia, financiación), por fecha de cobro.'); },
    get unearned() { return L('Unearned revenue (paid but not yet done): for each patient, payments received minus value of treatment done, counted when positive, at the end of the period. Calculated per patient because MN Program does not link payments to specific treatments.', 'Cobrado y no realizado: para cada paciente, lo cobrado menos el valor del tratamiento realizado, si es positivo, al cierre del periodo. Se calcula por paciente porque MN Program no enlaza cada cobro con un tratamiento concreto.'); },
    get receivable() { return L('Done but not paid: for each patient, value of treatment done minus payments, counted when positive.', 'Realizado y no cobrado: para cada paciente, el valor del tratamiento realizado menos lo cobrado, si es positivo.'); },
    get newPatients() { return L('New patients: patient files opened in the month (MN "Fecha Alta"). Without registration dates, each patient\'s first first-visit appointment ("1 consulta" in MN), counted once even if MN lists it several times.', 'Pacientes nuevos: fichas abiertas en el mes ("Fecha Alta" de MN). Sin fechas de alta, la primera cita de primera visita ("1 consulta" en MN) de cada paciente, contada una sola vez aunque MN la repita.'); },
    get margin() { return L('Margin after materials and lab: production minus the direct cost of materials and laboratory work for the treatment done in the month, as a share of production. It is not net profit: salaries, rent and other overheads are not deducted.', 'Margen tras materiales y laboratorio: producción menos el coste directo de materiales y laboratorio del tratamiento realizado en el mes, en porcentaje de la producción. No es beneficio neto: no descuenta sueldos, alquiler ni otros gastos generales.'); },
    get treatmentLines() { return L('Treatment lines: treatment categories (implants, orthodontics, prosthodontics…), with treatments done, production, margin after materials and lab, and change against the same months last year. MN cannot tag treatments by type, so the clinic today only knows collections by type (an initial on each payment), not production.', 'Líneas de tratamiento: categorías de tratamiento (implantes, ortodoncia, prótesis…), con tratamientos hechos, producción, margen tras materiales y laboratorio y cambio frente a los mismos meses del año pasado. MN no permite tipificar los tratamientos, así que hoy la clínica solo sabe lo que cobra por tipo (una inicial en cada cobro), no lo que produce.'); },
    get dentist() { return L('Production by dentist: production of treatment done by each professional.', 'Producción por odontólogo: producción del tratamiento realizado por cada profesional.'); },
    get lostVisits() { return L('Lost visits: cancellations without a new date plus no-shows. Reception marks both in red ("anula la consulta") without telling them apart, so the app counts them together as lost; the recording standard adds one choice to separate them.', 'Citas perdidas: cancelaciones sin nueva fecha más ausencias. Recepción marca ambas en rojo ("anula la consulta") sin distinguirlas, así que la app las cuenta juntas como perdidas; el estándar de registro añade una opción para separarlas.'); },
    get decisionEvaluation() { return L('Decision evaluation: for monthly metrics, the average of the three full months before the decision month against the average of the full months after it, shown next to the same months a year earlier to separate the decision from seasonality. This is a before/after comparison, not proof of cause.', 'Evaluación de decisiones: en métricas mensuales, la media de los tres meses completos anteriores al mes de la decisión frente a la media de los meses completos posteriores, junto a los mismos meses del año anterior para separar la decisión de la estacionalidad. Es una comparación antes/después, no una prueba de causa.'); },
    get risk() { return L('Risk: a logistic regression trained on this clinic\'s own history estimates the probability that a patient with accepted, unfinished treatment completes nothing in the next 90 days. Inputs: days since last attended visit, whether an appointment is booked in the next 3 weeks, lost visits in the last 12 months, share of the plan already done, financing, size of the pending treatment, and whether the clinic called the patient in the last 30 days (from call results recorded in the decision log). It is retrained on every import and whenever call results change. If it does not rank patients better than the simple rule "no appointment booked and no visit in 60 days" on the latest held-out month, the app uses the rule instead.', 'Riesgo: una regresión logística entrenada con el historial de la propia clínica estima la probabilidad de que un paciente con tratamiento aceptado sin terminar no complete nada en los próximos 90 días. Entradas: días desde la última visita, si tiene cita en las próximas 3 semanas, citas perdidas en los últimos 12 meses, parte del plan ya hecha, financiación, importe pendiente y si la clínica le llamó en los últimos 30 días (de los resultados de llamada anotados en el registro de decisiones). Se reentrena en cada importación y cada vez que cambian los resultados de llamada. Si en el último mes de prueba no ordena a los pacientes mejor que la regla simple "sin cita reservada y sin visita en 60 días", la app usa la regla.'); }
  };

  const IC = {
    L, setLang, getLang, weekdayName,
    dn, iso, fromIso, mk, mkStart, mkEnd, mkLabel, mkShortYear, dayLabel, weekday, WEEKDAYS, ST, FEATURES, DEFINITIONS,
    simulate, snapshot, prepare, overview, series, production, collections, firstVisits, visitStats, lostByWeekday, lostByProfessional,
    balances, treatmentMix, topPatients, trainRisk, riskList, dormantPlans, contactsFrom, learnFromDecisions, followUpCheck, CALLED, recommendations, evalMetric, detect, fromTables, apptStatus, eur, pct,
    METRICS, monthlyValue, evalDecision, metricLabel, treatmentLines, dataQuality, marginPct, directCost, productionBy, isHygienist, EVENTS,
    keyFromRows, sampleNames,
    LINE_CODES, lineName, actLabel, eventLabel, ACTS, TEXT_EVENTS, cleanText, dictKey, payKind, payCode, partesReport, pendingReport, pendingOld, pendingLikelyDone, patientBase, patientDetail, tablesFromSheets, up
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = IC; else G.IC = IC;
})(typeof window !== 'undefined' ? window : globalThis);
