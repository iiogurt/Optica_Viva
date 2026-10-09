# Changelog

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.0] - 2026-10-09

### Added
- **Depth of field** laboratory:
  - Simulated photograph rendered from the real camera geometry (sensor format, focal length, shift-lens horizon).
  - Ground texture attenuated by the exact defocus OTF 2J₁(πcν)/(πcν), including contrast reversal, and by the diffraction MTF.
  - Cards and scenery convolved with a true uniform-disk kernel by Vogel-spiral sampling, so distant lights render as bokeh.
  - Log-distance DoF diagram with hyperfocal marker, and a blur-diameter vs distance chart with CoC and Airy floors.
  - Live hyperfocal and near/far-limit calculation; four circle-of-confusion criteria.
- Shared sensor/film format table (`js/lib/sensors.js`), from phone sensors to 4×5″ and IMAX.

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

[Unreleased]: https://github.com/iiogurt/Optica_Viva/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/iiogurt/Optica_Viva/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/iiogurt/Optica_Viva/releases/tag/v0.1.0
