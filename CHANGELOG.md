# Changelog

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Exact disk (pillbox) blur** in `js/lib/blur.js`: per-row prefix sums with anti-aliased span ends, normalised by the discrete kernel weight, premultiplied alpha, and a downsampled path above r = 8 px that keeps the cost near r ≈ 4. Tilt-shift now blends a stack of disk-blurred images instead of Gaussians (similar speed), and depth of field uses the exact disk for every image up to 1.2 Mpx. Tests: unit sum, plateau 1/(πr²), RMS radius r/√2 within 2.5 % on both paths; a uniform image is unchanged.
- **Bokeh from the traced lens** (`js/lib/bokeh.js`), now the default model of the bokeh lab. Defocused point images are traced through any library prescription at 8 wavelengths: background lights at infinity, foreground lights at half the focus distance, and the sensor at the real-ray image of the focus distance. They use the flux-conserving triangle rasteriser, generalised to the direct path, point sources, fitted windows and rounded blades. The lens's own spherical aberration, secondary-spectrum fringes (magenta foreground, green background), cat's eyes from the clear apertures (new barrel slider) and coma emerge without parameters. Disks are drawn at physical size on a 36 mm sensor. The 18 kernels are computed in the worker. The phenomenological model remains as a second mode.
- Tests (`test/bokeh.test.mjs`): a stopped-down disk matches the paraxial diameter within 1 % and conserves the pupil flux within 0.5 %; under-correction gives a soft background and a bright-rimmed foreground; the colour order of the rims matches longitudinal colour (singlet) and the secondary spectrum (achromat).
- `controls()` options accept `when(state)` to show a control only for some settings.

### Fixed
- Ghost and bokeh rasteriser: pixel centres on a shared triangle edge were counted twice, which drew a faint line along the cell diagonals. Sub-pixel triangles were also under-weighted at aperture edges, losing up to 5 % of the flux on dense grids.

### Added
- **Real-ray lens-flare ghosts** (`js/lib/ghosts.js`), following the full method of Hullin et al. (2011). Exact rays are traced through every two-reflection path at 8 wavelengths, and the ray grid is rasterised as flux-conserving triangles. The iris polygon and every clear aperture are tested per pixel through an interpolated aperture gauge, so edges stay sharp. Reflectances use each ray's actual angle of incidence on the thin-film coating, and total internal reflection is included. The result shows aberrated, vignetted and cat's-eye ghosts with caustics. Ghost paths that would stay invisible are culled. It runs in the worker: a draft while the sun moves, then a refined image. The paraxial model is still available as an instant mode and serves as the preview while tracing.
- Tests (`test/ghosts.test.mjs`): in the paraxial limit, traced ghosts match the y–nu ghost matrices in position (3 %), size (2 %) and flux (3 %); the ghost-path count is k(k−1)/2; coatings rank uncoated > MgF₂ > QHQ.
- `npm run bench` times the ghost renderer: on a Raspberry Pi 4, about 0.7 s for a draft and 1.7 s for a refined Double-Gauss image.

### Changed
- Flare: in the real-ray model the veiling glare holds only the scatter term, because the traced image already contains the faint ghosts. Paraxial ghost matrices moved from the flare page to `js/lib/ghosts.js`.

## [1.4.0] - 2026-10-12

Lens design II (PRs [#15](https://github.com/iiogurt/Optica_Viva/pull/15) follow-ups, [#18](https://github.com/iiogurt/Optica_Viva/pull/18)–[#20](https://github.com/iiogurt/Optica_Viva/pull/20)): MTF across the field, a damped-least-squares optimiser that rediscovers Coddington's best-form singlet, and Monte-Carlo tolerancing. The ray tracer now covers the core lens-design loop: analyse, optimise, tolerance.

### Added
- **Monte-Carlo tolerancing** (`js/lib/tolerance.js`) in the ray tracer: Gaussian errors in radii (%), thicknesses (µm) and refractive indices; every trial is refocused (image distance as compensator) and scored by the RMS ray error over fields and F, d, C. It runs in the worker and shows a histogram with the nominal and 90th-percentile results. Perturbed glasses use `{ base, dn }` in `index()`.
- Test: zero errors reproduce nominal; under identical tolerances the f/3 Double-Gauss is more sensitive than the f/5 Cooke triplet.

### Added
- **Lens optimiser** (`js/lib/optimise.js`): damped least squares (Levenberg–Marquardt) on surface curvatures and the image distance, with a merit of real-ray transverse errors over fields 0, 0.7, 1 and the F, d, C wavelengths, plus a focal-length target. An **Optimise** button in the prescription editor runs it in the worker.
- Test: starting from an equiconvex singlet, the optimiser rediscovers Coddington's best-form bending (q = 0.727 against the third-order 0.740) at exactly f = 100 mm; it also never worsens the Cooke triplet.

### Added
- **MTF across the field** in the ray tracer: sagittal and tangential MTF at 10 and 30 lp/mm vs image height (the curves lens makers publish), from the OTF of the traced, vignetted pupil at 7 field positions, computed in the worker. Diffraction-limit references are drawn.
- Test: a near-perfect f/20 aspheric lens reproduces the analytic diffraction MTF within 1.5 %; S = T on axis; off-axis astigmatism splits them.

### Changed
- `lensPSF` and the new `lensMTF` share one traced-pupil builder (`lensPupil`) in `js/lib/tasks.js`.

## [1.3.0] - 2026-10-12

Lens-design milestone (PRs [#12](https://github.com/iiogurt/Optica_Viva/pull/12)–[#16](https://github.com/iiogurt/Optica_Viva/pull/16)): aspheric surfaces, a prescription editor with Zemax import and shareable designs, per-surface Seidel sums, through-field analysis and vignetted PSF pupils, each validated against exact ray tracing.

### Added
- **Vignetted pupils in the diffraction PSF:** the ray tracer's wavefront PSF traces every pupil sample through the clear apertures; blocked rays carry no light, with an anti-aliased pupil edge. The OPD panel reports the transmitted fraction, and the Strehl ratio is referenced to the same vignetted pupil.
- **Editable clear semi-diameters** (`Semi-Ø` in the prescription editor; blank = automatic). They are imported from Zemax `DIAM` and kept in JSON and shared links.
- Test: designed apertures pass the full field, tighter rims leave the axial beam alone and vignette the 14° Double-Gauss beam to 50–85 %.

### Fixed
- Smoke test flakiness: instead of a fixed 5 s wait, each laboratory is polled for results for up to 25 s, because worker-backed labs (MTF) could take longer on a cold CI runner. Browser start-up allows 40 s and retries once on a new port.

### Added
- **Through-field analysis** (`fieldCurves()`): exact tangential and sagittal (Coddington) foci from differential real rays, plus real-ray distortion, versus field angle. The ray tracer plots the field curves against the third-order Seidel prediction, alongside a distortion curve. A test confirms that exact foci match −(S_III+S_IV)/(2n′u′²) and −(3S_III+S_IV)/(2n′u′²) within 6 % at small field.

### Added
- **Seidel aberration sums** (`seidel()` in `js/lib/raytrace.js`, Welford formulation): per-surface S_I–S_V and chromatic C_I, C_II from paraxial marginal and chief rays, including the conic/asphere surface term. The ray tracer shows them as per-surface wavefront coefficients (waves at 588 nm) with totals.
- Tests: Seidel spherical aberration agrees with exact ray tracing within 2 % at small apertures (plano-convex in both orientations, Cooke triplet), S_IV/H² equals the Petzval sum, the bending ratio is ≈ 4, the hyperbolic singlet's S_I vanishes, and C_I predicts the F–C focus shift within 1 %.

### Added
- **Prescription editor** in the ray tracer: an editable surface table (radius, thickness, glass, conic, a₄, a₆, stop, add and remove), entrance pupil and field, live validation, and traced results on every change. A custom design travels in the page link (`rx=…`, a compact URL-safe encoding), so it can be shared.
- **Import/export** (`js/lib/lensio.js`): Zemax `.zmx` subset (sequential STANDARD and EVENASPH; CURV, DISZ, GLAS, CONI, PARM, DIAM, STOP, ENPD, YFLN; UTF-16 files decoded) and Optica Viva JSON. Unknown glasses become **model glasses** from their n_d and V_d (two-term Cauchy that reproduces both).
- Tests: Zemax fixtures reproduce the Cooke triplet EFL and the SA-free hyperbolic singlet; JSON and URL round trips for every built-in lens; model glasses keep n_d and V_d; validation; every glass used by a built-in lens is in the catalogue.

### Fixed
- The library's `achromat` prescription was an early, incorrect doublet (f ≈ 84 mm); the laboratory had been patching it at runtime. The designed N-BK7/F2 doublet (f = 100 mm) now lives in `js/lib/raytrace.js`, so tests, the worker and the editor see the same lens.

### Added
- **Aspheric surfaces** in the exact ray tracer: conic constant `k` plus even polynomial terms `a = [a₄, a₆, a₈, a₁₀]`. Rays are intersected by Newton iteration on z − sag(r) = 0, with the analytic sag slope for the surface normal; spheres keep their closed-form path.
- **Plano-aspheric singlet** prescription (N-BK7, hyperbolic surface k = −n²). It focuses a collimated beam with zero spherical aberration: worst zone error 0.0005 µm against 457 µm for the spherical singlet of the same power, leaving only chromatic defocus.
- Tests: the hyperbolic singlet is free of spherical aberration, the Newton path matches the closed-form sphere, and k = −1 gives an exact paraboloid.

## [1.2.0] - 2026-10-12

Performance milestone (PRs [#7](https://github.com/iiogurt/Optica_Viva/pull/7)–[#10](https://github.com/iiogurt/Optica_Viva/pull/10)): a faster FFT, cached rasters, a compute worker that keeps the UI responsive on a Raspberry Pi 4, real-time browser testing, and releases that go through pull requests.

### Changed
- **More work in the compute worker:** the Lyot coronagraph (12 FFTs per update), JWST segment phasing (including the raster and segment map that used to be built on the main thread at page load) and the ray tracer's diffraction PSF (41×41 aimed-ray OPD grid plus two FFTs) now run in the worker. Numbers are unchanged and pinned by new regression tests (coronagraph throughput 40.9 %, stacked-segment Strehl 0.217, Cooke 14° OPD P-V 3.30 λ).

### Added
- `scripts/bench.mjs` (`npm run bench`): kernel benchmarks as a Markdown table; a non-blocking CI job publishes them to the run summary.
### Removed
- `scripts/smoke.sh` and `scripts/screenshots.py` (replaced by the Node/CDP versions).

### Added
- Tests: the 2-D FFT is compared against a direct DFT, and the raster cache is covered.

- **Compute worker:** heavy FFT work for the PSF, Zernike and MTF laboratories runs in a module Web Worker (`js/workers/compute.js`, `js/lib/tasks.js`, `js/lib/compute.js`), with a main-thread fallback. Measured in Chromium on a Raspberry Pi 4 with a 5-wavelength defocused JWST PSF (512²): the longest main-thread freeze drops from about 1040 ms to 16 ms. Only the newest request per laboratory resolves, so dragging never queues stale work.
- **Progressive rendering** in the PSF lab: a 256² preview with the same field of view answers quickly, and the full 512² render follows once input settles.
- `scripts/lib/browser.mjs`: a dependency-free real-time Chrome DevTools Protocol driver.

### Changed
- **Smoke test and screenshots run in real time** (`scripts/smoke.mjs`, `scripts/screenshots.mjs` via CDP). Chromium's `--virtual-time-budget` does not advance Web Workers, so the old shell smoke test could not see worker results. The smoke test now also fails when a laboratory renders no results; this was verified by breaking a worker task. Screenshots no longer need Python or Pillow.
- **Faster 2-D FFT:** row transforms, a cache-blocked transpose, row transforms, transpose back. On a Raspberry Pi 4 a 512² FFT drops from 88 ms to 66 ms (≈ 1.4×), with bit-identical results.
- **Pupil rasters are cached** (LRU, 16 entries). Revisiting an aperture is instant; the JWST 512² raster costs 182 ms when cold.
- **Releases go through pull requests.** `scripts/release.sh` is now two-phase: `prepare` opens a `release/vX.Y.Z` PR that dates the changelog and bumps the versions; `publish` runs after the merge and pushes only the tag and the GitHub release. Nothing is pushed to `main` directly.
- Branch protection on `main` requires a pull request and applies to administrators too.

## [1.1.0] - 2026-10-12

Robustness milestone: automated physics tests, CI on every pull request, a public live site, Safari support, shareable links, a mobile controls sheet and an accessibility pass. Development now happens on branches merged through pull requests ([#1](https://github.com/iiogurt/Optica_Viva/pull/1)–[#6](https://github.com/iiogurt/Optica_Viva/pull/6)).

### Added
- Physics test suite (`test/physics.test.mjs`, `npm test`, Node's built-in runner, no dependencies): 14 tests covering every row of the README validation table plus FFT round-trip/Parseval, Zernike orthonormality, spectral white balance, paraxial convergence and the sign of spherical aberration.
- `scripts/check.mjs` (`npm run check`): syntax check of all modules and verification of every relative link, image and heading anchor in the Markdown files.
- `scripts/smoke.sh` (`npm run smoke`): loads every page in headless Chrome and fails on uncaught errors or modules that fail to load.
- GitHub Actions CI (`.github/workflows/ci.yml`): syntax and links, physics tests, and browser smoke test on every push and pull request.
- GitHub Pages deployment (`.github/workflows/pages.yml`): every push to `main` is checked, tested and published to <https://iiogurt.github.io/Optica_Viva/>.
- `main` is protected: pull requests must pass the three CI checks before merging.
- `js/lib/optics.js`: thin-lens depth of field, tilted-lens (Scheimpflug) imaging and ΛCDM distances, extracted from the laboratories so they can be tested.

- **Shareable links:** every control in every laboratory mirrors its non-default value into the URL (`#/psf?preset=jwst&band=nir`). Opening such a link restores the exact configuration. Each page header has a **Copy link** button.

- **Mobile controls sheet:** on screens ≤ 860 px each lab's controls card becomes a collapsible bottom sheet, shown while its lab is on screen, so sliders and results are visible together.
- **Accessibility:** canvases are labelled images (`role="img"`), result panels are labelled groups, there is a skip-to-content link, visible `:focus-visible` outlines, `aria-current` in the navigation and `aria-expanded` on the menu and sheet buttons. The draggable sun (flare) and source galaxy (lensing) respond to the arrow keys. `prefers-reduced-motion` stops the hero animation, starts the seeing simulation paused and shows a single wheel frame.

- `CONTRIBUTING.md` (workflow, adding a laboratory, style); issue templates for bugs, physics or accuracy errors and features; a pull-request checklist template.
- Error boundary: a laboratory that fails to load shows a pre-filled "Report this issue on GitHub" link with the page URL, browser and stack trace.

### Changed
- README contributing section now points to `CONTRIBUTING.md`.
- Small labels have higher contrast (`--fg-faint` 0.32 → 0.5 alpha).
- Range sliders carry an `aria-label`, and segmented buttons expose `aria-pressed`.
- `scripts/release.sh` now also runs the physics test suite before releasing.

### Fixed
- Preset-driven labs (PSF, Zernike, perspective) now take their initial preset from the restored state, so the first slider move after opening a link no longer re-applies the preset.
- **Safari:** depth-of-field, bokeh-softening and tilt-shift blurs no longer depend on `CanvasRenderingContext2D.filter`, which Safari ships disabled. The new `js/lib/blur.js` is an O(1)-per-pixel Gaussian (three box passes, premultiplied alpha), tested in `test/blur.test.mjs`. In the depth-of-field lab the source is blurred once instead of once per kernel tap, which is equivalent because blurring commutes with shifting and summing, and faster.
- cos⁴ falloff at the corner of a 28 mm full-frame lens (37.7°) is −1.35 EV, not −1.30 EV (README validation table and vignetting theory). Found by the new test suite.

## [1.0.3] - 2026-10-12

### Added
- `CLAUDE.md`: concise project guide (purpose, tech constraints, verification, git/SemVer/changelog/roadmap workflow) so new sessions continue consistently.

## [1.0.2] - 2026-10-12

### Added
- `ROADMAP.md`: completed milestones (v0.1–v1.0.x), an audit of v1.0.1 (Safari canvas-filter gap, main-thread performance measured on a Raspberry Pi 4, mobile control placement, accessibility, missing tests/CI/deployment/licence), and planned milestones v1.1–v2.0 with priorities, effort estimates, 19 proposed laboratories and cited research notes.

### Changed
- README: roadmap section and links. Corrected the browser-support note: Safari ships canvas `filter` disabled in all current versions, not only older ones.

### Removed
- Accidentally committed `scripts/__pycache__/`; Python bytecode is now ignored.

## [1.0.1] - 2026-10-12

### Added
- `docs/screenshots/`: WebP screenshots of every laboratory and reference page.
- `scripts/screenshots.py`: reproducible screenshot generator (local server + headless Chromium + Pillow crop).

### Changed
- README rewritten in GitHub style: banner, badges, table of contents, illustrated gallery of all 20 laboratories, Mermaid diagrams (page layers, model hierarchy, PSF pipeline, architecture, release flow), physical-model table, validation table, approximations, browser support, contributing guide and references.

## [1.0.0] - 2026-10-09

All planned laboratories are complete; this release marks the first stable version.

### Added
- **Catalogue of phenomena**: 148 optical phenomena and imaging challenges in 13 groups (geometrical image formation, monochromatic and chromatic aberrations, diffraction, radiometry, stray light, polarisation, sensors and noise, time and motion, atmosphere, space telescopes, lens design, rendering). Each has a description, governing equation, domain tags and a link to its laboratory, plus live search, domain filters and an "only simulated" filter.
- `js/lib/phenomena.js` catalogue data module.

### Changed
- The Introduction page now shows the catalogue size, and the laboratory counter recognises completion.

## [0.19.0] - 2026-10-09

### Added
- **Tilt–shift & Scheimpflug** laboratory:
  - Exact tilted-thin-lens imaging (refocused so the sensor centre stays conjugate to the chosen distance). The traced plane of focus reproduces the hinge rule J = f/sin α numerically.
  - Ray-cast toy town (2-D DDA over a 12 m cell grid) with per-pixel defocus through the tilted lens and a blur-stack composite: the reverse-tilt miniature effect.
  - Side view at true image-space scale, showing the plane of focus, the DoF wedge (conjugates of the sensor ± Nc) and the ground.
  - Shift mode: level camera with sensor rise vs pitched camera (keystoning) on a façade, with the required image circle.

## [0.18.0] - 2026-10-09

### Added
- **Perspective & distortion** laboratory:
  - Ray-cast portrait scene (head with nose, eyes and ears; shoulders; pillars at 4–16 m; back wall) with a dolly-zoom mode that holds the face size constant, plus a top-view diagram of camera, field of view and scene.
  - Readouts of nose-vs-ear magnification and background scale, showing that perspective depends only on distance.
  - Brown–Conrady distortion (k₁–k₃, p₁, p₂) with barrel, pincushion and moustache presets: distorted-grid render, radial distortion curve and SMIA TV distortion.

## [0.17.0] - 2026-10-09

### Added
- **Vignetting & relative illumination** laboratory:
  - Natural falloff cosⁿθ with adjustable exponent (pupil-aberration effects).
  - Mechanical vignetting from the exact three-circle overlap of the entrance pupil with the projected front and rear rims, with pupil cross-sections at five field heights.
  - Pixel vignetting from the chief-ray angle (exit-pupil distance) against microlens acceptance.
  - Flat-field render with gradient-normalised ⅓-EV contours, component falloff curves in EV, and a live relative-illumination calculation.

## [0.16.0] - 2026-10-09

### Added
- **Rolling shutter & time** laboratory:
  - Propeller rendered with per-row capture times and 10-sample exposure integration, rolling vs global shutter.
  - Live wheel playback at the chosen frame rate and shutter angle with motion-blur integration; wagon-wheel aliasing chart of apparent vs true speed.
  - Flicker banding from 100/120 Hz mains and 400 Hz PWM LEDs, integrated per row over the exposure window, with a row-brightness profile.

## [0.15.0] - 2026-10-09

### Added
- **Noise & exposure** laboratory:
  - Photon-transfer model from scene EV (meter constant K = 12.5) through the camera equation to photoelectrons per pixel.
  - Poisson shot noise, two-stage read noise (pre- and post-amplifier, giving ISO invariance), dark current, PRNU, full-well and ISO-dependent clipping, and 14-bit quantisation.
  - 100 % crop of a ½-stop step wedge and gradient, optionally brightened to the metered level.
  - Photon-transfer curve with shot, read and PRNU limits; dynamic range vs ISO for five formats; SNR, exposure offset and DR readouts.

## [0.14.0] - 2026-10-09

### Added
- **Aliasing, moiré & Bayer** laboratory:
  - Four achromatic test scenes (zone plate, woven fabric, tilted stripes, distant bricks) with adjustable detail.
  - Sensor model integrating over the pixel aperture (fill factor) of a four-spot OLPF-blurred scene.
  - RGGB mosaicking with bilinear or Malvar–He–Cutler gradient-corrected demosaicing; measured false-colour (chroma) error.
  - 1-D spectral-folding chart with the pixel × OLPF pre-filter MTF and the luma and R/B Nyquist limits.

## [0.13.0] - 2026-10-09

### Added
- **Gravitational lensing** laboratory:
  - Inverse ray-shooting through point-mass, SIS and SIE (Kormann et al. 1994) lenses with external shear; a procedural spiral source that can be dragged; optional de Vaucouleurs lens-galaxy light.
  - Critical curves by marching squares on det A, with the caustics mapped into the source plane.
  - Flat ΛCDM angular-diameter distances, physical Einstein radius, enclosed mass, SIS velocity dispersion, and total magnification from the area ratio.

### Changed
- `scripts/release.sh` now refuses to release if any JavaScript file fails `node --check`.

## [0.12.0] - 2026-10-09

### Added
- **Space telescopes** laboratory:
  - Diffraction limit vs wavelength for Hubble, JWST, Roman, Euclid, Spitzer, Keck+AO and ELT+AO against ground seeing, with the Nyquist-sampling wavelength of 8 real cameras.
  - Planck radiance (why IR telescopes must be cold) and collecting-area comparison.
  - Lyot coronagraph simulation (pupil → focal mask → Lyot stop → image, by FFT): clear or obstructed pupil, adjustable mask and Lyot stop, a planet at any separation and contrast, and a low-order wavefront-error speckle floor.
  - Readouts for throughput, residual starlight, and planet detectability; azimuthal contrast curves.

## [0.11.0] - 2026-10-09

### Added
- **Atmospheric seeing & AO** laboratory:
  - von Kármán phase screens (L₀ = 25 m) by the FFT method plus three levels of Lane subharmonics, 8D wide, cached per aperture and rescaled analytically with r₀.
  - Taylor frozen-flow animation; short-exposure speckle, accumulated long-exposure and diffraction-limited PSFs.
  - Correction modes: none, tip-tilt, and a deformable mirror with an (n+1)² actuator grid and bilinear influence functions, with servo lag.
  - Readouts: r₀(λ), D/r₀, seeing FWHM, τ₀, Greenwood frequency, isoplanatic angle, AO error budget (fitting + lag), and the measured long-exposure Strehl.

## [0.10.0] - 2026-10-09

### Added
- **Flare, ghosts & coatings** laboratory:
  - Paraxial ghost tracing (Hullin et al. 2011) through the real Double-Gauss and Cooke prescriptions: every two-reflection path as a 2×2 system with signed media, iris-shaped ghost footprints, intensity R_iR_j(r_EP/ρ_g)², and an independent trace at each of 8 wavelengths for coloured fringes.
  - Draggable sun with a windowed polychromatic diffraction starburst of the iris, plus veiling glare.
  - Readouts: lens transmission, total ghost energy and brightest ghost pair.
- `js/lib/thinfilm.js`: Fresnel equations and characteristic-matrix multilayer reflectance (s and p, oblique incidence); coating designs: uncoated, MgF₂ quarter-wave, QHQ three-layer, and a 30-layer quintic graded-index (moth-eye) profile.
- Coating reflectance spectra with the residual reflection tint, and Fresnel Rs/Rp vs angle with Brewster's angle.

## [0.9.0] - 2026-10-09

### Added
- **Bokeh** laboratory:
  - Defocus kernels built by forward-splatting a dense pupil grid through the iris polygon (blade count and roundness, stop-down), mechanical vignetting (cat's eye), central obstruction and apodisation.
  - Spherical aberration as a cubic transverse ray error with the correct sign flip between foreground and background (under-corrected → smooth background, over-corrected → soap bubbles), caustic folding, and asphere "onion-ring" ripple.
  - Night scene with field-dependent kernels and energy-conserving brightness, a four-kernel close-up, and the measured intensity profile across the disk.

### Changed
- Readout panels give values more width, so long values wrap less.

## [0.8.0] - 2026-10-09

### Added
- **Sharpness: MTF & resolution** laboratory:
  - Optics OTF computed numerically (pupil → PSF → OTF) with defocus W₀₂₀ and spherical aberration W₀₄₀, keeping its sign so contrast reversal shows; polychromatic V(λ)-weighted averaging.
  - Cascade with the pixel-aperture sinc (fill factor) and a four-spot birefringent OLPF; Nyquist band, MTF50, MTF at Nyquist and an aliasing-risk readout.
  - 72-spoke Siemens star filtered in Fourier space by the 2-D system transfer function, shown before and after pixel sampling, with the Nyquist radius marked.
  - Two-point (Rayleigh/Sparrow) resolution profile with live dip percentage.

## [0.7.0] - 2026-10-09

### Added
- **Fisheye vs rectilinear** laboratory:
  - Per-pixel inverse ray casting into a 3-D hall (windows, chequered floor, latitude–longitude globes) with 2×2 anti-aliasing.
  - Seven projections: rectilinear, stereographic, equidistant, equisolid, orthographic, Panini and equirectangular.
  - Exact Tissot indicatrices (mapped 10° circles), coloured by local area scale.
  - Mapping-function chart r(θ) against the sensor half-diagonal; diagonal FOV for each projection; live scale factors h and k.

## [0.6.0] - 2026-10-09

### Added
- **Sensor size & equivalence** laboratory:
  - "Same lens" overlay of ten formats inside the reference lens's real image circle, showing where larger formats vignette.
  - "Same framing" view of the shared entrance pupil.
  - Equivalence table for all formats: equivalent f, N and ISO, field of view, depth of field, pixel pitch, diffraction-limited aperture and light gathered in EV.
  - Field of view vs focal length per format, and shot-noise SNR vs sensor area.
  - Live crop-factor equivalence calculation.

## [0.5.0] - 2026-10-09

### Added
- **Chromatic aberration** laboratory:
  - Sellmeier n(λ) curves, Abbe diagram and partial-dispersion map with the Schott normal line; anomalous glasses are highlighted.
  - Thin-lens focal-shift curves for a singlet, an achromat (solved from Abbe numbers) and an apochromat (3×3 solve at C, F and g), drawn against the diffraction depth of focus.
  - LoCA render: a backlit-branch scene convolved per wavelength with the exact defocus OTF in Fourier space (15 λ, CIE-weighted), plus per-channel edge-spread functions.
  - LaCA render: wavelength-dependent magnification of a test grid, scaled by the glass dispersion.

### Fixed
- Linear chart axes can now be reversed (needed for Abbe diagrams).

## [0.4.0] - 2026-10-09

### Added
- **Wavefront aberrations** laboratory:
  - Sliders for 11 Noll Zernike modes and 7 presets, including Hubble's 1990 spherical aberration.
  - Wavefront map, double-pass Fizeau interferogram with adjustable tilt, PSF, and a 5-step through-focus series.
  - Exact FFT Strehl ratio compared with the Maréchal approximation, plotted as Strehl vs RMS for the current mode mix.
  - JWST segment-phasing simulation (deployed → stacked → coarse → fine phased) with per-segment piston and tilt.
- `segmentMap()` in the pupil library: per-pixel segment membership for JWST and Keck.
- `scripts/release.sh`: bumps the version, commits, tags, pushes and publishes a GitHub release from the CHANGELOG section.

## [0.3.0] - 2026-10-09

### Added
- **Diffraction & the PSF** laboratory:
  - 13 apertures: circular, 5/6/7/9-blade irises (adjustable blade count and roundness), Newtonian, mirror lens, Hubble, JWST, Keck, ELT, double slit and square.
  - 512² FFT PSF with log display, polychromatic white light (13 λ, CIE-weighted) and near-IR false colour.
  - Zernike defocus, which triggers a separate FFT per wavelength.
  - Azimuthal profile compared with the analytic annular Airy function, encircled energy compared with 1 − J₀² − J₁², Strehl ratio, angular scale in mas for telescopes and µm for cameras.

### Fixed
- The 0.2.0 changelog wrongly listed the sensor table as new; it shipped in 0.1.0.

## [0.2.0] - 2026-10-09

### Added
- **Depth of field** laboratory:
  - Simulated photograph rendered from the real camera geometry (sensor format, focal length, shift-lens horizon).
  - Ground texture attenuated by the exact defocus OTF 2J₁(πcν)/(πcν), including contrast reversal, and by the diffraction MTF.
  - Cards and scenery convolved with a true uniform-disk kernel by Vogel-spiral sampling, so distant lights render as bokeh.
  - Log-distance DoF diagram with hyperfocal marker, and a blur-diameter vs distance chart with CoC and Airy floors.
  - Live hyperfocal and near/far-limit calculation; four circle-of-confusion criteria.

### Changed
- Ray-tracing live calculation split onto shorter lines so it fits the side panel.
- Theory sections with two columns now use the full page width.

## [0.1.0] - 2026-10-09

### Added
- Static, offline-capable app shell: sidebar navigation, hash router, lazily loaded laboratories, and an "under construction" notice for laboratories that are not implemented yet.
- Dark design system: Fraunces, Inter and JetBrains Mono typography, responsive lab layout and custom controls.
- Numerical core:
  - Radix-2 complex FFT and 2-D FFT.
  - CIE 1931 colour-matching functions, spectral → sRGB conversion, and inferno/viridis/magma/diverging colormaps.
  - Sellmeier glass catalogue (12 glasses), Abbe number, partial dispersion and group index.
  - Exact 3-D sequential ray tracer with paraxial first-order analysis, real-ray aiming, automatic clear apertures and OPD against the exit-pupil reference sphere.
  - Pupil synthesis (circle, polygon iris, obstructions and spiders, Hubble, JWST, Keck, ELT), Noll Zernike polynomials, monochromatic and polychromatic FFT PSFs, Strehl ratio and Bessel J₁.
  - Canvas charting, KaTeX helpers and the sensor-format table.
- **Introduction** page with a live hero: white light dispersed by an N-SF11 prism, traced with Sellmeier indices.
- **Physical foundations** page: the electromagnetic → scalar → geometric hierarchy, aberration theory, Fourier optics and radiometry.
- **Real-lens ray tracing** laboratory: five prescriptions, meridional trace, magnified caustic, spot diagram, ray-fan plot, chromatic focal shift, best-focus search, and the diffraction PSF from the traced wavefront.
- KaTeX 0.16.11 vendored for offline math rendering.
- README, CHANGELOG, `.gitignore`, `.editorconfig` and `package.json`.

[Unreleased]: https://github.com/iiogurt/Optica_Viva/compare/v1.4.0...HEAD
[1.4.0]: https://github.com/iiogurt/Optica_Viva/compare/v1.3.0...v1.4.0
[1.3.0]: https://github.com/iiogurt/Optica_Viva/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/iiogurt/Optica_Viva/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/iiogurt/Optica_Viva/compare/v1.0.3...v1.1.0
[1.0.3]: https://github.com/iiogurt/Optica_Viva/compare/v1.0.2...v1.0.3
[1.0.2]: https://github.com/iiogurt/Optica_Viva/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/iiogurt/Optica_Viva/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/iiogurt/Optica_Viva/compare/v0.19.0...v1.0.0
[0.19.0]: https://github.com/iiogurt/Optica_Viva/compare/v0.18.0...v0.19.0
[0.18.0]: https://github.com/iiogurt/Optica_Viva/compare/v0.17.0...v0.18.0
[0.17.0]: https://github.com/iiogurt/Optica_Viva/compare/v0.16.0...v0.17.0
[0.16.0]: https://github.com/iiogurt/Optica_Viva/compare/v0.15.0...v0.16.0
[0.15.0]: https://github.com/iiogurt/Optica_Viva/compare/v0.14.0...v0.15.0
[0.14.0]: https://github.com/iiogurt/Optica_Viva/compare/v0.13.0...v0.14.0
[0.13.0]: https://github.com/iiogurt/Optica_Viva/compare/v0.12.0...v0.13.0
[0.12.0]: https://github.com/iiogurt/Optica_Viva/compare/v0.11.0...v0.12.0
[0.11.0]: https://github.com/iiogurt/Optica_Viva/compare/v0.10.0...v0.11.0
[0.10.0]: https://github.com/iiogurt/Optica_Viva/compare/v0.9.0...v0.10.0
[0.9.0]: https://github.com/iiogurt/Optica_Viva/compare/v0.8.0...v0.9.0
[0.8.0]: https://github.com/iiogurt/Optica_Viva/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/iiogurt/Optica_Viva/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/iiogurt/Optica_Viva/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/iiogurt/Optica_Viva/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/iiogurt/Optica_Viva/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/iiogurt/Optica_Viva/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/iiogurt/Optica_Viva/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/iiogurt/Optica_Viva/releases/tag/v0.1.0
