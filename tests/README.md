# Tests

```sh
npm install                      # once
npx playwright install chromium  # once - downloads the test browser
npm test                         # everything (~30s)
```

| Command | What it runs |
| --- | --- |
| `npm run test:unit` | Node's built-in test runner over `tests/unit/` - no browser |
| `npm run test:e2e` | Playwright over `tests/e2e/` in headless Chromium |
| `npm run test:e2e:headed` | Same, with a visible browser window |
| `npm run test:e2e:ui` | Playwright's interactive UI (pick/re-run/time-travel tests) |
| `npm run serve` | Just the static server, at http://localhost:4173 |

A failed e2e run leaves a screenshot and trace per failure under
`test-results/` (gitignored); open a trace with
`npx playwright show-trace <path>/trace.zip`, or the HTML report at
`test-results/html/index.html`.

## Layout

- `unit/nbt.test.js` - the NBT reader: every tag type, malformed/truncated/hostile input, gzip.
- `unit/world-terrain.test.js` - region file parsing, biome colors/names, file filtering, the map computed off the main thread.
- `unit/dom.test.js` - HTML escaping and the text-field check shortcuts use.
- `unit/cell-geometry.test.js` - brush footprints, lines, cell keys and legacy road migration behind painted paths.
- `unit/plan-format.test.js` - validating plan files (imports, autosaves) before they touch the board.
- `unit/planner-rules.test.js` - the Plan Check rules, material names, and event batching.
- `unit/data-integrity.test.js` - the style JSONs, rooftop renders + manifest, material icons, every asset the HTML/CSS reference, and every page's module imports.
- `e2e/site.spec.js` - every page boots with no errors; nav, theme toggle, shortcuts modal.
- `e2e/planner-buildings.spec.js` - tray, placing, selecting, moving, rotating, copy/paste, undo/redo, zoom/pan.
- `e2e/planner-roads.spec.js` - road/river paint brush, eraser, walls tool.
- `e2e/planner-persistence.spec.js` - autosave, JSON import/export, PNG export, My Plans, saved preferences.
- `e2e/planner-display.spec.js` - preview pane, top-down renders, world background upload.
- `e2e/tools.spec.js` - Colony Inspector, World Viewer, Debug page.
- `helpers/` - an NBT encoder and a region-file builder so tests can craft exact (including hostile) save files.

## Conventions

- Every e2e test fails automatically if the page throws, logs a `console.error`, or gets a 404 (see `e2e/fixtures.js`). The one exception is the `images/<style>/*_front.jpg` misses the preview-photo fallback chain expects. A test that triggers an error on purpose calls `pageErrors.allow(/.../)`.
- The site is ES modules. Unit tests `require()` the pure modules (`lib/`, and the planner modules that don't touch the DOM) directly - Node 22.12+ can require ES modules. E2e tests read planner state through `window.__planner`, which `planner/main.js` builds from every module's exports (`__planner.placedSquares`, `__planner.gridZoom`, ...) as read-only live getters; World Viewer exposes `window.__worldViewer` the same way. Tests change state with the real mouse and keyboard.
- If you find a bug you can't fix right away, pin it rather than deleting the test: mark it `test.fail()` with a `KNOWN BUG` comment, or add it to one of the `KNOWN_*` allow-lists (each has a companion check that the entry is still real). Once it's fixed, the suite tells you to remove the marker. All of these are currently empty.
- Building footprints (`w`/`h` in `styles/*.json`) must match the real blueprint size, with `w` = the blueprint's `size_x`; `data-integrity.test.js` enforces this against the rooftop renders. `scripts/generate_rooftop_renders.js` regenerates renders from a local MineColonies source checkout.
