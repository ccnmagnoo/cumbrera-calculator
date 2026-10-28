# AGENTS.md

Cumbrera is a dependency-free static web app: no framework, bundler, build, lint, or typecheck. Keep it that way unless the task explicitly requires tooling.

## Commands

- `npm test` or `node --test` — run all tests with Node's built-in runner (~0.1 s).
- Single test: `node --test --test-name-pattern="tramos" tests/calc.test.js`.
- Run the app by opening `index.html`; use `python -m http.server 8080` if `localStorage` is blocked on `file://`.

## Architecture

- Scripts are classic IIFEs loaded in order in `index.html`: `geometry.js` → `templates.js` → `calc.js` → `app.js`. Each attaches to `globalThis.Cumbrera`; order matters, and `app.js` silently no-ops if a dependency is missing.
- `js/geometry.js` polygon/plane math, `js/templates.js` the seven built-in roofs, `js/calc.js` strip layout and union detection, `js/app.js` DOM, state, plan editor, 3D, persistence, CSV. Tests load only the first three.
- There are no ES modules or exports. To add a JS file, add its `<script>` before `app.js` and a side-effect `require()` in the tests.
- Keep `package.json` CommonJS (no `"type": "module"`); tests use `require()`.
- The 3D view is a hand-written canvas 2D projection in `draw3D()`, not WebGL.

## Domain conventions

- All measurements are meters. Plan coordinates have the origin top-left with +y downward. Directions are compass degrees (0=N, 90=E) mapped as `{x: sin, y: -cos}`.
- Each pano has its own optional `pitch` (1–120%); `roof.eaveHeight` remains global. `roof.pitch` is the default/last principal pitch, used for new panos and templates; `roof.principalId` marks the reference water. The principal is inferred as the largest pano when absent. Editing "pendiente principal" or "cumbrera principal" changes only the principal and updates `roof.pitch`; new panos use that base.
- `calc.autoAlignPitches()` is pure (does not mutate): it propagates from the principal through valid shared unions and solves each secondary pitch by least squares against the union endpoint heights. Disconnected panos and unions that cannot be equaled with one constant pitch are reported, not silently changed.
- Per-pano `pitch`, `roof.principalId`, and the principal pitch are additive v1 state fields. `sanitizeRoof`/`sanitizePano` fill missing pitches from `roof.pitch` and infer the principal, so older saved designs still load.
- Sheet config keys are `width`, `lateralOverlap`, `maxLength`, `lengthStep`, `longitudinalOverlap`, `endAllowance`. Useful width = `width - lateralOverlap`.
- The calculation is deliberately conservative: one piece per strip (split when over max length), no offcut reuse. Do not "optimize" it; reported waste and the tests depend on this.
- Template geometry is asserted exactly in `tests/calc.test.js` (areas and ridge/hip/valley lengths). Changing a template requires updating those expectations and the README.

## UI and state gotchas

- Every interactive control needs an id in `index.html`, an entry in `cacheDom()`, and binding in `bindInputs()`/`bindToolbar()`. Inputs also need syncing from state in `syncInputs()`. Missing a step makes the control silently inert.
- Mutate roof/sheet state, record undo via `pushHistory()`/`commitBefore()`, then call `render()`. `render()` re-sanitizes the sheet, reruns `CALC.analyze`, redraws plan and 3D, and schedules a save.
- `render()` clamps sheet values via `sanitizeSheet()`, so out-of-range values will not persist.
- Persistence uses `localStorage['cumbrera.v1']` with a 280 ms debounce. Any schema change requires updating the `version` check in `loadState()` and the `sanitizeRoof`/`sanitizeSheet` guards; otherwise saved designs are discarded.
- `app.js` has no automated tests (needs a DOM); verify UI/plan/3D changes manually in a browser. `npm test` covers geometry, templates, and calc only.
- User-facing copy, `Intl` number formatting (es-CL, comma decimals), comments, and test names are Spanish. Keep new strings in Spanish.
- `README.md` documents behavior, calculation semantics, and limits; update it when those change.
