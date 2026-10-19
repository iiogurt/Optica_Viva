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
- New lab: create the module, register it in `MODULES` and `READY`, link it from `js/lib/phenomena.js`, add a screenshot entry in `scripts/screenshots.mjs`. Whenever files are added to or removed from `css/`, `js/`, `img/`, `icons/` or the vendored KaTeX, run `node scripts/precache.mjs --write` (the service worker's offline list; `npm run check` fails otherwise).
- Explanation ladder (simple → exact, all visible, no level switch): after `header()`, `idea(html, tries)` gives the phenomenon in plain words (no math, ≤ 120 words, aimed at ~9 years of schooling, every term explained, at most one analogy that says where it breaks) and 1–3 "try it" prompts (predict, then check). The live calculation calls `calc.say(html)` with the result in a sentence before the equations. Before `theory()`, `rule(html, limits)` gives one formula, a worked number and where it stops working. New technical terms used in page text get a one-sentence definition in `js/lib/glossary.js` (marked automatically on first use); a known misconception can get a predict-then-reveal question in `js/lib/misconceptions.js`. `test/ladder.test.mjs` enforces the ladder on every lab in `READY` (pages without a live calculation, like `foundations`, skip `say`).
- Interface strings: wrap them in `t('English text')` (or mark with `N_()` and translate with `t(variable)`) from `js/lib/i18n.js` and add the translation to every `js/locales/*.js`; `test/i18n.test.mjs` fails otherwise. New laboratory titles and blurbs in `MODULES`, control labels, options and hints, readout names, figure captions and `liveCalc()` titles count as interface strings (the toolkit translates them; write them as complete literals). Laboratory explanations stay English for now.
- Style: match the surrounding code; dark design system in `css/style.css`. Theory text goes in `String.raw` templates with `\( \)` / `\[ \]` math (never `$`). Never put a `//` comment inside a one-line `{ … }` block.
- Randomness: use the seeded generators in `js/lib/random.js` (`uniform`, `makeRng`); never write a local LCG (consecutive LCG outputs fed to Box–Muller are correlated).
- The owner's machine is a Raspberry Pi 4. Put heavy pure computations in `js/lib/tasks.js` and call them via `latest(channel)` from `js/lib/compute.js` (module worker, main-thread fallback). Performance targets are in `ROADMAP.md`; `npm run bench` measures the kernels.
- Node 24 (CI and the owner's machine; Node ≥ 22 required). Run tests with `npm test` (= `node --test test/*.test.mjs`); a bare directory argument fails on Node ≥ 22.
- Browser automation must use real time (`scripts/lib/browser.mjs`, CDP). Chromium's `--virtual-time-budget` never advances Web Workers.

## Verify before releasing
- `npm run ci` = `npm run check` (syntax + Markdown links/anchors) + `npm test` (physics suite in `test/`) + `npm run smoke` (every page in headless Chrome). New physics needs a test.
- Load the changed pages in headless Chromium: no console errors, and look at the visuals (`npm run screenshots -- <page>`, then view the image).
- Check physics against known values: add each to the README validation table and as an assertion in `test/physics.test.mjs`.

## Git & release workflow (mandatory for every change)
- Remote: https://github.com/iiogurt/Optica_Viva. **Never commit to `main` directly.** Each change gets its own branch (`feat/…`, `fix/…`, `docs/…`, `ci/…`, `chore/…`, `refactor/…`, `test/…`, `perf/…`) in its **own git worktree**: `scripts/worktree.sh new feat/<topic>` creates it from a freshly fetched `origin/main` in `../Optica-Viva.worktrees/feat-<topic>` with no upstream until pushed; work, test and commit there; `git push -u origin <branch>`, open a PR with `gh pr create`, wait for GitHub Actions CI (syntax & links, physics tests, browser smoke) to pass, then squash-merge with `gh pr merge --squash --delete-branch` and run `scripts/worktree.sh finish <branch>` (removes the worktree and local branch, prunes, fast-forwards `main`). The main checkout stays on a clean `main` and is used only for releases. One topic per branch and PR; rebase on `origin/main` if it moved. **Nothing is pushed to `main` directly, not even release commits.** Branch protection requires a PR and green checks, including for admins. Repo-local identity: `iiogurt <188860570+iiogurt@users.noreply.github.com>` (never a personal email; the repo is public). Merges happen on GitHub, so the merge commit's author and committer come from the GitHub account; its *Keep my email addresses private* setting must stay on, and `worktree.sh finish` warns if the merge commit records anything but a noreply address. Commits before PR #62 keep the old address by the owner's decision; do not rewrite history.
- **Conventional Commits** (`feat(scope):`, `fix:`, `docs:`, `chore:` …). End commit messages with the `Co-Authored-By` trailer for the model in use.
- **Semantic Versioning**: new lab or feature → minor; fixes and docs → patch.
- Every change updates:
  - **CHANGELOG.md** in Keep a Changelog format: PRs add their entries under `## [Unreleased]` (the release script dates them);
  - **README.md** wherever it is affected (lab gallery, models, validation, structure);
  - **ROADMAP.md**: move shipped items to *Completed*; put new ideas in a milestone or the *Backlog*.
- Releases are two-phase. (1) `scripts/release.sh prepare X.Y.Z "type(scope): summary"` on an up-to-date `main`: runs checks and tests, creates `release/vX.Y.Z`, turns `[Unreleased]` into `[X.Y.Z] - date` (with compare links), bumps the versions, and opens a release PR. (2) After that PR merges with green CI: `scripts/release.sh publish X.Y.Z` tags the merge commit, pushes **only the tag**, and creates the GitHub release.
- Regenerate README screenshots (`docs/screenshots/*.webp`) when visuals change.

See also `CONTRIBUTING.md` (human-facing version of these rules) and the PR template checklist.

## Next work
Pick from `ROADMAP.md`. v1.1–v1.20 have shipped (v1.11: the simple-to-exact ladder, glossary and Start-here path; v1.12–v1.14: missions and seven new laboratories; v1.15: your own gear and real images; v1.16: tours, exercises, export, embed, offline app; v1.17: classic lenses, mirrors, Hubble, a three-mirror anastigmat, the Biogon; v1.18: glass catalogue, decenter/tilt tolerancing, interface in German, French and Spanish; v1.19: translated controls, parallel ray casters and the seeing animation in workers; v1.20: 3-D views). Open next, in order: the remaining 3-D views (ROADMAP v1.20; engine `js/lib/gl3d.js`, geometry `js/lib/mesh3d.js`, one pure scene builder per laboratory with a test), the rest of v2.0 (translating the explanations, which needs the owner's go-ahead because every later text change then needs three translations; plugin API) and validation against manufacturer MTF curves (needs a data source). Heavy per-pixel renders go through the worker pool (`parallel`, `rowBands`, `runOn` in `js/lib/compute.js`). Releases with new features are minor versions; ROADMAP milestone numbers follow the release numbers. Licence: MIT (`LICENSE`); third-party material is listed in `THIRD_PARTY_NOTICES.md` (keep it current when adding data or vendored code).
