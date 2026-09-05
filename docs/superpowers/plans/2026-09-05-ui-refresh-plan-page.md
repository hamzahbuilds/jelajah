# UI Refresh P4b — Plan Page Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Runs after P4 (complete, e2e-green).

**Goal:** Bring the Plan page — Jelajah's biggest, most-used screen — to the v0.19 design system per prototype `design/ui-refresh/02-plan.html`: day-pill rail with titles, numbered pin-rail activity list synced to the map, per-transport-mode route lines with legend, right column (map → budget → notes), shared Menu/Modal chrome. Zero behavior change to drag/reflow, times, fares, import/export, notes, budgets.

**Architecture:** Presentational restyle of `src/pages/Plan.tsx` (1514 lines) + a styling-prop extension to `LeafletMap.tsx`. The legs engine (`buildLegs` + `shared/fares`) already computes each leg's `mode` — per-mode polylines are a rendering map, no data work. All sub-modals move onto the shared `Modal`; the Data dropdown moves onto the shared `Menu`.

**Tech Stack:** unchanged. **Spec:** docs/07-spec-v0.19-design-system.md.

## Global Constraints

(Inherit ALL from P4 plan verbatim: RM0/no deps/no CDN; t() EN+BM; no server/shared/schema edits — `shared/` is read-only including fares/pins/reflow/csv; money+privacy sacred; Leader never Admin; Icon+viewBox, no functional emoji; dark -700 overrides; 44px targets; reduced-motion; no horizontal scroll 360px; vitest+tsc+build green per task; e2e selectors fixed same-task, full ritual in final task; no git commits; e2e kill pattern `ps aux | grep -E "[w]orkerd|[n]ode.*wrangler"`.)

**Behavior-freeze list (automatic-fail if changed):** drag-to-reorder + reflow + undoReflow; time computation; bulk select/delete; day title save; import/export/template (CSV + wizard); Suggest AI flow; leg mode/fare overrides + logFare to shared/private; day notes CRUD; budget modal math; start/end (stay) editing; MonthView; place search (Photon geocode); pin numbering via shared/pins.

---

### Task 1: Two-column layout + day-pill rail + day header

**Files:** Modify `src/pages/Plan.tsx` (layout regions + daychips), `src/styles.css` (port from `design/ui-refresh/02-plan.html`/`ui.css`: `.daypill` rail styles, `.plan-cols` two-column grid ≥1024px [main 1fr · right 360px], stacking <1024px main→map→budget→notes), `src/i18n.tsx` if new strings.
- [ ] `.daychips` → horizontal-scroll pill rail: each pill = D-number (brand, 600), date line, title line (bold when set) per prototype; active pill brand-tinted ring; keep click-to-select + existing keyboard behavior; MonthView toggle preserved.
- [ ] Day card header: "Mon 30 Nov · <title>" style (fmtDate + title), inline title edit flow UNCHANGED (same form, restyled `.fld` input + btn2); budget badge2 (existing budget data) at right; undoReflow/bulk buttons → btn2 ghost sm with icons.
- [ ] Wrap existing right-side content (legs/transport card, map card) into the right column; order: map, budget (link/badge opens existing BudgetModal), notes. Legs/transport card stays in main column under activities (it's interaction-heavy, not a sidebar widget — deviation from prototype, note it).
- [ ] Verify trio; grep e2e for daychip selectors, fix intent-preserved.

### Task 2: Activity list → numbered pin-rail rows

**Files:** Modify `src/pages/Plan.tsx` (activity row markup), `src/styles.css` (port `.rail`/`.stop` numbered-timeline styles: pin circle brand-600 with white number, vertical connector line, transit chip row between stops).
- [ ] Each activity row: pin-number circle (from existing `pinNumbers`/`actRef` — pin 1 = accommodation rule already implemented, DO NOT recompute), time range, title + badges (existing booked/category via ACTIVITY_CAT_ICON→Icon mapping where 1:1 names exist, else keep emoji as content), meta line (pax/cost/place), edit pencil (Icon) opening existing ActivityModal, drag handle (Icon grip) — drag/reorder handlers byte-identical (same DOM event wiring, only classes/structure around them change; test drag manually).
- [ ] Between consecutive stops: transit chip (mode icon + minutes + fare from existing legs data) — display only, tapping still opens existing leg mode/fare controls (or scrolls to transport card — pick the lighter wiring, note it).
- [ ] Bulk-select checkboxes + selection styling preserved; selected row tint var(--tile).
- [ ] Verify trio; e2e drag/reorder + bulk-delete selectors checked and fixed.

### Task 3: Per-mode route lines + map legend + right column

**Files:** Modify `src/components/LeafletMap.tsx` (new optional prop `routes?: { points: [number,number][]; mode: string }[]` rendering one polyline per leg with style map: train/metro solid `#0E9384` w2.5 · walk dotted `--gray-400` dashArray '1 6' · taxi/car dashed `#F79009` '7 5' · fallback solid gray), `src/pages/Plan.tsx` (pass per-leg routes from existing `legs` + chain coords; render `.maplegend` under map with the three swatches, labels via t() new keys en+ms `legTrain`/`legWalk`/`legTaxi`), `src/styles.css` (.maplegend, swatch styles).
- [ ] LeafletMap: additive prop only — existing pins/focus behavior untouched; polylines re-render on day change; no new tile/API usage.
- [ ] Map card header "Day map" + pins badge2 count; caption "same pin opens here" hint via t().
- [ ] Day budget card (right col): existing budget fields displayed lieflat-style rows (label · amount), edit via existing BudgetModal (btn2 ghost pencil).
- [ ] Day notes card under budget: existing notes/checklist CRUD restyled lrow-ish; add-note form → .fld + btn2.
- [ ] Verify trio; e2e notes/budget selectors fixed.

### Task 4: Data menu + modals onto shared chrome

**Files:** Modify `src/pages/Plan.tsx` (Data dropdown → shared `Menu` with icon+label+sub descriptions: import from sheet / export everything / download template / copy day as text IF an equivalent action exists — do NOT invent new actions; only wrap what the current menu offers), ActivityModal/StartEndModal/BudgetModal/Suggest preview → shared `Modal` wrapper (icon tile header, mfoot buttons btn2, fields → .fld) with ALL form logic/props/handlers unchanged; PlacePicker restyled in place.
- [ ] Suggest AI flow: same states, restyled chrome (spark icon).
- [ ] Import wizard/preview flow: same steps, Modal chrome where it's already overlay-like; if it's inline, restyle only.
- [ ] Destructive bulk delete → shared confirm pattern (reuse deleteNoUndo) — confirm this doesn't double-confirm if a confirm exists.
- [ ] Verify trio; e2e menu/modal selectors fixed (Data menu is exercised by import/export e2e steps — careful).

### Task 5: Plan-page emoji reconciliation + full e2e ritual + closeout

**Files:** `src/pages/Plan.tsx`, `src/pages/Review.tsx`, `src/components/FxWidget.tsx`, `src/components/ExpenseForm.tsx` (P4-final F2 parked items: mixed emoji/Icon within rows), `scripts/e2e.mjs`, `docs/build-status.md`.
- [ ] Replace chrome-side emoji in those rows with Icon where a 1:1 name exists (📅→calendar, 👤→user, 📍→pin, 💳→wallet, 🏪→bag, 💱→swap, ⚙ already done); MODE_ICON/KIND_ICON/status dots 🟢⚪🟠: mode/kind glyphs may map to Icon in UI layer WITHOUT touching shared/ (local map); colored status dots → badge2 dots. Trip emblem/map markers/StylePicker stay emoji.
- [ ] Full e2e ritual to `E2E PASSED` (plan page is e2e-heavy: import/export/drag/notes/budget — expect several selector rounds).
- [ ] build-status.md: P4b shipped; remaining: P5 cleanup, photo covers, server theme.

## Self-review notes
- shared/ read-only honored: pin numbering, reflow, fares, csv all consumed, never edited; mode→style map lives in UI layer.
- Task boundaries let e2e break mid-plan (T1–T4 fix own selectors, ritual only at T5) — matches P4 pattern that worked.
- Deviation recorded: legs/transport card stays in main column (interaction-heavy), prototype puts route data on map only.
