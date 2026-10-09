# Optica Viva

**An interactive, physically exact laboratory of the optics behind photography, cinematography and space telescopes.**

Optica Viva explains real-world optical phenomena, including depth of field, aberrations, diffraction, flare, sensor size, projection geometry and atmospheric seeing. Each one is simulated from first principles, live in the browser. Each laboratory has three layers:

1. **Laboratory**: an interactive simulation with controls.
2. **Live calculation**: the governing equations with your current values substituted.
3. **Theory**: the derivation, the assumptions, the limits of validity and primary references.

Nothing is a canned animation. Lenses are ray traced, diffraction is Fourier transformed, coatings are solved with thin-film matrices and turbulence is synthesised statistically.

## Status

Version **0.3.0**. See [CHANGELOG.md](CHANGELOG.md).

| Laboratory | Group | Status |
|---|---|---|
| Physical foundations | Overview | ✅ |
| Real-lens ray tracing | Geometric optics | ✅ |
| Catalogue of phenomena | Overview | planned |
| Depth of field | Geometric optics | ✅ |
| Sensor size & equivalence | Geometric optics | planned |
| Fisheye vs rectilinear | Geometric optics | planned |
| Perspective & distortion | Geometric optics | planned |
| Tilt–shift & Scheimpflug | Geometric optics | planned |
| Vignetting & relative illumination | Geometric optics | planned |
| Diffraction & the PSF | Wave optics | ✅ |
| Wavefront aberrations (Zernike) | Wave optics | planned |
| Sharpness: MTF & resolution | Wave optics | planned |
| Chromatic aberration | Wave optics | planned |
| Bokeh | Wave optics | planned |
| Flare, ghosts & coatings | Light, sensor & time | planned |
| Aliasing, moiré & Bayer | Light, sensor & time | planned |
| Noise & exposure | Light, sensor & time | planned |
| Rolling shutter & time | Light, sensor & time | planned |
| Atmospheric seeing & AO | Astronomy & space | planned |
| Space telescopes | Astronomy & space | planned |
| Gravitational lensing | Astronomy & space | planned |

## Running locally

The app is static HTML and ES modules with no build step. ES modules need to be served over HTTP:

```bash
npm start            # or: python3 -m http.server 8000
```

Then open <http://localhost:8000>. All dependencies are vendored, so it works offline. Google Fonts load when a connection is available and fall back to system fonts otherwise.

## Physical models

| Model | Implementation |
|---|---|
| Glass dispersion | Three-term Sellmeier equations with Schott catalogue coefficients and Malitson (1965) for fused silica and CaF₂ |
| Ray tracing | Exact 3-D vector Snell refraction through spherical surfaces, real-ray aiming at the stop by Newton iteration, vignetting by clear apertures |
| First-order optics | y–nu paraxial matrices: EFL, BFL, entrance and exit pupils, Petzval sum |
| Wavefront | Optical path difference against the exit-pupil reference sphere |
| Diffraction | Fraunhofer integral by 2-D radix-2 FFT of the anti-aliased pupil function, with an independent FFT per wavelength for polychromatic PSFs |
| Colour | CIE 1931 2° colour-matching functions (Wyman–Sloan–Shirley fit) → linear sRGB → sRGB transfer curve |

Lens prescriptions: plano-convex singlet (both orientations), a BK7/F2 cemented achromat designed for this project (spherical aberration corrected, F and C share a focus), the Cooke triplet, and the Double-Gauss.

## Project structure

```
index.html            app shell
css/style.css         design system
js/app.js             router and laboratory registry
js/lib/               numerical core
  fft.js              radix-2 FFT, 2-D FFT, fftshift
  color.js            colour-matching functions, sRGB, colormaps
  glass.js            Sellmeier glass catalogue, Abbe number, partial dispersion
  raytrace.js         exact ray tracer, paraxial analysis, ray aiming, OPD
  pupil.js            apertures (incl. Hubble/JWST/Keck/ELT), Zernike, PSF, Bessel J1
  sensors.js          sensor and film formats
  plot.js             canvas charting
  ui.js, page.js      DOM, controls, KaTeX helpers, page scaffolding
js/modules/           one file per laboratory
vendor/katex/         KaTeX 0.16.11 (MIT)
```

## Contributing and versioning

- The project follows [Semantic Versioning](https://semver.org/). Before 1.0.0, each new laboratory is a **minor** release and fixes are **patch** releases.
- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`, `refactor:` …).
- Every change updates [CHANGELOG.md](CHANGELOG.md), in [Keep a Changelog](https://keepachangelog.com/) format, and this README where relevant. Releases are tagged `vX.Y.Z`.

## Third-party

- [KaTeX](https://katex.org/) 0.16.11, MIT licence, vendored in `vendor/katex/`.
