# Jelajah brand and avatars

The mark is a rounded lowercase **j** drawn as a journey path, with a mint destination dot. Its simple shape stays legible at small sizes. The wordmark is lowercase to feel approachable. The primary green is `#116B58`, with mint `#9FDAC0` and warm paper `#F6F5F1`.

## Assets

- `public/icon.svg`: scalable mark and favicon.
- `public/icon-maskable.svg`: maskable icon with a generous safe area.
- `public/icons/`: 192px and 512px PNG app icons.
- `public/brand/jelajah-logo.svg` and `.png`: green horizontal wordmark.
- `public/brand/jelajah-logo-light.svg`: white wordmark for dark backgrounds.

Keep clear space of at least the destination dot's diameter. Do not stretch the mark. The SVG wordmarks use Arial with a sans-serif fallback; use the supplied PNG for identical lettering across systems. App UI lettering follows its existing typography and localisation.

## Avatars

The sidebar and room occupants use locally generated DiceBear Shapes avatars. Only that style is imported. There are no network requests, API keys, image uploads, or paid avatar services. The library generates deterministic images from participant IDs (or user IDs for accounts without participants), without passing names or email addresses. Names remain visible alongside the decorative avatars. These are automatic defaults; profile customisation is not included yet.

DiceBear core is MIT-licensed; Shapes is CC0 1.0, permitting commercial use. Bundled notices are in `public/licenses/`. See [Shapes](https://www.dicebear.com/styles/shapes/) and the [JavaScript integration](https://www.dicebear.com/integrations/javascript/). Other styles may have different licences. This integration does not depend on the hosted HTTP API or its usage terms.

Installed operating systems may keep an old PWA icon until the app is reinstalled. The service-worker cache version is deliberately preserved to retain existing offline trip data.
