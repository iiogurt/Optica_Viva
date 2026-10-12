# Optica Viva: project guide

## Purpose
A visually stunning, PhD-level educational web app about optical phenomena and real-world optical challenges in **photography, videography/cinema and space telescopes**. Every phenomenon gets three layers:
1. an **interactive simulation**,
2. a **live calculation** (the equations with the current values substituted), and
3. **theory**: derivation, assumptions, limits of validity, primary references.

Use the most precise model that runs interactively, and state every approximation on its page. Nothing is a canned animation.

## Tech
- Static HTML/CSS + vanilla ES modules. **No build step, no runtime dependencies** except vendored KaTeX (`vendor/katex/`). Must work offline.
- Run: `npm start` (= `python3 -m http.server 8000`). Hash router: `#/<lab-id>`. Live site: https://iiogurt.github.io/Optica_Viva/ (deployed from `main` by `.github/workflows/pages.yml`; keep all paths relative).
- `js/app.js`: lab registry (`MODULES`) and `READY` set. `js/lib/`: numerical core (fft, color, glass, raytrace, pupil, thinfilm, sensors, phenomena, plot, ui, page). `js/modules/<id>.js`: one page each, exporting `mount(root, meta)` that returns a cleanup function.
- New lab: create the module, register it in `MODULES` and `READY`, link it from `js/lib/phenomena.js`, add a screenshot entry in `scripts/screenshots.py`.
- Style: match the surrounding code; dark design system in `css/style.css`. Theory text goes in `String.raw` templates with `\( \)` / `\[ \]` math (never `$`). Never put a `//` comment inside a one-line `{ … }` block.
- The owner's machine is a Raspberry Pi 4, so keep heavy work debounced. Performance targets are in `ROADMAP.md`.

## Verify before releasing
- `npm run ci` = `npm run check` (syntax + Markdown links/anchors) + `npm test` (physics suite in `test/`) + `npm run smoke` (every page in headless Chrome). New physics needs a test.
- Load the changed pages in headless Chromium: no console errors, and look at the visuals (`python3 scripts/screenshots.py <page>`, then view the image).
- Check physics against known values: add each to the README validation table and as an assertion in `test/physics.test.mjs`.

## Git & release workflow (mandatory for every change)
- Remote: https://github.com/iiogurt/Optica_Viva. **Never commit to `main` directly.** Work on a branch (`feat/…`, `fix/…`, `docs/…`, `ci/…`, `chore/…`), push it, open a PR with `gh pr create`, wait for GitHub Actions CI (syntax & links, physics tests, browser smoke) to pass, then squash-merge. Only release commits made by `scripts/release.sh` land directly on `main`. Repo-local identity: `iiogurt <188860570+iiogurt@users.noreply.github.com>` (never a personal email; the repo is public).
- **Conventional Commits** (`feat(scope):`, `fix:`, `docs:`, `chore:` …). End commit messages with the `Co-Authored-By` trailer for the model in use.
- **Semantic Versioning**: new lab or feature → minor; fixes and docs → patch.
- Every change updates:
  - **CHANGELOG.md** in Keep a Changelog format: PRs add their entries under `## [Unreleased]`; a release renames it to `## [X.Y.Z] - YYYY-MM-DD` and adds the compare link;
  - **README.md** wherever it is affected (lab gallery, models, validation, structure);
  - **ROADMAP.md**: move shipped items to *Completed*; put new ideas in a milestone or the *Backlog*.
- Release from `main` after merging, with `scripts/release.sh X.Y.Z "type(scope): message"`. It runs checks and tests, bumps `package.json` and the README version, commits, tags `vX.Y.Z`, pushes, and creates the GitHub release from the CHANGELOG section.
- Regenerate README screenshots (`docs/screenshots/*.webp`) when visuals change.

See also `CONTRIBUTING.md` (human-facing version of these rules) and the PR template checklist.

## Next work
Pick from `ROADMAP.md`. v1.1 has shipped; next is v1.2 (performance: Web Workers, cached pupil rasters, progressive rendering, WebGPU). The licence is still undecided and is the owner's call.
