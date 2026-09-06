# Spec v0.24 — Dashboard/Sidebar/Plan Interaction Polish

**Status:** direct Sage feedback w/ screenshots, 6 Sep 2026 (feedback round = approval).

## 1 · Dashboard layout + Currency card

Problems (screenshot): cards sit flush/near-touching; Currency card spans full width with a tiny sparkline in a sea of empty space.
- Consistent vertical rhythm: one gap token (16px) between all dashboard cards; audit the dashboard stack for missing margins (cards touching "Up next" etc.).
- Currency card redesign: on desktop (≥1024px) Currency and "Up next" share a 2-column row (grid 1fr 1fr, gap 16). Inside Currency: sparkline stretches to the card's full width (currently fixed ~480px — make the svg width 100% preserveAspectRatio none, height ~72px); header row = title + range seg; rate line + badge below; range seg wraps under title on narrow. Mobile: cards stack as today, sparkline full-width.
- No data/logic changes to FxWidget — layout/CSS + svg sizing only.

## 2 · Sidebar foot cleanup + language placement

Problems: EN select box + orphan logout icon break the nav-item rhythm; icons look misaligned.
- Remove the language `<select>` and the bare logout icon row from the sidebar foot entirely.
- Add "Log out" as a proper nav-item (logout icon + label, same .nav-item grammar) below the user chip.
- Language moves to Settings ONLY (the Settings Language seg already exists for all users — verify it saves via PATCH /me lang like the old select did; wire if missing).
- Mobile topbar: remove its lang select too (Settings covers it); keep the rest.
- Icon alignment: all sidebar rows use the same `.ic` 20px column (audit: side-user avatar row indents differently — align avatar within the same grid so label columns line up).
- Collapsed rail: logout item shows icon-only like the rest.

## 3 · Plan transit chip alignment

Problem: walk/train chip sits centered over the vertical timeline line — looks overlapped.
- Chip aligns to the LEFT icon/pin column: `.tchip-row` renders the chip in the pin column's x-position (same left offset as `.pinno`, chip replaces the line segment visually: line pauses behind a solid-background chip). Concretely: chip gets the same left offset as the pin circles, solid var(--surface) background + border so the rail line doesn't show through, `::before` line continuation retained above/below. Desktop + mobile offsets both.

## 4 · Plan row actions redesign

Problem: per-row ▲▼ + checkbox + ✏️ + 🗑 + grip always visible = cluttered.
Target:
- **Checkbox** (done/select) stays inline on BOTH desktop and mobile — the only always-visible control. (It's the done-toggle; bulk-select behavior unchanged.)
- **Desktop:** an "Edit mode" toggle btn (ghost, edit icon) in the day-card header next to Select: default OFF hides ▲▼/edit/delete/grip per row; ON reveals them exactly as today. State per session (component state, not persisted).
- **Mobile (<1024px):** per-row overflow button "⋯" (Icon 'more', 44px target) — the only action control besides the checkbox; opens the shared Menu with: Edit, Move up, Move down, Delete (danger). Menu actions call the EXISTING handlers. The desktop Edit-mode controls are CSS-hidden on mobile; the ⋯ button hidden on desktop.
- Drag: drag handle only visible in desktop Edit mode (drag stays desktop-only affordance; mobile reorders via Move up/down in the menu — current behavior parity since e2e uses Move buttons).
- e2e: `title="Move up"` selectors — the buttons must still exist in DOM when Edit mode ON; e2e turns Edit mode on first (add the click step); mobile e2e may exercise the ⋯ menu (optional one assert).

## 5 · Constraints

Standard battery (no deps/commits; t() en+ms for new strings: editMode "Edit mode"/"Mod sunting", actions "Actions"/"Tindakan" if needed; behavior-freeze on all handlers — reorder/edit/delete/bulk logic byte-identical, only visibility wiring added; vitest/tsc/build per task; FULL ritual final, marker v0.24).
