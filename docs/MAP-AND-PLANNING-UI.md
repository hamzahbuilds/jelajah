# Planning UI and expanded maps

The live planning page now applies the approved journal concept's heading hierarchy, green ownership tabs and day cards, generous rounded surfaces, and wider desktop map. This is a planning-page pilot, not a claim that every screen matches the Figma reference. Money, administration and other workflows retain their existing layouts.

## English base maps

Leaflet still owns the pins, route overlays and user interactions. The default base layer now uses OpenFreeMap Liberty vector tiles through the MapLibre GL Leaflet bridge. Named features prefer `name:en`, then `name_en`, Latin names, and finally the original name. Missing translations may still appear in the local language. User-entered activity names and TokyoGTFS station names are not translated.

There is no API key. Attribution remains visible. Hosted tiles require an internet connection and a browser with WebGL. Provider errors produce a visible message without replacing calculated routes with straight lines. Existing `JELAJAH_TILE_URL` / `JELAJAH_TILE_ATTRIBUTION` overrides remain supported, but custom raster tiles cannot be translated by the app.

The Vite build emits a local MapLibre worker asset; this explicit worker configuration is required. Provider documentation: https://openfreemap.org/quick_start/

## Expanded view

Group and personal plans offer Expand map / Besarkan peta. The dialog contains the selected day's routes and itinerary cards below the map. Selecting a located activity focuses its numbered pin. Unlocated items stay visible with a missing-pin label. Close, Escape, scroll locking and keyboard focus restoration use the shared Modal component, now portalled to the document body to avoid clipping by page layouts.

Validation: production build; existing 252 unit tests; desktop and 390px mobile checks of Day 2, English base labels, train geometry, itinerary selection, close/focus restoration and horizontal overflow. Screenshots are in `design/journal-v029/expanded-map-desktop.png` and `expanded-map-mobile.png`.
