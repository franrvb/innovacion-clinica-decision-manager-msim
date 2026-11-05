# Innovación Clínica Decision Manager · MSIM

Prototype for the MSIM group project (Peking University, Group 7): a decision app for the managers of Innovación Clínica, a dental clinic in Valdepeñas (Spain) that runs on MN Program.

It closes a **Decision – Data – Model loop**:

1. **Data**: MN Program / Excel exports (appointments, treatments, payments, patients), or the built-in synthetic sample.
2. **Model**: deterministic KPIs, a logistic-regression risk model (probability that a patient with accepted, unfinished treatment makes no progress in 90 days), and rule-based recommendations.
3. **Decision**: managers accept, change or reject each recommendation; the decision log records owner, review date and the metric at decision time.
4. **Feedback**: at the next import the app measures the same metric again, and the manager records whether the decision worked.

An assistant ("Ask") explains the figures using only the app's own calculations.

> All patient data in this repository is synthetic. Do not commit real clinic exports.

## Files

| File | What it is |
|---|---|
| `core.js` | Logic without UI: sample-data simulation, KPI engine, risk model, recommendations, import parsing |
| `index.html` | The interface (Overview, Recommendations, Decisions, Import, Ask) |
| `build.mjs` | Inlines `core.js` into `index.html` |
| `dist/innovacion-clinica-management.html` | Built single-file page |

## Build

```bash
node build.mjs
```

Open `dist/innovacion-clinica-management.html` in a browser. The shared decision log and the assistant need the claude.ai artifact runtime; elsewhere the log is kept in the browser and the assistant is unavailable.
