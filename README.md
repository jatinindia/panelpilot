# PanelPilot

Split product collages into individual panel images, entirely in the browser. Images are never uploaded.

## Run

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests (Vitest)
npm run build      # typecheck + production build into dist/
npm run preview    # serve the production build
```

`dist/` is a static site: host it anywhere (or open it from any static file server).

## Using it

1. **Add collages**: drop files anywhere on the page, paste an image (Ctrl/Cmd+V), or browse. Or try the built-in sample.
2. **Check the crops**: each source gets a confidence badge (`high`, `medium`, `review`, `error`). Areas outside every crop are dimmed.
3. **Adjust**:
   - Drag on the image to draw a new crop (hold Alt/Option to start one on top of an existing crop).
   - Drag a crop to move it, or drag its handles to resize it.
   - Rename, reorder, duplicate or delete crops in the right-hand list.
   - Change **Sensitivity** or **Trim background margins**, then press **Re-detect**.
   - **Apply to all** copies the current layout to every other source, for batches made from one template.
   - **Trim to content** shrinks the selected crop (or all crops) to the product inside it, plus a margin you choose. It works best on plain backgrounds; on gradients it may cut unevenly.
   - **Saved layouts**: name the current crop layout and apply it to any collage later (it scales to the image size).
4. **Export**: PNG, JPEG or WEBP, with quality, padding, a background color, and a file-name template (`{source}`, `{n}`, `{label}`). **Output size** presets frame each crop for marketplaces: square 1:1, portrait 4:5, 2000×2000 (Amazon, Shopify), 1080×1080 and 1080×1350 (Instagram), or a custom size. The product is centered and scaled to fit inside the padding. Export everything, the current source, or just the selected crop. One image downloads directly. Several are bundled into a ZIP with one folder per source.

Every edit can be undone (Ctrl/Cmd+Z, Shift to redo). Undo history is kept per source.

**Your work is saved automatically** in this browser (IndexedDB): images, crops, settings and saved layouts survive a reload. Undo history does not. **Reset workspace** deletes the saved images too; saved layouts are kept.

**Offline / install**: the production build registers a service worker, so after one visit the app loads with no network, and Chrome or Edge offer to install it as an app. The service worker only runs in production builds (`npm run build && npm run preview`), not in `npm run dev`.

| Shortcut | Action |
| --- | --- |
| Alt/Option+drag | Draw a new crop on top of existing crops |
| Arrows / Shift+Arrows | Nudge selected crop 1px / 10px |
| Delete / Backspace | Remove selected crop |
| Ctrl/Cmd+D | Duplicate selected crop |
| Esc | Deselect |
| 0, +, - | Fit, zoom in, zoom out |
| Scroll, Space+drag, middle-drag | Pan |
| Ctrl/Cmd+scroll, trackpad pinch | Zoom at cursor |

## How detection works

`src/detect/detect.ts` is a recursive XY-cut. It runs in a Web Worker on a copy of the image scaled down to at most 1600px on its longest side.

1. **Blank lines.** A row or column is "blank" when almost all of its pixels match its median color. Runs of blank lines of the same color form *bands*.
2. **Background palette.** The colors of the outer margins define the background. If there are no margins (e.g. thin divider lines), every full-width or full-height band counts. Below the top level, only bands in a background color count as gutters. This keeps a solid stripe inside a photo from being cut.
3. **Cut and recurse.** Margins are trimmed. The rect is cut at its gutters, rows before columns so panels come out in reading order, and each piece is processed the same way.
4. **Seams fallback.** If there are no gutters at all, panels are split where the average color jumps consistently along a whole line (photos placed edge to edge). Confidence is lower in this case.

The sensitivity slider adjusts the color tolerance, the fraction of off-color pixels a blank line may have, and the seam threshold.

## Project layout

```
src/
  detect/detect.ts    panel detection (pure)
  detect/worker.ts    worker entry; client.ts is the promise-based caller
  geometry.ts         crop move/resize/hit-testing (0..1 coordinates)
  view.ts             zoom/pan math
  history.ts          undo/redo stack
  crops.ts            crop list operations
  state.ts            app state transitions
  naming.ts, plan.ts  export file and folder naming
  export.ts           rendering crops and building the ZIP (fflate)
  frame.ts            output-size math for export presets
  trim.ts             content bounds for Trim to content (trimCrop.ts reads pixels)
  snapshot.ts         saved workspace/layout format and strict parsers
  storage.ts          IndexedDB access; autosave.ts debounces saves
  pwa/sw.js           service worker template (vite.config.ts fills in the file list)
  load.ts, sample.ts  image decoding, built-in sample
  ui/                 DOM: editor canvas, lists, export dialog
  main.ts             wiring
tests/                Vitest suites for all pure modules
```

## Known limitations

- **Gutters that match the panel background are ambiguous.** For example, a product on white with white gutters can look like one blank area. Detection may then cut inside the white background. Adjust the crop by hand.
- **Edges may be off by 1-2px on large images**, because detection runs on the scaled-down copy. Use arrow-key nudging if it matters.
- **WEBP export depends on the browser.** Safari cannot encode WEBP; the app reports this instead of silently writing PNG.
- **Saved work lives in one browser profile.** Clearing site data or using a private window loses it. If saving fails, the top bar shows "Not saved" and the page warns before you leave.
- **No pinch zoom on touch screens.** Use the zoom buttons there.
