# Decision – Data – Model loop and technical design

Innovación Clínica Decision Manager · MSIM Group 7 · working document for the report and presentation.

Status labels used below:
- **Built**: works in the current prototype (`core.js`, `index.html`).
- **To build**: not yet in the code (production items only).

---

## 1. The loop in one picture

The loop runs once a month (the management cycle), with a weekly sub-cycle for treatment follow-up.

```
 ┌──────────────────────────────────────────────────────────────────────────┐
 │ 1. DATA IN      Monthly MN Program export (appointments, treatments,     │
 │                 payments, patients) → import, clean, normalise           │
 └───────────────┬──────────────────────────────────────────────────────────┘
                 ▼
 ┌──────────────────────────────────────────────────────────────────────────┐
 │ 2. MODEL        KPI engine · risk model (retrained on this import) ·     │
 │                 recommendation rules · assistant (explains, never acts)  │
 └───────────────┬──────────────────────────────────────────────────────────┘
                 ▼
 ┌──────────────────────────────────────────────────────────────────────────┐
 │ 3. DECISION     Manager accepts / changes / rejects each recommendation, │
 │                 names an owner and a review date → DECISION LOG          │
 │                 (stores the metric's baseline value at decision time)    │
 └───────────────┬──────────────────────────────────────────────────────────┘
                 ▼
 ┌──────────────────────────────────────────────────────────────────────────┐
 │ 4. ACTION       Staff carry it out in their normal work (calls, bookings │
 │                 and payments are recorded in MN Program as usual)        │
 └───────────────┬──────────────────────────────────────────────────────────┘
                 ▼
 ┌──────────────────────────────────────────────────────────────────────────┐
 │ 5. OUTCOME      Next export → app re-measures each decision's metric,    │
 │                 manager records Worked / Partly / Did not work           │
 └───────────────┬──────────────────────────────────────────────────────────┘
                 ▼
 ┌──────────────────────────────────────────────────────────────────────────┐
 │ 6. LEARNING     New outcomes become training labels (risk model);        │
 │                 decision results recalibrate expected effects and        │
 │                 recommendation priorities  ──────────► back to step 2    │
 └──────────────────────────────────────────────────────────────────────────┘
```

Why this is a closed loop and not a one-way dashboard: every recommendation carries a measurable metric, every decision stores that metric's value at the moment of deciding, and the next import measures it again. Decisions therefore produce data, that data is used to judge the decision and to retrain the model, and the improved model produces the next recommendations.

---

## 2. DECISION: what the app supports, and who decides

The app **never acts on its own**. It calculates, ranks and recommends; a person decides; staff act in their normal tools. This keeps clinical and commercial judgement with people and keeps the app out of patient contact.

| Decision | Who decides | Who executes | Frequency | Management level | What the app provides |
|---|---|---|---|---|---|
| D1. Which patients with accepted, unfinished treatment to contact, and in what order | Manager (dentist can veto on clinical grounds) | Reception | Weekly | Operational / managerial | Risk score per patient, expected loss, reasons, ranked call list (top 25) |
| D2. Whether to change appointment-confirmation policy on a weekday with many lost visits | Manager | Reception | Monthly | Managerial | Lost-visit rate by weekday and professional, excess lost visits per month |
| D3. Whether to act on falling first visits (acquisition channels) | Director | Director / marketing | Monthly–quarterly | Strategic | First visits vs 6-month average, average accepted value per new patient |
| D4. Whether to reassign hours in a treatment room producing below its usual level | Manager | Manager / professionals | Monthly | Managerial | Production by room vs 6-month average |
| D5. Whether to chase treatment done but not paid | Manager / accounting | Accounting, reception | Monthly | Operational | Total and number of patients owing |

**What the app decides automatically** (Built): which KPIs to show, how to rank patients by risk, which recommendations to raise and with what evidence. **What remains human** (Built): accepting, changing or rejecting; naming an owner; choosing the review date; judging whether the result counts as success.

**When the model is uncertain or wrong:**
- Every risk score shows its reasons (e.g. "No appointment booked · No visit in 223 days"), so a manager can see why a patient is ranked high. (Built)
- Patients with no activity for over a year are reported separately as "dormant" and not scored, because the model was not trained on them. (Built)
- The manager can change or reject any recommendation; a rejection requires a reason, which is stored. (Built)
- At each retraining the model is compared with a simple rule ("no appointment booked and no visit in 60 days") on the latest held-out month. If the model does not beat the rule, the app falls back to the rule (with stall rates estimated from the training period) and says so on the Overview. (Built)
- Patients called in the last 30 days are left out of the next call list, so the same patients are not called again before their outcome is known. (Built)

---

## 3. DATA: what is captured, how, and where it is stored

### 3.1 Operational data (from MN Program)

| Table | Fields used | Used for |
|---|---|---|
| Appointments | patient number, date, status, professional, room, type/description | Lost visits, first visits, days since last visit, booked future appointment |
| Treatment plan lines | patient number, plan number, date accepted, treatment, amount, status, date done, professional, room | Production, treatment mix, room production, pending treatment, risk model labels |
| Payments | patient number, payment date, amount, payment method, concept | Collections, paid-not-done (unearned revenue), financing flag |
| Patients (optional) | patient number, registration date, age | First-visit cohorts, new-patient value |

**Collection** (Built): a manager exports the lists from MN Program to Excel/CSV (MN has an Excel button on each list) and drops them into the app's Import window. The app:
1. recognises each table from its column headers (Spanish or English, accents ignored);
2. converts dates (Excel serial numbers, `dd/mm/yyyy`, ISO) and Spanish number formats (`1.234,50 €`);
3. maps MN agenda states to four outcomes: attended (*Realizada*, *En consulta*, *En sala de espera*), cancelled and rebooked (*Cancelada refijada*), lost (*Cancelada no refijada*, *No llegó*, *No contesta*), future (*Programada*, *sin confirmar*);
4. reports missing tables and the date the data runs to.

**Storage** (Built): imported data stays in the browser's memory; it is not uploaded. Patients are identified only by number. In production this becomes an EU-hosted database with role-based access and encryption (To build, outside prototype scope).

**Why MN alone cannot produce these figures:** in MN, payments are entered "a cuenta" with free-text concepts and appointments carry free-text descriptions; neither is linked to the treatment-plan line. The app reconstructs the link per patient (payments received minus value of treatment done), which is how "paid, not yet done" and the risk features are computed.

### 3.2 Decision data (generated by the app itself)

Every decision creates a record in the **decision log** (Built). Fields as stored:

| Field | Meaning |
|---|---|
| `recId`, `kind`, `title` | Which recommendation it answers (follow-up, lost visits, new patients, rooms, collections) |
| `decision` | Accepted / Modified / Rejected |
| `action` | The action as approved (the manager's own wording if changed) |
| `note` | Reason for rejection (mandatory) or comment |
| `owner` | Person responsible |
| `decidedOn`, `reviewDay`, `decidedAt` | Data date at decision, review date (2 weeks / 1 month / 2 months later), timestamp |
| `metric` | How success is measured: type, parameters (e.g. the 25 patient numbers), label, unit, whether lower or higher is better |
| `baseline` | Metric value and data date at the moment of deciding |
| `predictions` | Follow-up decisions only: each listed patient's predicted risk at decision time (for model monitoring) |
| `expectedRate` | The response rate the recommendation assumed or had learned when it was made |
| `calls` | Follow-up decisions only: per patient, the call result (Booked / Declined / No answer) and date |
| `source` | Sample or imported data, so decisions on synthetic data never mix with real ones |
| `outcome` | At review: metric value on the new data, verdict (Worked / Partly / Did not work), note |

**Storage** (Built): a shared database (collection `decisions`) attached to the app, so all managers see the same log and it survives new imports and new versions of the app.

### 3.3 Outcome data (generated by the clinic's normal work)

Staff carry out decisions in their usual way: reception books the patient in MN, accounting registers the payment in MN. No double entry is needed: the effect appears in the **next export** (new attended appointments, treatment lines marked done, new payments). The app then re-measures each open decision's metric on the new data (Built).

To learn *which* patients were actually contacted, reception records each call result on the decision's call list in the Decisions tab: one drop-down per patient (Booked / Declined / No answer), saved immediately to the decision log (Built). With sample data, the simulation lets 75% of "Booked" patients attend and complete their next pending treatment, so the loop can be demonstrated; with real data the effect comes from the next MN export.

---

## 4. MODEL: how data becomes decisions, and how outcomes improve the model

The "model" layer has four parts. Only one of them learns statistically; the others are deliberately deterministic so that money figures are exact and auditable.

### 4.1 KPI engine (Built, deterministic)

| KPI | Definition |
|---|---|
| Production | Value of treatment marked done in the month (earned revenue) |
| Collections | Money received in the month, by payment date |
| Paid, not yet done | Per patient: payments − value of treatment done, summed where positive |
| Done, not paid | Per patient: value done − payments, summed where positive |
| First visits | Attended appointments of type *Primera visita* |
| Lost visits | (No-shows + cancellations without new date) ÷ all past appointments |
| Production by room | Production of treatment done in each *gabinete* |
| Treatment mix / top patients | Count and value of treatments done; patients ranked by value done in 12 months |

A large language model never computes these numbers; it only reads them.

### 4.2 Risk model (Built): who is likely to abandon treatment

- **Question:** for a patient with accepted treatment not yet done, what is the probability that **no treatment is completed in the next 90 days**?
- **Population:** patients with pending accepted treatment, excluding dormant ones (no attended visit, no new acceptance and nothing booked for over a year).
- **Inputs (7 features):**
  1. days since last attended visit (capped at 365)
  2. appointment booked in the next 3 weeks (yes/no)
  3. lost visits in the last 12 months (capped at 5)
  4. share of the plan's value already done
  5. treatment financed (yes/no)
  6. size of pending treatment (log scale)
  7. called by the clinic in the last 30 days (yes/no), taken from call results in the decision log
- **Algorithm:** logistic regression trained by gradient descent (600 iterations, learning rate 0.8, L2 penalty 0.001). Chosen because it is fast enough to retrain in the browser in under a second, its weights can be explained to managers, and it outputs a probability that can be multiplied by money.
- **Training data — built from the clinic's own history:** the app replays the past as 13 monthly "snapshots" (each taken 90 + 30·j days before the export date). For each snapshot it computes every eligible patient's features *as they were then* and the label *what happened in the next 90 days*. Twelve snapshots train the model; the most recent fully observed one tests it. This is a rolling-origin backtest: the model is always evaluated on a period it has not seen.
- **Quality checks shown to managers:** AUC of the model vs AUC of the simple rule; stall rate among the 20% highest-risk patients vs all patients; calibration (average predicted risk vs observed stall rate, overall and for the riskiest 20%). On the synthetic sample data: AUC ≈ 0.86 vs ≈ 0.76 for the rule; predicted 49% vs observed 51% overall, 83% vs 83% for the riskiest 20%. Real figures will come from the MN export.
- **Retraining:** on every import, and again whenever call results in the decision log change.
- **Output:** probability, tier (High ≥ 60%, Medium ≥ 30%, Low), expected loss = probability × pending value, and plain-language reasons. Recommendation D1 takes the 25 high-risk patients with the most money already paid.

### 4.3 Recommendation engine (Built): rules over KPIs and model output

| Rule | Trigger (current thresholds) | Metric used to judge the decision |
|---|---|---|
| R1 Follow-up | Any High-risk patients; list the top 25 by amount paid | Paid-but-unfinished value of those 25 patients (lower is better) |
| R2 Lost visits | A weekday's lost rate ≥ 1.3 × other days, with ≥ 60 appointments in 3 months | That weekday's lost rate (lower is better) |
| R3 New patients | First visits in last 2 months ≤ 88% of the previous 6-month average | First visits per month (higher is better) |
| R4 Rooms | A room's production in last 2 months ≥ 15% below its 6-month average (rooms over €2,000/month) | That room's monthly production (higher is better) |
| R5 Collections | Done-not-paid total above €2,500 | Done-not-paid total (lower is better) |

Each recommendation states its evidence, a suggested action, an expected effect, and the metric it will be judged by.

### 4.4 Assistant (Built): explains, does not decide

An LLM (Claude, through the claude.ai artifact runtime) answers managers' questions. It can only call 10 read-only functions of the app (overview, monthly series, production by room, treatment mix, lost visits breakdown, top patients, risk list, recommendations, decision log, definitions). Rules in its instructions: every figure must come from a function, state period and definition, present causes as hypotheses, patients by number only. It cannot write data, change decisions or contact anyone, and asks the viewer's permission before first use.

Why an LLM here rather than more dashboards: managers' questions vary ("why did October drop?", "who should we call first?") and need combining several figures and explaining them in plain Spanish. Tool calling keeps the numbers exact while the model handles language. It is optional: all figures remain usable if the assistant is unavailable.

### 4.5 How the model improves from decisions and outcomes

| # | Feedback mechanism | Data it uses | What improves | Status |
|---|---|---|---|---|
| L1 | **Retraining at every import** | New appointments, treatments done and payments since the last export | The risk model's weights adapt to the clinic's latest behaviour; recent outcomes become new labelled examples | Built |
| L2 | **Outcome measurement per decision** | Decision log baseline + next import | Shows whether each decision moved its metric; manager records the verdict | Built |
| L3 | **Decision scorecard** | Decision log | Acceptance and success rates show managers which kinds of recommendation are worth acting on | Built |
| L4 | **Model monitoring and fallback** | Held-out month at every retraining; predictions saved on each follow-up decision vs what happened to those patients | Calibration and model-vs-rule check on every import; per decision, "expected X of 25 not to continue, so far Y have not"; automatic fallback to the simple rule if the model stops beating it | Built |
| L5 | **Learned expected effects and ordering** | Outcomes of past accepted decisions | Once ≥ 10 patients from earlier call lists are at least 4 weeks old, the follow-up recommendation uses the measured continuation rate instead of the "one in three" assumption. Recommendations are ordered by each kind's success rate (Worked = 1, Partly = 0.5); kinds rejected in ≥ 60% of ≥ 3 decisions move down | Built |
| L6 | **Learning who responds to a call** | Call results per patient (Booked / Declined / No answer) | Compares continuation for patients reached by phone vs no answer; feeds "called in last 30 days" into the risk model as a feature, which gets a weight once calls have a known 90-day outcome; called patients are not re-listed for 30 days | Built |
| L7 | **Rule tuning from rejections** | Rejection reasons in the log | Managers review recurring reasons monthly and adjust thresholds (e.g. ignore hygiene rooms in R4) | Process (human), supported by the stored reasons |

The Decisions tab shows a "What the app has learned" panel summarising L4–L6, and the assistant can read it (`get_learning`).

Example from the sample data: on 3 Nov the manager accepts a call list of 25 patients and reception records 15 Booked, 5 Declined, 5 No answer. On the 3 Dec import the app reports that 36% of those patients continued treatment (45% of those reached by phone, 0% of those who did not answer); the model had expected 18 of 25 not to continue and 16 have not so far; the next follow-up recommendation uses the measured 36% for its expected effect and leaves those 25 patients out.

---

## 5. System architecture (prototype)

```
 MN Program ──Excel/CSV export──► Browser app (single page)
                                   ├─ Import: SheetJS parser → table detection → normalisation
                                   ├─ core.js: KPI engine · risk model (train + score) · rules
                                   ├─ UI: Overview · Recommendations · Decisions (SVG charts)
                                   ├─ Decision log ──► shared database (collection "decisions")
                                   └─ Assistant ──tool calls──► same core.js functions
                                                  └──► Claude (LLM) via claude.ai runtime
```

- **Technology:** plain HTML/CSS/JavaScript, no server; `core.js` holds all logic and is unit-testable in Node; SheetJS reads Excel/CSV; charts are hand-drawn SVG.
- **Performance:** on a clinic-sized dataset (≈57,000 appointments, 51,000 treatment lines, 44,000 payments over 3.5 years) simulation + import + retraining takes well under a second in the browser.
- **Privacy by design:** no names needed; files are read locally; the LLM receives only aggregated figures and patient numbers; the repository blocks `.xlsx`/`.csv` files.
- **Production path:** scheduled export from MN (or MN's API if available) to an EU-hosted database; staff login with roles; audit trail on the decision log; same `core.js` running server-side.

---

## 6. Honest limits to state in the report

- Prototype figures come from **synthetic data** until the MN export is imported; model quality on real data is unknown until then.
- "Paid, not yet done" is calculated **per patient**, not per treatment line, because MN does not link payments to treatments.
- The app measures *whether the metric changed*, not *whether the decision caused it*. The reached-vs-no-answer comparison (L6) is a first comparison group but not a randomised one: patients who answer may differ from those who do not. A stronger test would call alternating halves of the list in alternate weeks.
- In the sample data, the effect of a "Booked" call is simulated (75% attend); it demonstrates the mechanism, not the real effect size.
- Imports are manual and monthly; this is adequate latency for managerial decisions, not for daily operations.
