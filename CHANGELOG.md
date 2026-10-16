# Changelog

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.16.0] - 2026-10-16

The learning platform: guided tours that move the controls for you, exercises with checked answers, export of every figure and setting, embedding in course pages, and an installable app that works offline.

### Added
- **Export** on every page: each figure gets **PNG** (the canvas as shown) and, when it holds charts, **CSV** buttons (long format: chart, series, x, y); the page header gets **Save settings**, a JSON file with the page, app version, time, link and every control value. `test/export.test.mjs` checks the CSV format.
- **Guided tours** (`js/lib/tours.js`): five step-by-step narratives that move a laboratory's controls and say what to look at: *Why stopping down stops helping* (MTF), *What really sets depth of field*, *Where diffraction spikes come from* (PSF), *Why lens coatings matter* (flare) and *Taming colour fringes* (chromatic). Each is offered on its laboratory and on the home page, and a link `#/<lab>?tour=<id>` starts it. Every narrated number was checked against the page's readouts. `test/tours.test.mjs` checks that every step sets real controls within range, and the smoke test plays every tour to the end.
- **Exercises with checked answers** (`js/lib/exercises.js`): seven "Try it yourself" problems on the depth-of-field, MTF, PSF and flare laboratories (hyperfocal distance, depth of a portrait, diffraction cut-off, diffraction meeting the pixels, Airy disk size, telescope resolution, ghost count). Numbers are drawn from a seeded generator, answers are computed with the laboratory's own functions and accept a decimal comma, a first wrong answer gets a hint, every problem has a worked solution, and **Set it up in the lab** moves the controls so the readouts show the answer. `test/exercises.test.mjs` checks the answers against textbook values; the smoke test opens every solution and set-up.
- **Embed mode**: `#/<lab>?embed=1` shows a page without the sidebar, theory, exercises or tours, for an iframe in a course page or blog; links inside it open the full app in a new tab, and a link at the bottom opens the full laboratory. The new **Embed** button in every page header copies ready-made `<iframe>` code with the current settings. `test/embed.test.mjs` and the smoke test cover it.
- **Installable app with offline cache** (PWA): `manifest.webmanifest` with icons, and a service worker (`sw.js`) that caches the whole app on the first visit (`precache.json`, 164 files), fetches network-first so an online visit is always current, refreshes the offline copy when the version changes, and caches Google Fonts. `scripts/precache.mjs` writes the list and `npm run check` fails when it is out of date. The smoke test stops the server after installation and checks that a laboratory still computes.

## [1.15.0] - 2026-10-16

Your own gear and real images ([#100](https://github.com/iiogurt/Optica_Viva/pull/100)–[#105](https://github.com/iiogurt/Optica_Viva/pull/105)): **Test your lens** measures sharpness (ISO 12233 slanted edge), vignetting and distortion from your own photographs, in the browser only; **real equipment presets** put actual camera bodies, planetary cameras and telescopes into the missions; **misconception checks** ask a predict-then-reveal question on ten laboratories; and **Phenomena in the wild** explains four famous photographs. The project now runs on Node 24. 57 pages and 258 tests.

### Added
- **Phenomena in the wild** (`#/gallery`, `js/lib/gallery.js`, `img/gallery/`): real photographs explained and linked to the laboratories that reproduce them: Hubble's view of M100 before and after its 1993 repair (spherical aberration), Webb's First Deep Field (diffraction spikes and gravitational arcs), the Event Horizon Telescope image of M87 (aperture synthesis) and ESO's green flash (atmospheric dispersion). Public-domain and CC BY 4.0 images, credited on the page and in `THIRD_PARTY_NOTICES.md`.
- Tests (`test/gallery.test.mjs`): image files, allowed licences, credits listed in the notices, valid laboratory links.
- **Misconception checks** (`js/lib/misconceptions.js`, `misconception()` in `js/lib/page.js`): a "Check your intuition" question after the plain-language idea on ten laboratories, answered before the explanation appears. Topics: the half-covered lens (Goldberg & McDermott 1987), f-number and depth of field, telephoto "compression", ISO and noise, sensor size and light, telescope size and star images, twinkling, sky polarisation, a red apple in blue light, and purple fringing.
- Tests (`test/misconceptions.test.mjs`): every check belongs to a laboratory, has 3–4 distinct options, a valid answer and a short explanation.
- **Real equipment presets** (`js/lib/equipment.js`): nine camera bodies from full frame to 1″ (sensor size and pixel count from the makers' specifications, pixel pitch derived), four planetary cameras and seven telescopes from a 51 mm refractor to a C11. The Milky Way mission accepts a camera body, the Jupiter mission a telescope and a planetary camera, the comparison mission two bodies or two telescopes, and *Test your lens* a body for its pixel size. A link that names a preset applies it unless it also carries the values.
- Tests (`test/equipment.test.mjs`): derived pixel pitches against the published ones, preset completeness, missions with real cameras.
- **Test your lens** (`#/gear`, `js/lib/esfr.js`, `js/lib/gear.js`), in a new *Your own gear* group. Load a photograph (analysed only in the browser) or a demo image with a known answer and measure:
  - **sharpness** by the ISO 12233 slanted-edge method: drag a box across a tilted edge for the MTF of each colour channel, MTF50 and MTF10 in cycles per pixel, line pairs per mm and per picture height, and lateral colour from the per-channel edge offsets;
  - **vignetting** from a flat field: corner falloff in stops, asymmetry and a radial profile;
  - **distortion** from points clicked along a straight line: the division-model coefficient and barrel or pincushion distortion at the corner.
- Tests (`test/gear.test.mjs`): MTF50 of known Gaussian blurs within 1 %, robustness to noise, edge angle and lateral shift, cos⁴ flat field, recovery of the distortion coefficient.

### Fixed
- `scripts/release.sh` still ran `node --test test/`, which fails on Node 22 and later, so `release.sh prepare` refused to release; it now runs `npm test`.
- `npm test` failed on Node 22 and later, which no longer accept a directory for `node --test`; it now passes the test files explicitly. CI and the Pages workflow run on Node 24 (Node 20 reached end of life in April 2026), `engines` requires Node 22 or later for the global `WebSocket` used by the browser scripts, and the `--experimental-websocket` flag is gone.

## [1.14.0] - 2026-10-15

Four new laboratories complete the v1.13 milestone ([#94](https://github.com/iiogurt/Optica_Viva/pull/94)–[#98](https://github.com/iiogurt/Optica_Viva/pull/98)): **underwater photography** (colour lost with depth and distance, ports and strobes), **narrowband filters on fast optics** (the angle shift of interference filters), **autofocus** (split-pixel phase detection against contrast detection) and **computational photography** (night-mode bursts, burst super-resolution and synthetic portrait blur). 55 interactive pages and 248 tests.

### Added
- **Computational photography laboratory** (`#/computational`, `js/lib/computational.js`). A test target is sampled by a burst of noisy frames with hand-shake offsets: one short frame, one long exposure of the same light smeared by shake, the aligned burst average (SNR × √N, minus the read noise of each frame) and a 2× super-resolution merge that places every sample at its sub-pixel position. Portrait mode compares real optical background blur with blur computed from a coarse depth map, which loses fine hair and leaves halos.
- Tests (`test/computational.test.mjs`): √N burst gain and its read-noise penalty, measured noise in the merge, more fine detail from super-resolution, depth-map errors growing with coarseness.
- **Autofocus laboratory** (`#/autofocus`, `js/lib/autofocus.js`, worker task `autofocus`). A strip of the scene is blurred by the projected defocus disc (FFT convolution), sampled by pixels with photon noise, and focused two ways: phase detection, which cross-correlates the images seen through the left and right halves of the pupil (shifted by (4/3π)Δv/N) and moves the lens in one or a few frames, and contrast detection, which climbs the sharpness curve step by step. Readouts give the blur, the half-image shift, where each method sets focus, its precision and how many frames it needs.
- Tests (`test/autofocus.test.mjs`): blur and half-pupil disparity, the correlated shift against the prediction, both methods reaching focus with phase detection in fewer frames.
- **Narrowband filters on fast optics laboratory** (`#/filters`, `js/lib/ifilter.js`). The passband of an interference filter shifts as λ₀√(1 − (sin θ/n*)²); averaged over the cone of an f/N beam (and the chief-ray angle off axis) it blurs and moves bluewards, so a narrow Hα, [O III], [S II] or Hβ filter can lose its own line. Charts show the filter in parallel light and in the beam, and the line transmission against focal ratio for 3–12 nm filters; the best pre-shift of the filter is computed.
- Tests (`test/ifilter.test.mjs`): the angle shift and its small-angle limit, slow against fast beams, pre-shifting and off-axis loss.
- **Underwater photography laboratory** (`#/underwater`, `js/lib/underwater.js`). Pure-water absorption (Pope & Fry) plus dissolved organic matter for clear ocean, coastal water and a green lake: the CIE test colours and a grey card at the surface, by daylight at depth and distance, and with a strobe, with or without white balance, and the transmission spectrum. Flat ports (narrower field, magnification, lateral colour from water's dispersion) and dome ports (the virtual image the lens must focus on), and where strobe light enters the camera's view, which sets the backscatter.
- Tests (`test/underwater.test.mjs`): red against blue absorption, green lakes, the water index and its dispersion, a neutral white-balanced grey card, a strobe restoring red, flat-port magnification, the dome's virtual image and the backscatter geometry.

### Changed
- ROADMAP: the v1.13 *New laboratories* milestone is complete with all seven laboratories.

## [1.13.0] - 2026-10-15

Seven more missions complete the v1.12 milestone ([#85](https://github.com/iiogurt/Optica_Viva/pull/85)–[#92](https://github.com/iiogurt/Optica_Viva/pull/92)): a **portrait session**, a **total solar eclipse** (exposure ladder from NASA's guide), **filming under LED light** and on LED walls, **choosing a camera or telescope**, **designing an Earth-observation satellite**, **planning an exoplanet observation** and a **security camera or drone survey**. Each turns the laboratory models into a plan with the reason for every setting. 51 interactive pages and 232 tests.


### Added
- **Mission: Security camera or drone survey** (`#/mission-survey`, `js/lib/survey.js`). For a security camera: pixels per metre on a person, the IEC 62676-4 level reached (detection, observation, recognition, identification) and the distance limit of each, motion blur and rolling-shutter skew of a walking person, with a face drawn at the actual pixel count. For a mapping drone: ground sample distance, photo footprint and interval for the chosen overlap, the half-pixel shutter limit and rolling-shutter skew.
- Tests (`test/survey.test.mjs`): the DORI levels, pixel density and distances of a 4 MP camera, GSD, shutter limit and photo interval.
- **Mission: Plan an exoplanet observation** (`#/mission-exoplanet`, `js/lib/exoimaging.js`). For an Earth twin, a super-Earth or a Jupiter twin around a Sun-like star it gives the reflected-light contrast A_g(1/π)(R_p/a)², the separation against the coronagraph's inner working angle in λ/D, and the photon-limited time to detect the planet (SNR 7) and to take an R = 70 spectrum, against residual starlight and local and exozodiacal dust. A sky view shows the planet against the inner working angle, and a chart the detection time against distance.
- Tests (`test/exoimaging.test.mjs`): 2 × 10⁻¹⁰ for an Earth twin, 100 mas at 10 pc and the 6 m vs 2.4 m inner working angle, integration-time scaling.
- **Mission: Design an Earth-observation satellite** (`#/mission-satellite`, `js/lib/satellite.js`). From a target ground sample distance, orbit height, pixel size, optics Q, required SNR and swath it derives the focal length (Hp/GSD), the mirror (λf/(Qp) ≈ λH/(Q·GSD)), the number of TDI stages that reaches the SNR with the Earth-observation laboratory's signal model, and the raw data rate. The telescope is drawn to scale next to a person.
- Tests (`test/satellite.test.mjs`): focal length and mirror for 50 cm from 600 km, mirror scaling with GSD, data rate scaling with swath.
- **Mission: Choose a camera or telescope** (`#/mission-choose`, `js/lib/choose.js`). Two cameras for the same shot are compared through their entrance pupils (light and noise in stops, depth of field, megapixels and the diffraction-limited aperture, and the f-number that would make them equivalent); two telescopes through resolution (Rayleigh and Dawes), light grasp, limiting magnitude, the seeing at your site and the useful magnification range. A bar chart scales each quality to the better option.
- Tests (`test/choose.test.mjs`): two stops and twice the depth of field from full frame to Micro Four Thirds at equal f-number, equality at equal pupils, telescope limits.
- **Mission: Film under LED light** (`#/mission-led`, `js/lib/ledset.js`). For frame rate, shutter angle, mains frequency, flicker depth, LED fixture PWM, sensor readout and an LED wall it lists the flicker-free shutter angles (360° · k · fps / f_flicker), the band contrast 2m|sinc(f t)| and band count of mains-powered lights, the PWM banding of dimmed LED fixtures, and the wall distance beyond which the wall's grid stays below 1 % contrast. Charts show the brightness down the frame and the moiré contrast against wall distance.
- Tests (`test/ledset.test.mjs`): flicker-free angles for 50 and 60 Hz mains, band contrast, defocusing the wall.
- **Mission: Photograph a total solar eclipse** (`#/mission-eclipse`, `js/lib/eclipse.js`). The ND 5.0 front filter and exposure for the partial phases, the Sun's image size and the longest focal length that still fits the corona, the 15-stop exposure ladder for totality from F. Espenak's NASA exposure guide (t = N²/(I·2^Q), Baily's beads to the outer corona) and how many passes fit into totality, and whether a fixed tripod smears the long exposures. The corona is rendered from the table's brightness exponents as one exposure and as a merged ladder.
- Tests (`test/eclipse.test.mjs`): the exposure formula, the table values and 15-stop range, the Sun's image size, the framing limit and the drift.
- **Mission: Portrait session** (`#/mission-portrait`, `js/lib/portrait.js`). For your sensor, framing, distance, aperture, background distance and light it gives the focal length that fills the frame and the nose enlargement at that distance (natural below 5 %, from about 2.5 m), the depth of field across the face and the widest aperture that keeps both eyes sharp, background blur as a share of the frame, and the light's apparent size and background falloff. A top view shows camera, sharp zone, face, light and background.
- Tests (`test/portrait.test.mjs`): nose enlargement, focal length for the framing, equal depth of field at equal magnification, background blur.

### Changed
- ROADMAP: the v1.12 *Missions* milestone is complete with all nine missions.

## [1.12.0] - 2026-10-14

Optics for real tasks ([#78](https://github.com/iiogurt/Optica_Viva/pull/78)–[#83](https://github.com/iiogurt/Optica_Viva/pull/83)). **Missions**, a new kind of page, turn the laboratory models into a plan for a real task: photographing the Milky Way and imaging Jupiter from a garden. Three new laboratories: **lighting** (hard and soft light, rendered with shadow rays), **exoplanet transits** and **Earth observation from orbit**. The ROADMAP gains milestones for more missions, laboratories and testing your own gear. 44 interactive pages and 205 tests.

### Added
- **Earth observation from orbit laboratory** (`#/earthobs`, `js/lib/earthobs.js`). For orbit height, mirror, focal length, pixel size and TDI stages it computes the ground sample distance, the ground-track speed and push-broom line rate, the time per line, the signal and SNR from sunlit ground, Q = λf/(Dp), the diffraction limit on the ground and the system MTF (optics × pixel × along-track smear). An 80 × 56 m city block at 10 cm is rendered as recorded from orbit, with blur, sampling and noise. Presets: a CubeSat camera, a mapping satellite and a very-high-resolution satellite.
- Tests (`test/earthobs.test.mjs`): orbital and ground speeds, GSD, Q and the diffraction limit, the circular-aperture MTF, TDI signal scaling.
- **Exoplanet transits laboratory** (`#/transits`, `js/lib/transit.js`). The light curve of a limb-darkened star crossed by an opaque planet (quadrature over the planet's disc, quadratic limb darkening), the orbit from Kepler's third law, the duration T₁₄ (Seager & Mallén-Ornelas), the transit probability R★/a, and simulated measurements with photon noise and a systematic floor for a backyard telescope, TESS, Kepler or JWST. Presets: the Earth and Jupiter in front of the Sun, HD 209458 b and TRAPPIST-1 e. The catalogue gains *Exoplanet transits*.
- Tests (`test/transit.test.mjs`): area-ratio depth, the limb-darkened total flux, 1 AU and 13 h for the Earth, about 3.1 h for HD 209458 b, photon noise scaling.
- **Lighting laboratory** (`#/lighting`, `js/lib/lighting.js`). A round area light, from a bare flash to a 2 m window, lights a head-sized sphere in front of a wall. The image is rendered in the worker by integrating the light's disc with shadow rays (checked against the exact on-axis irradiance of a disc), with Fresnel reflections of the light on glossy surfaces. A top view shows the umbra and penumbra, and a chart the inverse-square falloff to the wall. Readouts: the light's angular size, penumbra (S b/d) and umbra widths, how many stops darker the wall is, the catchlight size in the cornea, and the flash aperture from the guide number. The catalogue's *Inverse-square law* and *Lambertian reflection* link here.
- Tests (`test/lighting.test.mjs`): disc quadrature against the exact result, inverse square, umbra and penumbra, shadow rays, falloff, catchlight, guide number and Fresnel reflectance.
- **Missions**, a new kind of page that solves a real task by combining laboratory models, with a *Missions* group in the sidebar and on the home page. Each step gives the answer first, then why, the formula and a link to the laboratory that explores it (`missionStep()` in `js/lib/page.js`).
- **Mission: Photograph the Milky Way** (`#/mission-milkyway`, `js/lib/milkyway.js`). For your sensor, focal length, aperture, target declination, Bortle sky and faintest detail it computes the longest exposure before stars trail (f ω cos δ against two pixels or the Airy disk, compared with the 500 and NPF rules), the ISO-invariance point, how much of the noise is read noise, and the number of frames for a signal-to-noise ratio of 5. A pixel-level view shows a star at the planned exposure and at the 500 rule, and a chart shows SNR against frames for your sky and a pristine one. The catalogue's *Star trails & the 500 rule* links here.
- **Mission: Image Jupiter from your garden** (`#/mission-jupiter`, `js/lib/jupiter.js`). For your aperture, native focal ratio, pixel size, camera frame rate, seeing, wind, Jupiter's altitude and size it gives the Nyquist focal ratio and Barlow factor (N = 2p/λ), the frame exposure from the coherence time τ₀ = 0.314 r₀/v, the capture length before rotation moves detail by λ/D, the share of frames to keep (Fried's probability) and whether atmospheric dispersion calls for a corrector. Jupiter is rendered at your pixel scale as a seeing-limited long exposure and as lucky stacks with and without a corrector.
- Tests (`test/jupiter.test.mjs`): Nyquist ratio, r₀ and τ₀, the 2.4-minute rotation limit for 20 cm and its scaling, dispersion against altitude.
- Tests (`test/milkyway.test.mjs`): sidereal rate, trailing limit and its scaling, the 500 and NPF rules, the ISO-invariance definition, and frames that just reach the target.

### Changed
- ROADMAP: new milestones v1.12 *Missions* (practical tasks such as photographing the Milky Way or imaging Jupiter), v1.13 *New laboratories: light, water and worlds* (lighting, exoplanet transits, Earth observation, underwater, computational photography, autofocus, interference filters) and v1.14 *Your own gear and real images*; further phenomena in the backlog.

### Fixed
- The browser smoke test skipped pages whose id contains a hyphen (the missions), and counted only readouts as results; mission answers now count too.

## [1.11.0] - 2026-10-14

Optica Viva now works for readers at every level, without a beginner/expert switch ([#68](https://github.com/iiogurt/Optica_Viva/pull/68)–[#75](https://github.com/iiogurt/Optica_Viva/pull/75)). All 39 pages climb from simple to exact: the idea in plain words with things to try, the live result in a sentence, a rule of thumb with a worked number and its limits, then the full model and references, with a strip to jump between the steps. A glossary explains 62 technical terms where they first appear, the home page suggests a 17-laboratory "Start here" path, and catalogue entries open from example to equation. 39 interactive pages, 228 catalogue entries and 178 tests.

### Changed
- An opened catalogue entry now reads from simple to exact like the laboratories: worked example, explanation, then the equation, which gets its own label.

### Added
- **"Start here" path** on the home page (`js/lib/path.js`): 17 laboratories in three stages, from everyday photography (perspective, depth of field, noise) through lens behaviour to telescopes and the research frontier, each with the question it answers. Laboratories already opened are ticked; this is remembered only in the browser. The order is a suggestion, not a lock. The home page's reading guide now describes the simple-to-exact ladder and the glossary.
- Tests (`test/path.test.mjs`): the path visits existing laboratories once each, with a question per step.
- **Glossary** (`js/lib/glossary.js`): 62 technical terms, from f-number and depth of field to Strehl ratio, Fried parameter and Einstein ring, each with a one-sentence plain definition. The first use of a term on a page gets a dotted underline; hovering, focusing or tapping it shows the definition and a link to the laboratory that simulates it. Abbreviations match only in capitals, longer terms win over shorter ones ("spherical aberration" before "aberration"), and the KaTeX formulas, links and headings are left alone.
- Tests (`test/glossary.test.mjs`): short, plain, unique definitions with valid laboratory links; every term occurs in some page; only the first use is marked.
- **From the simple idea to the full model.** Pages now climb from simple to exact, with everything visible in that order and no beginner/expert switch:
  - ① *The idea*: the phenomenon in plain words, without symbols, beside two or three things to try in the simulation;
  - the simulation, whose live calculation now starts with the result in a sentence ("Sharp from 2.17 m to 2.23 m, 6.7 cm deep …");
  - ② *Rule of thumb*: the formula worth remembering, a worked number and where it stops working;
  - ③ *Full model* (the existing derivation) and ④ references.

  A strip under the title shows the steps, highlights the current one and jumps between them. The depth-of-field, diffraction & PSF and atmospheric seeing laboratories are the pilot; the plain-language idea replaces their technical lede.
- `idea()`, `rule()` and `liveCalc().say()` in `js/lib/page.js`; the router adds the strip to any page with an idea.
- **Ladder for all geometric-optics laboratories**: real-lens ray tracing, sensor size & equivalence, fisheye vs rectilinear, perspective & distortion, tilt–shift, panorama & parallax, macro, the human eye and vignetting each open with the idea in plain words and things to try, state the live result in a sentence, and give a rule of thumb with a worked number and its limits (the lensmaker's equation, crop-factor equivalence, r = f tan θ, size ∝ 1/distance, the hinge rule, pupil-offset parallax, N(1 + m), c = Vα/E, cos⁴θ).
- **Ladder for the wave-optics laboratories**: wavefront aberrations (Maréchal's S ≈ e^−(2πσ)²), MTF & resolution (diffraction cut-off vs Nyquist), chromatic aberration (Δf ≈ f/V and the secondary spectrum), bokeh (disc size f²/N(s − f)) and polarisation (Brewster's angle).
- **Ladder for the light, sensor & time laboratories**: flare & ghosts (R = ((n − 1)/(n + 1))², k(k − 1)/2 ghosts), aliasing (Nyquist 1/2p and folding), noise (SNR = √n), HDR (bracket range), colour science (tristimulus integrals, CRI), anamorphic lenses (squeeze and T-stops), rolling shutter and the wagon-wheel effect, camera shake (t ≤ c/fω), film grain (Selwyn's law) and LED-wall moiré in virtual production.
- **Ladder for the astronomy & space laboratories and the physical foundations**, completing it on all 39 pages: lucky imaging (Fried's probability), wavefront sensing (fitting error 0.28 (d/r₀)^5/3), spectroscopy (R = mN), interferometry (B₀ = 1.22 λ/θ), detectors (up-the-ramp slope noise), atmospheric dispersion ((n − 1) tan z), stacking (SNR ∝ √T and the cost of light pollution), starshade (Fresnel number and inner working angle), field-dependent PSF (coma ∝ H, astigmatism ∝ H²), coronagraphy (speckle contrast (πh/λ)²), gravitational lensing (Einstein radius) and, on the foundations page, when rays are enough.
- `scripts/screenshots.mjs`: laboratory crops are measured from the top of the simulation, so they follow it when text is added above.
- Tests (`test/ladder.test.mjs`): every laboratory in the sidebar has the ladder; a page with an idea has no symbols and at most 120 words in it, 1–3 things to try, a rule of thumb with its limits and the result in words.

## [1.10.0] - 2026-10-14

A structured **catalogue explorer** ([#66](https://github.com/iiogurt/Optica_Viva/pull/66)): 13 groups with an overview and navigator, expandable entries with an explanation and a worked example each, search across groups and shareable links. The catalogue grows by 56 phenomena to 228, every equation is checked to render, and the colour accents of the sidebar and home cards now show. 39 interactive simulations and 133 tests.

### Added
- **Catalogue explorer** (`#/catalogue`). The single long page is replaced by an overview of the 13 groups (with counts and the share simulated), a group navigator (a horizontal strip on phones), one group at a time with expandable entries, previous/next group buttons, and search across all groups with results grouped by group. An opened entry shows its equation, a fuller explanation, a worked example with real numbers, a link to its laboratory and related entries from the same laboratory. Group, entry, search and filters are kept in the URL (`#/catalogue?g=…&e=…&q=…`).
- **56 new phenomena** (228 in total), among them Fermat's principle, the Lagrange invariant, the pinhole camera, Seidel sums, Zernike polynomials, the sine condition, Coddington's equations, stop shift, partial dispersion, encircled energy, Gaussian beams, zone plates, the Talbot effect, photometric units, metering, magnitudes, the Fresnel equations, Stokes parameters, waveplates, the photon transfer curve, DQE, EMCCDs, TDI, star trails, Rayleigh and Mie scattering, laser guide stars, the green flash, exoplanet contrast, nulling interferometry, the contrast sensitivity function, metamerism and the Purkinje shift. Each links to a laboratory only where one simulates it.
- `js/lib/phenomena-details.js`: an explanation and a worked example for every entry.
- Tests (`test/catalogue.test.mjs`): unique names, slugs and group ids; valid laboratory links; details for every entry and none for unknown ones; every equation and inline formula renders with the vendored KaTeX.

### Fixed
- `h()` now sets CSS custom properties from a `style` object (`Object.assign` on `el.style` ignored them). The colour accents of the sidebar dots and the home-page laboratory cards now show as designed.
- The *Quantisation* catalogue entry had a three-word description.

## [1.9.0] - 2026-10-13

Seven new laboratories for astronomy and space (PRs [#55](https://github.com/iiogurt/Optica_Viva/pull/55)–[#64](https://github.com/iiogurt/Optica_Viva/pull/64)): **Interferometry & aperture synthesis**, **Detector physics in space**, **Atmospheric dispersion & ADC**, **Lucky imaging**, **Astrophotography stacking**, **Starshade** and **Field-dependent PSF**. Each is validated against known results: the van Cittert–Zernike visibility of a uniform disk, the exact variance of up-the-ramp slopes, Edlén's air index, Fried's lucky-frame probability, the CCD equation, the Poisson–Arago spot and Babinet's principle, and Hubble's as-built Ritchey–Chrétien conics and its 1990 conic error. All simulations now share one seeded random-number generator. 39 interactive simulations, 172 catalogue entries and 129 tests.

### Changed
- ROADMAP, README and CLAUDE.md: the v1.9 milestone is complete with all seven astronomy and space laboratories.

### Added
- **Field-dependent PSF laboratory** (`#/fieldpsf`, `js/lib/fieldpsf.js`). It computes Seidel sums through the two mirrors of Cassegrain, Ritchey–Chrétien and Dall–Kirkham telescopes (Welford's surface formulas with n′ = −n, spherical and conic parts kept apart), set up from first-order data (Hubble-like 2.4 m f/24, or a 0.4 m f/8 RC). FFT PSFs are computed on a 5 × 5 field grid in the worker, with the pupil resampled where the wavefront is too steep to sample. The page shows an RMS wavefront map over the field and RMS vs field for the three designs, with a flat detector or one on the medial surface. Errors: primary conic, secondary despace, decentre and tilt. Misalignment follows nodal aberration theory: field-constant coma, binodal astigmatism with the nodes marked, and the coma-free point. A button sets Hubble's 1990 primary (K₁ = −1.0139). The catalogue gains *Field-dependent PSF*, *Misalignment & nodal aberrations* and *Hubble's spherical aberration*.
- Tests (`test/fieldpsf.test.mjs`): Schroeder's RC conics cancel S_I and S_II and give Hubble's K₁ = −1.0023, K₂ = −1.497; Cassegrain coma equals a paraboloid's; two-mirror Petzval sum; despace sensitivity m² + 1; Hubble's 2.2 µm edge error and W₀₄₀ = twice it; a decentred RC secondary gives constant coma and two symmetric astigmatic nodes; FFT Strehl agrees with Maréchal to 3 %.
- **Starshade laboratory** (`#/starshade`, `js/lib/starshade.js`). It computes scalar Fresnel diffraction behind a circularly symmetric occulter, integrated in r² with Filon's rule (the Fresnel phase is exact, so an opaque disk is exact) and one Richardson step, converged to 10⁻¹⁴ in intensity. The page draws a hypergaussian starshade (opaque core a, petal scale b, order n, petal count). It shows a log-intensity map of its shadow at the telescope, shadow profiles at 400 nm, the chosen wavelength and 1000 nm against an opaque disk of the same size (Poisson–Arago spot), and the aperture-averaged suppression from 300 to 1200 nm. Readouts give the Fresnel number, the inner working angle in mas and λ/D, and the band below 10⁻¹⁰. Computed in the worker. The catalogue gains *Starshades (external occulters)* and *Poisson–Arago spot*.
- Tests (`test/starshade.test.mjs`): Bessel J₀ against tabulated values; the axial intensity behind a disk is 1; the spot follows J₀²; a circular hole's axis follows 4 sin²(πF/2) (Babinet); a Cash hypergaussian reaches ~10⁻¹⁰ in the visible but not at 1 µm; the integral has converged.
- Tests (`test/random.test.mjs`): uniform and normal moments, no serial correlation (variance of sums of 20 normals, lag-1 autocorrelation), and Poisson mean = variance.
- **Astrophotography stacking laboratory** (`#/stacking`, `js/lib/stacking.js`). It applies the CCD equation for N sub-exposures (object, sky, dark current, read noise). Sky brightness comes from the Bortle class through a V-band photon zero point, and the sky-limited sub length is t = σ²/(0.1 F_sky). A spiral galaxy with stars is rendered as one sub vs the stack (same stretch), with SNR curves vs sub length for four sky classes and vs total time. The catalogue gains *Image stacking (√N)*, and *Sky background & light pollution* links here. The random numbers use mulberry32: a plain LCG feeding Box–Muller left correlations that biased Monte-Carlo sums by 4 %.
- Tests (`test/stacking.test.mjs`): Monte-Carlo stack SNR and image noise match the CCD equation; σ_r² = 0.1 F_s t at the sky-limited length; 4× the time gives 2× the SNR; Bortle 4 vs 8 gives × 10^(0.2Δμ).
- **Lucky imaging laboratory** (`#/lucky`, `js/lib/lucky.js`). Short exposures are cut by a pupil from a frozen-flow phase screen, with tip-tilt-removed variance and FFT PSF per frame, ranked by Strehl. The page shows the best and worst frames, the long exposure, shift-and-add of all frames and the lucky selection, a Strehl histogram, and the simulated probability of a lucky frame against Fried's formula. Computed in the worker, with the probability curve cached. *Lucky imaging & speckle interferometry* in the catalogue now links here.
- Tests (`test/lucky.test.mjs`): tip-tilt removal is exact; the probability follows Fried's exponential slope within 30 %; lucky selection beats shift-and-add, which beats the long exposure.
- **Atmospheric dispersion & ADC laboratory** (`#/adc`, `js/lib/adc.js`). It computes Edlén's refractive index of standard air with the pressure and temperature correction for three sites (sea level, Paranal, Mauna Kea), plane-parallel refraction and dispersion vs zenith angle, and a 5800 K star rendered from seeing-limited images at 31 wavelengths. A two-doublet zero-deviation ADC (three glass pairs) is rotated to cancel the dispersion, and the page plots the residual secondary spectrum. The catalogue's *Atmospheric dispersion* and *Atmospheric refraction* entries now link here.
- Tests (`test/adc.test.mjs`): (n − 1)·10⁸ = 27 653 at 633 nm, refractivity proportional to pressure, 57.3″ of refraction at z = 45°, dispersion ∝ tan z, zero deviation at the central wavelength, and an ADC residual below 10 %.
- **Detector physics in space laboratory** (`#/detectors`, `js/lib/detectors.js`). It covers:
  - **Up-the-ramp sampling:** Poisson accumulation, read noise and an optional cosmic ray. The page compares CDS, least-squares and jump-detecting segment fits, and plots slope noise against the number of reads with the exact correlated-noise variance.
  - **Inter-pixel capacitance:** the coupling kernel, its variance factor and the resulting gain bias.
  - **Charge-transfer inefficiency:** trap-and-release trails behind stars in a CCD column readout.
  - **Persistence:** decay curves.
  - **Catalogue:** *Charge-transfer inefficiency* and *Inter-pixel capacitance* are new entries, and *Cosmic rays & persistence* links here.
- Tests (`test/detectors.test.mjs`): Monte-Carlo LS and CDS slope variances match the exact formulas, and the read-noise term equals 12σ²/(N(N²−1)Δt²); jump detection is unbiased; IPC conserves charge and has the predicted variance factor; CTI keeps (1−ε)ⁿ in the core and conserves charge.
- **Interferometry & aperture synthesis laboratory** (`#/interferometry`, `js/lib/interferometry.js`).
  - **Michelson stellar interferometer:** fringes of a uniform disk summed numerically over the star, against the van Cittert–Zernike visibility |2J₁(x)/x|, with the first null at 1.22 λ/θ (the Betelgeuse case).
  - **Aperture synthesis:** Earth-rotation u-v coverage for a VLA-like Y, the four VLTI Unit Telescopes and the 2017 EHT, the last with geocentric stations and 15° elevation limits. Visibilities are gridded with uniform or natural weighting to give the dirty beam and image, followed by Högbom CLEAN with restoring beam. Sky models: black-hole ring, binary, core + jet, disk. Runs in the worker (`aperture` task).
  - **Catalogue:** two new entries.
- Tests (`test/interferometry.test.mjs`): the Betelgeuse diameter and null, summed fringes vs |2J₁(x)/x|, an east–west baseline from the pole tracing a circle of radius B/λ, the EHT resolution ≈ 25 µas, the dirty-beam normalisation, and CLEAN recovering a binary's flux ratio.
- `scripts/worktree.sh`: one git worktree per branch. `new <type>/<name>` creates the branch from a freshly fetched `origin/main`, without an upstream, in `../Optica-Viva.worktrees/`. `finish` checks that the PR was merged, then removes the worktree and local branch, prunes and fast-forwards `main`. CONTRIBUTING.md and CLAUDE.md now describe this workflow.

### Changed
- `scripts/worktree.sh finish` warns when the merge commit GitHub created records an email that is not a noreply address. Server-side merges take the author and committer from the GitHub account, so its *Keep my email addresses private* setting must stay on; CLAUDE.md and CONTRIBUTING.md say so.
- All simulations now draw their random numbers from one seeded generator, `js/lib/random.js` (mulberry32 uniforms, Box–Muller normals, Poisson). This replaces ten local copies of a 32-bit LCG whose consecutive outputs, fed to Box–Muller, were correlated: sums of 20 deviates came out about 8 % too high in variance. That affected the phase screens (seeing, AO, lucky imaging), sensor noise, HDR brackets, camera shake, film grain, detector ramps and tolerancing. Random realisations on those pages change; all physics tests pass unchanged.

### Fixed
- `scripts/worktree.sh` runs from the main checkout (so `finish` works when called from inside the worktree it removes) and tolerates GitHub deleting the merged branch first.
- `scripts/worktree.sh finish` also deletes a merged branch left on the remote: `gh pr merge --delete-branch` skips it when the branch is checked out in a worktree. The repository now deletes merged head branches automatically (GitHub setting).
- CHANGELOG: the v1.8.0 summary named "Noll-style analytic checks", which belong to v1.7.0.

## [1.8.0] - 2026-10-13

Seven new laboratories for photography and cinema (PRs [#43](https://github.com/iiogurt/Optica_Viva/pull/43)–[#50](https://github.com/iiogurt/Optica_Viva/pull/50)): **Panorama & parallax**, **Anamorphic & cinema lenses**, **Filters & HDR**, **Camera shake & stabilisation**, **The human eye**, **Film & grain** and **Virtual production**. Each pairs a simulation from first principles with validation against theory or measurement: exact geometric and statistical checks, Thibos's chromatic eye, Selwyn's law, Campbell & Gubisch's optimum pupil, CIPA-like stabilisation gains. 32 laboratories and 99 tests.

### Added
- **Virtual production laboratory** (`#/vp`, `js/lib/virtual.js`).
  - **Moiré:** the LED-wall grid on the sensor at ν = 1/(m p), with grid modulation from the emitter fill factor and the defocus disk MTF 2J₁(πbν)/(πbν). The lens diffraction MTF, the photosite aperture and an optional OLPF are also applied, followed by aliasing at the sensor's sampling frequency.
  - **Distance:** a contrast-vs-distance curve with the aliased region and the nearest moiré-safe distance, plus a camera-pixel rendering of the wall behind an actor (labelled contrast stretch).
  - **Refresh banding:** exact PWM banding for a rolling shutter vs shutter angle, duty, readout time and genlock phase.
  - **Catalogue:** *LED-wall moiré & refresh banding* is a new entry.
- Tests (`test/vp.test.mjs`): ν = Z/(f p), aliasing, the square-wave fundamental 4/π, the disk-MTF zero at 3.8317 with contrast reversal, focus on the wall raising moiré more than 10×, and zero banding for whole PWM periods with the row simulation matching the formula.
- **Film & grain laboratory** (`#/film`, `js/lib/film.js`). The emulsion is a Boolean model: layers of Poisson-placed silver-halide grains with a truncated log-normal size distribution, each developed after a few absorbed photons (Poisson tail).
  - **Characteristic curve:** a rendered step wedge of developed grains, and the H&D curve from Nutting's law.
  - **Grain:** granularity vs ISO, and the exact Selwyn granularity from the overlap integral ∫(e^{K(h)} − 1)d²h.
  - **Efficiency and reciprocity:** detective quantum efficiency, and Schwarzschild reciprocity failure.
  - **Implementation:** the simulation runs in the worker. The catalogue gains *Film characteristic curve & grain*, and *Reciprocity failure* links here.
- Tests (`test/film.test.mjs`): the simulated density and granularity match the Boolean model, and σ√A is constant (Selwyn); Nutting's D = 0.434 N a; ISO 400 needs 4× less exposure; DQE of a few per cent; the Schwarzschild correction.
- **The human eye laboratory** (`#/eye`, `js/lib/eye.js`). Le Grand's full theoretical eye uses water-like ocular media as model glasses. Power, focal lengths and refraction come from the paraxial matrix, with the refractive error defined as the object-space vergence conjugate to the retina. The chromatic difference of refraction is compared with Thibos et al.'s measured chromatic eye, and a schematic shows ray paths at two wavelengths. The retinal PSF and MTF are computed by FFT for pupils of 1–8 mm, with representative higher-order aberrations scaled by pupil order and Stiles–Crawford apodisation, plus a sweep of Strehl and MTF at 30 and 60 c/deg vs pupil (in the worker). A calculator derives the circle of confusion from visual acuity. The catalogue gains *The eye as an optical system* and *Stiles–Crawford effect*.
- Tests (`test/eye.test.mjs`): 59.94 D; near-emmetropia; ocular LoCA within 15 % of the measured chromatic eye; the diffraction cut-off and MTF; the best pupil between 2.5 and 4 mm; d/1500 corresponds to 2.3′.
- **Camera shake & stabilisation laboratory** (`#/shake`, `js/lib/shake.js`).
  - **Shake model:** hand-held angular motion per axis is an Ornstein–Uhlenbeck drift velocity plus ~10 Hz tremor, for three photographers.
  - **Stabiliser:** a type-2 servo (bandwidth f_c, ζ = 0.7) follows the gyro's rate and angle; the gyro error is an angle random walk.
  - **Page:** each exposure's image-point path is its PSF, shown on a Siemens star with a resample button and pixel grid. A Monte-Carlo probability of a sharp frame vs shutter speed is computed with and without stabilisation, giving safe shutter speeds and the gain in EV. Everything runs in the worker. *Camera shake* and *Image stabilisation* in the catalogue link here.
- Tests (`test/shake.test.mjs`): f·t at the safe shutter is nearly constant (reciprocal rule); the servo residual follows (f/f_c)²; a good gyro gains more than 4 EV and a noisier one less; the path PSF conserves energy.
- **Filters & HDR laboratory** (`#/hdr`, `js/lib/hdr.js`). A procedural 20-stop sunset with the sun in frame is photographed by a photon-transfer camera model (three sensors: full well, shot and read noise, ADC). Features: graduated ND filters (strength, height, soft or hard edge); exposure brackets of 1–7 frames; a radiance merge with inverse-variance weights t²/(S + σ_r²), tone-mapped with Reinhard's global operator; and exposure fusion (Mertens et al.) with Laplacian-pyramid blending. Everything is computed in the worker with a draft pass. SNR-vs-radiance curves cover single frames and the merge, alongside readouts of dynamic range and exposure times. The catalogue gains *HDR bracketing & exposure fusion* and *Neutral-density & graduated filters*, and *Tone mapping & dynamic range* links here.
- Tests (`test/hdr.test.mjs`): dynamic range log₂(FWC/S_SNR=1); +8 EV for five frames 2 EV apart; SNRs add in quadrature; the merged radiance is unbiased within 1 %; ND and graduated-filter transmissions; Reinhard output in range; pyramid fusion is exact for identical frames.
- **Anamorphic & cinema lenses laboratory** (`#/cinema`, `js/lib/cinema.js`).
  - **Anamorphic scene:** a 2.39 : 1 night scene through a spherical or anamorphic lens (1.33–2× squeeze), with oval bokeh sized from the defocus geometry and an optional recorded (squeezed) view. The horizontal streak flare's colour is computed from the coating's R(λ)² and its strength from the source brightness.
  - **Focus breathing:** a unit-focusing lens, a paraxial two-group internal-focus design (fixed sensor, chief ray through the stop) and a compensated lens, shown as frame overlays and curves.
  - **T-stops:** photopic surface reflectance of each coating, transmission through k surfaces and the T-number.
  - **Catalogue:** *Anamorphic lenses*, *T-stops* and *Focus breathing* now link here.
- Tests (`test/cinema.test.mjs`): the 2.39 : 1 aspect, unit-focus breathing equal to 1/(1 + m), the IF design at 50 mm breathing less, uncoated Fresnel R and T = N/√τ, and the streak colours.
- **Panorama & parallax laboratory** (`#/panorama`, `js/lib/panorama.js`). Two frames are ray-cast from the entrance pupils of a camera rotated about an offset pivot: a striped near pole, a second pole, a checkerboard ground and a skyline 60 m away. They are blended on a cylinder as a stitcher assumes, rendered in the worker with a draft pass. The page offers a frame-difference view, a 3× zoom on the overlap, a to-scale top view of both camera positions and their lines of sight, and readouts of the exact parallax (in pixels for 6 µm pixels), the pivot tolerance and the nearest stitchable distance. A table compares the paraxial entrance pupil z = B/A with the front nodal point z = (D − 1)/C for the library lenses. The catalogue gains a *No-parallax point* entry. `paraxialMatrix` is now exported from `raytrace.js`.
- Tests (`test/panorama.test.mjs`): the exact disparity formula against the ray geometry and its small-offset limit; a seamless stitch about the pupil and doubling at a 60 mm offset; the principal points of plano-convex lenses (0 and t/n) and the Double-Gauss pupil–nodal gap.

### Changed
- ROADMAP, README and CLAUDE.md: the v1.8 milestone is complete with all seven photography and cinema laboratories.

## [1.7.0] - 2026-10-13

New laboratories for astronomy (PRs [#36](https://github.com/iiogurt/Optica_Viva/pull/36)–[#41](https://github.com/iiogurt/Optica_Viva/pull/41)). **Wavefront sensing & AO loop** simulates a diffraction Shack–Hartmann sensor, a least-squares reconstructor and a closed adaptive-optics loop with its error budget, plus a modulated pyramid sensor. **Spectroscopy** covers prisms and gratings, blaze and overlapping orders, resolving power, and a slit-limited échelle spectrograph with a rendered échellogram of the Sun. Colour rendering now uses the tabulated CIE observer. 25 laboratories and 75 tests.

### Added
- **Astronomical échelle spectrograph** in the spectroscopy lab. It computes the slit-limited resolving power R = 2 tan θ_B D_col/(φ D_tel), combined in quadrature with diffraction, and the transmission of a Gaussian seeing disk through the slit, with the resolution vs throughput trade-off. An échellogram of the Sun is rendered for R2 or R4 échelles cross-dispersed by a prism on a 4k × 4k detector: orders 88–161, blaze envelope per order, and solar lines broadened to the instrument resolution with their equivalent width conserved. A Na D zoom at the resulting R is shown alongside. Test: the UVES-like configuration gives R ≈ 40 000, R ∝ 1/φ, a slit equal to the FWHM passes erf(√ln2), m λ_B = 2 d sin θ_B, orders separate more widely in the blue, and broadening conserves equivalent width.
- **Spectroscopy laboratory** (`#/spectro`, `js/lib/spectro.js`). It compares prisms (60° apex, six glasses, R = b|dn/dλ| from Sellmeier) with diffraction gratings in a Littrow mount at the first-order blaze (grating equation, scalar blaze envelope per order, R = mN, angular dispersion, free spectral range). The detector strip has a colour row and a silicon-signal row that also shows UV and IR light from overlapping orders, with an optional order-sorting filter. Sources: the Sun (5778 K continuum, Fraunhofer and telluric lines) and Hg, Ne, H and Na lamps. A zoom plot convolves the spectrum with the sinc² instrument profile, and further plots show blaze efficiency per order or prism R vs wavelength. The catalogue gains three entries (gratings, blaze & orders, prism spectroscopy), and *Rainbows, prisms & halos* links here.
- Tests (`test/spectro.test.mjs`): Littrow blaze in orders 1 and 2, the grating round trip and order overlap, R = mN, the Rayleigh dip 8/π², the sodium doublet resolved at R = 3000 but not 400, prism dispersion against the F–C mean, and solar line depth vs R.
- **Pyramid wavefront sensor** in the AO lab. The pupil field is focused by an FFT onto a four-faced pyramid phase mask and re-imaged into four pupils, with circular modulation (a symmetric ring of tilted copies). The page shows the slope signals Sx and Sy for tilt, defocus, astigmatism, coma or turbulence, and the tilt response curve (computed in the worker) against the geometric law (2/π) asin(θ/R) with the optical gain. Test: zero signal without aberration, the arcsine law within 15 % when modulated, more than 8× higher sensitivity and saturation without modulation, and no cross-talk between axes.
- **Wavefront sensing & AO loop laboratory** (`#/wfs`, `js/lib/wfs.js`).
  - **Sensor:** a diffraction model of the Shack–Hartmann sensor (one zero-padded FFT spot per lenslet) with photon (Poisson) and read noise, thresholded centre-of-gravity centroids in a peak-centred window, and per-lenslet centroid gains calibrated through the sensor with two small tilts.
  - **Reconstruction and loop:** a regularised least-squares Zernike reconstructor (Cholesky) drives a modal deformable mirror with an integrator against frozen-flow von Kármán turbulence on an 8 m telescope. The loop is a persistent simulator in the compute worker (`aoLoop` task); each request advances it for ~120 ms.
  - **Page:** the detector mosaic, short- and long-exposure science PSFs, turbulence, mirror and residual maps, wavefront error vs time, and modal rejection. The analytic error budget combines Noll fitting error, Greenwood temporal error and noise propagated through the reconstructor and loop.
  - **Catalogue:** new entries *Shack–Hartmann wavefront sensing* and *Greenwood frequency & AO bandwidth*; *Adaptive optics* now links here.
- Tests (`test/wfs.test.mjs`): calibrated slopes equal the mean gradient; Z₄–Z₂₂ are recovered within 4 %; the Zernike fitting error after 21 modes matches Noll's Δ₂₁ within 15 % over 24 phase screens; centroid variance scales as 1/N_ph; the closed loop converges to its fitting error.

### Changed
- ROADMAP, README and CLAUDE.md: the v1.7 milestone is complete with its two P1 laboratories. The remaining astronomy laboratories move to a new v1.9 milestone.
- Colour: `cmf()` now interpolates the tabulated CIE 1931 2° observer (5 nm) instead of the Wyman–Sloan–Shirley analytic fit, and `wavelengthRGB` takes its hue from 380–720 nm only. Deep red and infrared wavelengths previously rendered yellow-green or teal.
- The von Kármán phase-screen generator moved from the seeing page to `js/lib/turbulence.js`, shared with the AO lab.

## [1.6.1] - 2026-10-13

### Added
- **MIT licence** (`LICENSE`), the `license` field in `package.json`, and `THIRD_PARTY_NOTICES.md` with the KaTeX (MIT) and colour-science (BSD-3-Clause) notices. README: licence badge and section.

## [1.6.0] - 2026-10-13

New laboratories for photography and cinema (PRs [#28](https://github.com/iiogurt/Optica_Viva/pull/28)–[#33](https://github.com/iiogurt/Optica_Viva/pull/33)). **Polarisation** renders a lake per pixel in Stokes vectors under a Rayleigh sky, behind a rotating polariser, and adds photoelasticity and the birefringent OLPF. **Macro & magnification** covers pupil magnification, the diffraction-limited optimum aperture and focus stacking on a ray-cast ruler. **Colour science** computes CIE colorimetry, the CIE 13.3 colour rendering index of real LED and fluorescent spectra, camera colour pipelines and metamerism. 23 laboratories and 64 tests.

### Added
- **Colour science laboratory**, part 2.
  - **Camera colour.** Four sensor models (typical CMOS Bayer, narrow-band, broad, Luther–Ives ideal), each with an IR cut. Raw response under any CIE illuminant, grey-card or preset white balance, and a 3×3 colour matrix fitted by least squares with exact white preservation (Finlayson & Drew), either for the scene or reused from daylight. CIEDE2000 errors on 24 patches (the 14 CIE samples plus 10 smooth synthetic reflectances), and the Luther–Ives residual.
  - **Metamerism.** A metameric black is projected out of S x̄, S ȳ, S z̄ and added to any patch. The pair matches in daylight and separates under another lamp and for the camera.
- Tests: the Luther camera is exact, narrow filters are worse than the CMOS model, the matrix preserves white, a daylight white balance under tungsten gives a cast, and a metamer matches in D65 but not under FL11.
- **Colour science laboratory**, part 1 (`#/colour`, `js/lib/colorsci.js`, `js/lib/colordata.js`).
  - **CIE tables at 5 nm**, generated from the colour-science datasets (BSD-3-Clause): 1931 2° observer, daylight basis S₀/S₁/S₂, illuminant A, FL1–FL12 (8 of them), HP1, and the CIE 15:2018 LED series B1–B5, BH1, RGB1, V1, V2.
  - **Calculations:** correlated colour temperature and Duv by golden-section search along the Planckian locus; the exact **CIE 13.3 colour rendering index** (R1–R14, Ra) with black-body or daylight references; Bradford adaptation; CIELAB; **CIEDE2000**.
  - **The page:** the source spectrum against its reference, the 14 test colours under both, R-index bars, and a zoomed CIE 1960 (u, v) diagram with the Planckian locus and Duv contours.
  - **Catalogue:** *Colour rendering (CRI, R9)* is a new entry; *Colour temperature & white balance* and *Chromatic adaptation* now link here.
- Tests (`test/colour.test.mjs`): CCT of A (2856 K) and the D65 chromaticity; Ra of eight CIE fluorescent illuminants within 0.6 of the published values; CIEDE2000 against four Sharma test pairs; white mapping under Bradford adaptation.
- **Macro & magnification laboratory** (`#/macro`, `js/lib/macro.js`). It covers close-up optics with pupil magnification: N_w = N(1 + m/m_p), bellows factor, extension and working distance. Five representative unit-focusing lenses are included: symmetric 50 mm, 100 mm macro, 35 mm retrofocus, the same lens reversed, and a 180 mm telephoto. A steel ruler with bar targets, tilted away from the camera, is rendered in the worker through each pixel's chief ray (exact close-range perspective, 2×2 supersampling). Each point gets its exact exit-pupil defocus blur from a disk-kernel stack and an Airy-width Gaussian for diffraction. There are two views, full frame and a 100 % crop of a 24 MP sensor. Other features: focus stacking (each pixel keeps its sharpest frame), the RSS optimum aperture N_w,opt = √(m²δ/(2·2.44λ)), a to-scale side view with both pupils, blur-vs-aperture and exposure-loss curves, theory and references. The catalogue gains a *Focus stacking* entry, and *Bellows factor* links here.
- `gaussianExact` in `js/lib/macro.js`: a separable Gaussian with exact taps for sub-pixel σ, where the three-box approximation has response zeros near a 3-px period.
- Tests (`test/macro.test.mjs`): N_w and the 2-stop loss at 1 : 1, 4f conjugates, the reversed-lens penalty, exact blur vs m²δ/N_w, numeric depth of field vs 2N_w c/m² (1 %), the Airy diameter, the RSS optimum, frame count, Gaussian MTF at 1/3 cycle per pixel, and focus stacking reducing the worst blur more than fourfold.
- **Polarisation laboratory** (`#/polarisation`, `js/lib/polar.js`). A lake scene is rendered per pixel with Stokes vectors and Mueller matrices. Skylight comes from a single-scattering Rayleigh slab (Chandrasekhar), with Hansen & Travis optical depth at 16 wavelengths, a 5778 K sun and the E-vector perpendicular to the scattering plane. It reflects off rippled water through Fresnel Mueller matrices in the plane-of-incidence frame. Light from a pebble bottom passes through pure-water (Pope & Fry) and CDOM absorption and leaves through the Fresnel transmission matrix. A rotating polarising filter (k₁ = 0.80, k₂ = 0.002) acts on the result. The renderer is a flat scalar loop in the worker, about 0.3 s per 480×270 frame on a Raspberry Pi 4, with a half-resolution draft while controls move. The page also has an all-sky map of the degree and angle of polarisation with the camera field, Fresnel curves for water and N-BK7 with the Brewster angles, and a polariser and wave-plate chain with polarisation ellipses and the Malus curve.
- **Photoelasticity** in the polarisation lab. A disk in diametral compression (Hertz/Frocht stress field) is shown between circular (dark or light) or crossed plane polarisers, in white light or sodium light. Five materials are available, from polycarbonate (82 Br) to N-BK7 (2.77 Br). Colours are integrated over 61 wavelengths as a Michel-Lévy table, the image is 2×2 supersampled, and a Michel-Lévy chart marks the centre retardation.
- **Birefringent optical low-pass filter** in the polarisation lab: extraordinary-ray walk-off for quartz, lithium niobate and calcite vs the optic-axis angle, a section view of the plate, the plate thickness that makes the spot separation equal the pixel pitch, and the four-spot pattern on Bayer pixels. The catalogue's *Birefringence* and *Stress birefringence* entries now link here.
- Tests: Hertz disk centre stresses, force balance, free boundary and the calibration formula N = 8P/(πDf_σ). Michel-Lévy colours (dark at 0, first-order white, magenta sensitive tint). Walk-off maximum at tan θ = nₑ/nₒ, quartz 5.875 µm/mm at 45°, calcite 6.26°.
- Tests (`test/polar.test.mjs`): Malus's law and the three-polariser 1/8, λ/4 and λ/2 plates, Brewster angles and Fresnel values, Rayleigh optical depth and polarisation, the thin-slab limit, and the renderer's centre pixel against an explicit Mueller chain. A vertical polariser extinguishes a Brewster-angle reflection.

### Changed
- ROADMAP, README and CLAUDE.md: the v1.6 milestone is complete with its three P1 laboratories. The remaining photography and cinema laboratories move to a new v1.8 milestone after the v1.7 astronomy laboratories.

## [1.5.0] - 2026-10-12

Higher-fidelity rendering (PRs [#22](https://github.com/iiogurt/Optica_Viva/pull/22)–[#26](https://github.com/iiogurt/Optica_Viva/pull/26)): lens flare and bokeh are now traced with exact rays through the real prescriptions, depth of field and tilt-shift blur with the exact disk kernel, and small defocused disks show their Fresnel diffraction rings. The remaining phenomenological shortcuts of the flare, bokeh and tilt-shift labs are gone.

### Added
- **Diffraction-aware bokeh**: a *Small disks* panel in the traced bokeh mode. It computes the FFT PSF of the lens's traced, vignetted pupil with the sensor moved to a chosen defocus W₀₂₀ (worker task `defocusPSF`), at 550 nm and averaged over 450–650 nm, next to the aberration-free pure-defocus profile and the geometric disk. Test: the on-axis intensity follows sinc²(W₀₂₀/λ) (dark at 1 and 2 waves), and the PSF approaches the geometric disk at large defocus.
- **Exact disk (pillbox) blur** in `js/lib/blur.js`: per-row prefix sums with anti-aliased span ends, normalised by the discrete kernel weight, premultiplied alpha, and a downsampled path above r = 8 px that keeps the cost near r ≈ 4. Tilt-shift now blends a stack of disk-blurred images instead of Gaussians (similar speed), and depth of field uses the exact disk for every image up to 1.2 Mpx. Tests: unit sum, plateau 1/(πr²), RMS radius r/√2 within 2.5 % on both paths; a uniform image is unchanged.
- **Bokeh from the traced lens** (`js/lib/bokeh.js`), now the default model of the bokeh lab. Defocused point images are traced through any library prescription at 8 wavelengths: background lights at infinity, foreground lights at half the focus distance, and the sensor at the real-ray image of the focus distance. They use the flux-conserving triangle rasteriser, generalised to the direct path, point sources, fitted windows and rounded blades. The lens's own spherical aberration, secondary-spectrum fringes (magenta foreground, green background), cat's eyes from the clear apertures (new barrel slider) and coma emerge without parameters. Disks are drawn at physical size on a 36 mm sensor. The 18 kernels are computed in the worker. The phenomenological model remains as a second mode.
- Tests (`test/bokeh.test.mjs`): a stopped-down disk matches the paraxial diameter within 1 % and conserves the pupil flux within 0.5 %; under-correction gives a soft background and a bright-rimmed foreground; the colour order of the rims matches longitudinal colour (singlet) and the secondary spectrum (achromat).
- `controls()` options accept `when(state)` to show a control only for some settings.
- **Real-ray lens-flare ghosts** (`js/lib/ghosts.js`), following the full method of Hullin et al. (2011). Exact rays are traced through every two-reflection path at 8 wavelengths, and the ray grid is rasterised as flux-conserving triangles. The iris polygon and every clear aperture are tested per pixel through an interpolated aperture gauge, so edges stay sharp. Reflectances use each ray's actual angle of incidence on the thin-film coating, and total internal reflection is included. The result shows aberrated, vignetted and cat's-eye ghosts with caustics. Ghost paths that would stay invisible are culled. It runs in the worker: a draft while the sun moves, then a refined image. The paraxial model is still available as an instant mode and serves as the preview while tracing.
- Tests (`test/ghosts.test.mjs`): in the paraxial limit, traced ghosts match the y–nu ghost matrices in position (3 %), size (2 %) and flux (3 %); the ghost-path count is k(k−1)/2; coatings rank uncoated > MgF₂ > QHQ.
- `npm run bench` times the ghost renderer: on a Raspberry Pi 4, about 0.7 s for a draft and 1.7 s for a refined Double-Gauss image.

### Changed
- ROADMAP, README and CLAUDE.md: the v1.5 milestone is complete; the spectral scene renderer and ghost-irradiance smoothing move to the Backlog.
- Flare: in the real-ray model the veiling glare holds only the scatter term, because the traced image already contains the faint ghosts. Paraxial ghost matrices moved from the flare page to `js/lib/ghosts.js`.

### Fixed
- Ghost and bokeh rasteriser: pixel centres on a shared triangle edge were counted twice, which drew a faint line along the cell diagonals. Sub-pixel triangles were also under-weighted at aperture edges, losing up to 5 % of the flux on dense grids.

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

[Unreleased]: https://github.com/iiogurt/Optica_Viva/compare/v1.16.0...HEAD
[1.16.0]: https://github.com/iiogurt/Optica_Viva/compare/v1.15.0...v1.16.0
[1.15.0]: https://github.com/iiogurt/Optica_Viva/compare/v1.14.0...v1.15.0
[1.14.0]: https://github.com/iiogurt/Optica_Viva/compare/v1.13.0...v1.14.0
[1.13.0]: https://github.com/iiogurt/Optica_Viva/compare/v1.12.0...v1.13.0
[1.12.0]: https://github.com/iiogurt/Optica_Viva/compare/v1.11.0...v1.12.0
[1.11.0]: https://github.com/iiogurt/Optica_Viva/compare/v1.10.0...v1.11.0
[1.10.0]: https://github.com/iiogurt/Optica_Viva/compare/v1.9.0...v1.10.0
[1.9.0]: https://github.com/iiogurt/Optica_Viva/compare/v1.8.0...v1.9.0
[1.8.0]: https://github.com/iiogurt/Optica_Viva/compare/v1.7.0...v1.8.0
[1.7.0]: https://github.com/iiogurt/Optica_Viva/compare/v1.6.1...v1.7.0
[1.6.1]: https://github.com/iiogurt/Optica_Viva/compare/v1.6.0...v1.6.1
[1.6.0]: https://github.com/iiogurt/Optica_Viva/compare/v1.5.0...v1.6.0
[1.5.0]: https://github.com/iiogurt/Optica_Viva/compare/v1.4.0...v1.5.0
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
