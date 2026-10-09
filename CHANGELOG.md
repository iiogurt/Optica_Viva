# Changelog

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/iiogurt/Optica_Viva/compare/v0.19.0...HEAD
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
