# Decision – Data – Model loop and technical design

Innovación Clínica Decision Manager · MSIM Group 7 · working document for the report and presentation. Aligned with report Draft 2 (sections 2–3, 5 Nov 2026).

Status labels:
- **Built**: works in the current prototype (`core.js`, `index.html`).
- **To build**: production items outside the prototype.
- **Needs process change**: the app supports it, but the clinic's MN data only allows it once reception follows the recording standard in report section 2.6.

Clinic facts used throughout (report Draft 2): about €75,000 revenue a month (about €1 million a year), net margin down from 17% to 12%, 17 staff (7 dentists on a rota, 4 hygienists, 2 receptionists, 1 treatment coordinator, 3 managers), 4 treatment rooms, about 40% of treatments financed, about 50 first visits a month. Primary user: the CEO. Budget: at most €1,000 a year.

---

## 1. The loop in one picture

The loop follows the managers' monthly cycle. The app is a management layer **on top of** MN Program, which stays the system of record.

```
 ┌──────────────────────────────────────────────────────────────────────────┐
 │ 1. DATA IN      MN Program exports (agenda, patients, payments, invoices)│
 │                 + accountant's Excel (pending production, costs)         │
 │                 → import, clean, map free text, pseudonymise             │
 └───────────────┬──────────────────────────────────────────────────────────┘
                 ▼
 ┌──────────────────────────────────────────────────────────────────────────┐
 │ 2. MODEL        Agreed KPI definitions · risk model (retrained on each   │
 │                 import) · recommendation rules · assistant (explains)    │
 └───────────────┬──────────────────────────────────────────────────────────┘
                 ▼
 ┌──────────────────────────────────────────────────────────────────────────┐
 │ 3. DECISION     The CEO (with owner-dentist / accountant) either answers │
 │                 a recommendation or LOGS A DECISION of their own:        │
 │                 what, why, metric, expected change, owner, review date   │
 └───────────────┬──────────────────────────────────────────────────────────┘
                 ▼
 ┌──────────────────────────────────────────────────────────────────────────┐
 │ 4. ACTION       Carried out in the clinic's normal way (offers, rota,    │
 │                 calls, supplier talks); recorded in MN as usual          │
 └───────────────┬──────────────────────────────────────────────────────────┘
                 ▼
 ┌──────────────────────────────────────────────────────────────────────────┐
 │ 5. OUTCOME      Next import → the app compares the metric before and     │
 │                 after the decision, next to the same months a year       │
 │                 earlier; the manager records Worked / Partly / Did not   │
 └───────────────┬──────────────────────────────────────────────────────────┘
                 ▼
 ┌──────────────────────────────────────────────────────────────────────────┐
 │ 6. LEARNING     Outcomes retrain the risk model, replace assumed effects │
 │                 with measured ones, reorder recommendations, and show    │
 │                 managers how realistic their expectations were ──► 2     │
 └──────────────────────────────────────────────────────────────────────────┘
```

Why it is closed: every decision (recommended or the managers' own) is stored with a metric, its value before the decision and the change the manager expected. The next import measures the same metric again. That result is used to judge the decision, to retrain the model and to calibrate the next expectations. This directly addresses root cause 4 in the report ("no decision record").

---

## 2. DECISION: the six decisions the app supports

The app **never acts**. It calculates, ranks and recommends; managers decide; staff act in their normal tools. Daily cabinet scheduling and clinical decisions are out of scope (report section 2.6).

| # | Decision (report Table 2.2) | Who decides | Frequency | Level | What the app provides | How it is measured |
|---|---|---|---|---|---|---|
| D1 | Pricing, discounts and promotions (e.g. 2026 orthodontics and implant offer) | CEO, owner-dentist, accountant | A few times a year | Strategic | Treatment-line production and margin; decision log | Production of the promoted line, before vs after |
| D2 | Marketing actions (e.g. €2 per Google review) | CEO | Ad hoc | Managerial | New patients vs 6-month average; value of a new patient; recommendation when they fall | New patients per month, before vs after |
| D3 | Hiring and dentist performance (e.g. new dentist in 2026) | CEO, owner-dentist | 1–2 a year | Strategic | Production by dentist; recommendation when a dentist drops, and a review of any dentist hired in the last 12 months | Production of that dentist |
| D4 | Treatment lines to promote | CEO, owner-dentist | Ad hoc | Strategic | Lines with production, margin and change vs last year; recommendation for the line losing most margin | Production of that line |
| D5 | Follow-up of paid, unfinished treatments | CEO, treatment coordinator, reception | Continuous (weekly list) | Operational / managerial | Risk score per patient, ranked call list, call-result recording | Paid-but-unfinished amount of the listed patients; continuation rate |
| D6 | Cost and margin control | Accountant, CEO | Monthly | Managerial | Margin after materials and lab, and which line's cost share rose most | Margin %, before vs after |

**Two ways a decision enters the log** (Built):
1. **Answering a recommendation**: Accept, Change (own wording) or Reject (reason required).
2. **Logging a decision of their own** ("Log a decision"): what was decided, type (D1–D6), date (can be in the past, to record 2026 decisions already taken), metric (clinic-wide, per treatment line or per dentist), **expected change**, owner, review date, why.

**When the model is uncertain or wrong** (Built):
- Every risk score shows its reasons; dormant patients (no activity for over a year) are reported apart and not scored.
- At every retraining the risk model is compared with a simple rule; if it does not beat it, the app uses the rule and says so.
- Recommendations require the same drop against the previous six months **and** the same months last year before flagging a dentist, so a promotion or season does not trigger them.
- Every evaluation is shown next to the same months a year earlier and labelled "before/after, not proof of cause".

---

## 3. DATA: what is captured, how, and where it is stored

### 3.1 Sources and what they really contain

What the September–October 2026 agenda export and the October Historial test showed (report section 2.5): appointment status, cancellation and "performed" fields are essentially unused (0 cancellations, 4 of 1,503 performed); descriptions are free text (857 variants); MN's Historial records only part of the treatments and holds no pending (accepted, not done) lines; the professional field is often empty. The app therefore uses the sources the clinic keeps reliably:

| Need | Source | Status |
|---|---|---|
| Appointments, last and next visit per patient, data quality | MN **Agenda** export (date, patient number, professional, description, status) | Export being configured |
| New patients | MN **Pacientes** export: Fecha Alta (new files), plus Total cobrado / facturado per patient | Template designed |
| Collections, payments on account, financing | MN **Control de Cobros** export (date, patient number, amount, payment method, concept) | Next |
| Production by treatment, line and dentist | MN **Facturas** and payment concepts, mapped to treatment lines with keyword rules and an LLM-assisted classifier for the rest (about 23% cannot be classified by keywords) | Next |
| Paid but not yet done | **Accountant's pending-production Excel** | To request |
| Material and lab costs | **Accountant's cost Excel** | To request |
| Appointment outcomes, first-visit label | Reception recording standard | Needs process change |

**Collection and cleaning** (Built in the importer, column names to be adjusted to the real exports):
1. Tables are recognised from their headers (Spanish or English, accents ignored).
2. Dates (Excel serials, `dd/mm/yyyy`, ISO) and Spanish amounts (`1.234,50 €`) are normalised.
3. MN agenda states map to attended / rebooked / lost / future.
4. Missing tables and the data date are reported; a **Data quality** card shows what share of the needed fields is actually recorded.

**Privacy and storage** (Built): exports are made with templates that leave out names, NIF, phones, addresses and clinical notes; patient numbers are replaced by codes on the clinic's computer before analysis; imported data stays in the browser and is not uploaded; the assistant only receives figures and patient codes. The repository blocks `.xlsx`/`.csv` files. The clinic's data protection officer reviews the design (report 2.6).

**Cadence**: managers decide monthly; data can be imported whenever needed (daily export is possible; monthly is enough for these decisions).

### 3.2 Decision data (generated by the app)

Every decision is a record in the **decision log**, stored in a shared database (collection `decisions`) so the three managers see the same log across imports and app versions (Built).

| Field | Meaning |
|---|---|
| `manual` | Logged by a manager (true) or answering a recommendation |
| `recId`, `kind`, `title`, `action` | What was decided and which of D1–D6 it belongs to |
| `decision`, `note` | Accepted / Modified / Rejected, and why (mandatory for rejections) |
| `owner`, `decidedOn`, `reviewDay`, `decidedAt` | Who is responsible, decision date (may be in the past), review date, timestamp |
| `metric` | What measures it: type, line or dentist, unit, whether higher or lower is better |
| `expected` | The change the manager expected (e.g. +15% new patients) |
| `baseline` | Metric before the decision (average of the three previous months, or the amount at decision time) |
| `predictions`, `calls`, `expectedRate` | Follow-up lists only: predicted risk per patient, call results, assumed response rate |
| `source` | Sample or imported data, so they never mix |
| `outcome` | At review: value after, change, verdict (Worked / Partly / Did not work), note |

### 3.3 Outcome data

Decisions are carried out in the clinic's normal way and show up in the **next export** (new patients, production by line or dentist, payments). Follow-up calls are recorded in the app, one drop-down per patient (Booked / Declined / No answer). With sample data, "Booked" patients are simulated to come back (75% attend) so the loop can be demonstrated.

---

## 4. MODEL: from data to decisions, and back

Four parts. Only the risk model learns statistically; the rest is deterministic so that money figures are exact and auditable. The LLM never computes a number.

### 4.1 KPI engine with agreed definitions (Built)

| KPI | Definition |
|---|---|
| Production | Value of treatment done in the month (earned revenue) |
| Margin after materials and lab | (Production − direct material and lab cost) ÷ production. Not net profit |
| Collections | Money received in the month, by payment date |
| Paid, not yet done | Per patient: payments − value done, summed where positive (customer advances, account 438) |
| New patients | Patient files opened in the month (Fecha Alta), until first visits are labelled consistently |
| Production by dentist | Production of treatment done by each professional |
| Treatment lines | Count, production, margin and change vs same months last year per category |
| Top patients | Patients ranked by value done in 12 months |
| Data quality | Share of appointments with an outcome, treatments with professional and cost, etc. |

### 4.2 Risk model for D5 (Built)

- **Question:** for a patient with accepted treatment not yet done, the probability that nothing is completed in the next 90 days.
- **Inputs (7):** days since last visit; appointment booked in the next 3 weeks; lost visits in 12 months; share of the plan done; financed; size of pending treatment (log); called by the clinic in the last 30 days.
- **Algorithm:** logistic regression by gradient descent (600 iterations, learning rate 0.8, L2 0.001): fast enough to retrain in the browser, explainable, outputs a probability that can be multiplied by money.
- **Training:** 13 monthly snapshots of the clinic's own history; 12 train, the latest fully observed one tests (rolling-origin backtest).
- **Checks shown to managers:** AUC vs the simple rule; stall rate of the riskiest 20%; calibration (predicted vs observed). Sample data: AUC ≈ 0.84 vs 0.73 for the rule.
- **With real MN data** the plan-related inputs come from the accountant's pending-production Excel and payments on account; "lost visits" is only available once outcomes are recorded (Needs process change). The fallback rule keeps the list usable meanwhile.

### 4.3 Recommendation rules, one per decision (Built)

| Rule | Trigger | Metric |
|---|---|---|
| D5 Follow-up | High-risk patients (≥ 60%) not called in the last 30 days; top 25 by amount paid | Paid-but-unfinished amount of those 25 |
| D2 Marketing | New patients in the last 2 months ≤ 88% of the previous 6-month average | New patients per month |
| D3 Dentist drop | A dentist's last 2 months ≥ 25% below both the previous 6 months and the same months last year (dentists above €2,000/month) | That dentist's production |
| D3 New hire | A dentist whose first treatment was 4–12 months ago: production vs the other dentists | That dentist's production |
| D4 Treatment lines | Lines down ≥ 10% vs last year; pick the one losing most margin in euros | That line's production |
| D6 Cost and margin | Margin over the last 3 months ≥ 1.5 points below the same months last year; names the line whose cost share rose most | Margin % |

D1 (pricing and promotions) has no automatic trigger: promotions are logged by managers and evaluated like any other decision; the D4 rule suggests where a promotion could pay.

### 4.4 Decision evaluation (Built)

For monthly metrics: average of the **three full months before** the decision month against the average of the **full months after** it, shown next to the **same months a year earlier** (to separate the decision from seasonality) and next to the **expected change**. Example on sample data: the March 2026 orthodontics and implant offer (expected +20%) shows implant production +17% while the same months a year earlier were +2%; the April Google reviews incentive (expected +15%) shows new patients −21% against −15% a year earlier, so the incentive did not offset the autumn drop.

### 4.5 Assistant (Built)

An LLM (Claude, through the claude.ai artifact runtime) answers managers' questions by calling 13 read-only functions of the app (overview, monthly series, production by dentist or room, treatment lines, treatment mix, lost visits, top patients, risk, recommendations, decisions with before/after, learning, data quality, definitions). Every figure must come from a function; patients appear by code only; it cannot write data or contact anyone.

### 4.6 How the model improves from decisions and outcomes

| # | Mechanism | Data it uses | What improves | Status |
|---|---|---|---|---|
| L1 | Retraining at every import | New appointments, treatments, payments | Risk model weights | Built |
| L2 | Before/after per decision | Decision log + next import | Each decision gets a measured result and a verdict | Built |
| L3 | Track record per decision type | Decision log | Recommendations of types that worked are listed first; types usually rejected move down | Built |
| L4 | Model monitoring and fallback | Held-out month; predictions saved on follow-up decisions | Calibration, "expected X of 25, observed Y", automatic fallback to the rule | Built |
| L5 | Learned effects | Results of past follow-up lists | The measured continuation rate replaces the "one in three" assumption | Built |
| L6 | Who responds to a call | Call results per patient | Reached vs no answer comparison; "called" feature in the risk model; called patients not re-listed for 30 days | Built |
| L7 | Calibrating managers' expectations | Expected vs measured change on logged decisions | Shows how realistic past expectations were (e.g. "measured change was on average −28% of what was expected"), countering hindsight and outcome bias (report refs [8][9]) | Built |
| L8 | Rule tuning from rejections | Rejection reasons | Managers adjust thresholds monthly | Process (human) |

---

## 5. Architecture (prototype)

```
 MN Program ──Excel exports (templates without identifiers)──┐
 Accountant's Excel (pending production, costs) ─────────────┤
                                                             ▼
                 Pseudonymisation script on the clinic's computer
                                                             ▼
 Browser app (single page) ─ Import: SheetJS → table detection → normalisation
   ├─ core.js: KPI engine · risk model (train + score) · rules · before/after
   ├─ UI: Overview · Recommendations · Decisions (log, call lists, learning)
   ├─ Decision log ──► shared database (collection "decisions")
   └─ Assistant ──tool calls──► core.js functions; Claude via claude.ai runtime
```

Plain HTML/JS, no server; `core.js` is unit-testable in Node. Running cost: within the €1,000/year budget (no licence beyond the AI usage). Production path: scheduled exports to an EU-hosted store, logins for the three managers, audit trail on the log.

---

## 6. Honest limits

- Prototype figures come from **synthetic data** sized like the clinic until the real exports are imported.
- MN's appointment outcomes, cancellations and performed flags are almost never recorded; lost-visit KPIs and some risk inputs depend on the recording standard.
- Pending production comes from the accountant's Excel until treatment plans and payments are linked.
- Before/after comparisons show association, not cause; the same-months-last-year figure and the reached-vs-no-answer comparison are partial controls.
- With sample data, the effect of "Booked" calls and the 2026 events (promotion, reviews incentive, new dentist, endodontist's reduced hours, fewer referrals from September) are simulated to demonstrate the loop.
