# Changelog

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
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

[Unreleased]: https://github.com/iiogurt/Optica_Viva/compare/v1.7.0...HEAD
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
