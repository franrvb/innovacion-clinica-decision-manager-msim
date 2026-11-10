# Innovación Clínica Decision Manager · MSIM

Prototype for the MSIM group project (Peking University, Group 7): a decision app for the managers of Innovación Clínica, a dental clinic in Valdepeñas (Spain) that runs on MN Program. Only the three managers use it; reception and dentists keep working in MN and their usual Excel sheets.

It closes a **Decision – Data – Model loop**:

1. **Data**: MN Program / Excel exports (appointments, treatments, payments, patients), or the built-in synthetic sample.
2. **Model**: deterministic KPIs, a logistic-regression risk model (probability that a patient with accepted, unfinished treatment makes no progress in 90 days), and rule-based recommendations.
3. **Decision**: managers accept, change or reject each recommendation; the decision log records owner, review date and the metric at decision time.
4. **Feedback**: at the next import the app measures the same metric again, and the manager records whether the decision worked.

An assistant ("Ask") explains the figures using only the app's own calculations.

Working with the clinic's real files:

- **Daily sheets** (reception's Excel, one tab per doctor, plus the Clínica and PRODUCCION tabs): production, collections and each dentist's share (the clinic's own rule: 40% of the base plus fixed specials), a check against the PRODUCCION tab, and the **cleaning layer** that turns free text ("6 IOI y 5 exos") into acts, treatment lines (G, O, PF, PR, IM), teeth and events. Texts the rules cannot place go to a review queue; a person confirms (an AI suggestion can help) and the clinic's dictionary remembers it. Patient names in the sheets are separated from the data and kept only as the names key in the browser.
- **Pending production** (MN "Presupuestos aceptados no realizados"): total, age, treatment line, the list to reconcile (older than six months) and a decision measured at the next import.
- **Patient base** (MN patient list): patients really seen, recall list, new files against the year before.
- **Suggestions**: managers send requests from the app; they are stored in the shared database (collection `feedback`) with a status the builders update.

> All patient data in this repository is synthetic. Do not commit real clinic exports.

## Files

| File | What it is |
|---|---|
| `core.js` | Logic without UI: sample-data simulation, KPI engine, risk model, recommendations, import parsing, cleaning layer, daily-sheet and pending-production reports |
| `index.html` | The interface (Overview, Daily sheets, Pending production, Recommendations, Decisions, Import, Suggestions, Ask) |
| `build.mjs` | Inlines `core.js` into `index.html` |
| `dist/innovacion-clinica-management.html` | Built single-file page |

## Build

```bash
node build.mjs
```

Open `dist/innovacion-clinica-management.html` in a browser. The shared decision log and the assistant need the claude.ai artifact runtime; elsewhere the log is kept in the browser and the assistant is unavailable.
