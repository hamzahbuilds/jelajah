// Map data types and marker HTML, kept apart from LeafletMap.tsx so importing
// them doesn't load Leaflet + MapLibre (v0.38 perf).
export interface Pin { lat: number; lng: number; label?: string; icon?: string }

/** Marker HTML for a sprite icon (the <IconDefs> sprite is in the DOM, so <use> resolves inside Leaflet divIcons). */
export const pinIcon = (name: string, size = 14) =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" class="icon" aria-hidden="true"><use href="#i-${name}"/></svg>`;

export interface Arc { from: Pin; to: Pin; label?: string }

export interface Route { points: [number, number][]; mode: string; color?: string; label?: string }
