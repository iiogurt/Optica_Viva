# Changelog

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/iiogurt/Optica_Viva/compare/v0.4.0...HEAD
[0.4.0]: https://github.com/iiogurt/Optica_Viva/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/iiogurt/Optica_Viva/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/iiogurt/Optica_Viva/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/iiogurt/Optica_Viva/releases/tag/v0.1.0
