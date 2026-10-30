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

1. **Add images**: drop files anywhere on the page, paste an image (Ctrl/Cmd+V), or browse. Or load the built-in sample.
2. **Check the crops**: each image gets a confidence label (High confidence, Check edges, Needs review). Areas outside every crop are dimmed.
3. **Adjust precisely**:
   - **Select tool (V)**: click a crop to select it, drag to move, drag the 8 handles to resize. **Draw tool (R)**: drag anywhere to add a crop, even on top of others. **N** adds a crop in the centre.
   - While dragging, a **magnifier** shows the edge at pixel level, and edges **snap** to the image border and to other crops (toggle with the magnet button; hold Ctrl/Cmd to bypass once).
   - The **Selection** panel has exact **X / Y / W / H** fields in source pixels, an **aspect lock** (1:1, 4:5, 3:4, 2:3, 4:3, 3:2, 16:9) that applies to handles, fields and new crops, plus **Duplicate**, **Trim** and **Delete**, and **Split into rows × columns**.
   - **Trim** shrinks a crop to the product inside it (plus the margin set under the crop list). It works best on plain backgrounds; on gradients it may cut unevenly.
   - **Detect** tab: change sensitivity or margin trimming and re-detect, or copy the current layout to every other image.
   - **Layouts** tab: save the current crop layout by name and apply it to any image later (it scales to the image size).
4. **Export**:
   - **File names keep the upload's name**: `Summer Sale.JPG` exports as `Summer Sale-1.JPG`, `Summer Sale-2.JPG`… The template is editable (`{name}`, `{n}`, `{label}`).
   - **Format**: *Original* keeps each upload's format (PNG, JPEG or WEBP; others become PNG), or convert all to PNG, JPEG or WEBP.
   - **Size** presets frame each crop for marketplaces: square 1:1, portrait 4:5, 2000×2000 (Amazon, Shopify), 1080×1080 and 1080×1350 (Instagram), or a custom size, with padding and a background color.
   - **Destination**: *Save to a folder* lets you pick any folder and writes the files there directly (one subfolder per image when exporting several; existing files are never overwritten, a numbered copy is saved instead). This needs Chrome, Edge or another Chromium browser. *Download* works everywhere: one file as is, several as a ZIP.

Every edit can be undone (Ctrl/Cmd+Z, Shift to redo). Undo history is kept per image. The interface follows your system's light or dark theme; the moon/sun button switches it.

**Your work is saved automatically** on this device (IndexedDB): images, crops, settings and saved layouts survive a reload. Undo history does not. **Clear all** deletes the saved images too; saved layouts are kept.

**Offline / install**: the production build registers a service worker, so after one visit the app loads with no network, and Chrome or Edge offer to install it as an app. The service worker only runs in production builds (`npm run build && npm run preview`), not in `npm run dev`.

| Shortcut | Action |
| --- | --- |
| V / R | Select tool / draw tool |
| N | Add a crop in the centre |
| Arrows (Shift: ×10) | Move selected crop by 1px |
| Alt+Arrows (Shift: ×10) | Resize selected crop by 1px |
| Tab / Shift+Tab | Next / previous crop |
| Delete / Backspace | Remove selected crop |
| Ctrl/Cmd+D | Duplicate selected crop |
| Alt+drag | Draw a crop on top of existing crops (select tool) |
| Ctrl/Cmd while dragging | Don't snap |
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
  precision.ts        aspect-locked resize, snapping, split, X/Y/W/H edits
  view.ts             zoom/pan math
  history.ts          undo/redo stack
  crops.ts            crop list operations
  state.ts            app state transitions
  naming.ts, plan.ts  export file and folder naming
  export.ts           rendering crops and building the ZIP (fflate)
  saveFolder.ts       writing into a user-picked folder (File System Access API)
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
- **Saving to a folder is Chromium-only.** Firefox and Safari don't offer the folder picker; use Download there.
- **No pinch zoom on touch screens.** Use the zoom buttons there.
