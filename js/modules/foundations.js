import { h, prose, section } from '../lib/ui.js';
import { header, references } from '../lib/page.js';

export default function mount(root, meta) {
  root.append(header({ ...meta, lede: 'Every simulation in this laboratory descends from one of four nested models of light. This page derives each from its parent and states where it stops being valid, so you know which approximation a demonstration uses and why.', domains: ['photo', 'video', 'space'] }));

  // Hierarchy diagram
  const diag = h('div.card', { style: { padding: '22px' } }, h('div', { html: `
  <svg viewBox="0 0 1000 210" width="100%" style="display:block;max-height:240px">
    <defs>
      <linearGradient id="fg1" x1="0" x2="1"><stop offset="0" stop-color="#c18cff"/><stop offset="1" stop-color="#6ad7ff"/></linearGradient>
      <marker id="ar" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" fill="#9aa1b5"/></marker>
    </defs>
    ${[
      ['Quantum optics', 'photons · shot noise · detection', '#c18cff', 0],
      ['Electromagnetic optics', 'Maxwell · polarisation · thin films', '#8fa6ff', 1],
      ['Scalar wave optics', 'Helmholtz · diffraction · PSF/OTF', '#6ad7ff', 2],
      ['Geometrical optics', 'eikonal · rays · aberrations', '#ffd27a', 3],
    ].map(([t, s, c, i]) => `
      <g transform="translate(${10 + i * 248},30)">
        <rect width="228" height="120" rx="14" fill="rgba(255,255,255,0.025)" stroke="${c}" stroke-opacity=".55"/>
        <circle cx="24" cy="28" r="6" fill="${c}"/>
        <text x="40" y="33" fill="#e9ebf3" font-family="Fraunces, serif" font-size="17">${t}</text>
        <text x="20" y="70" fill="#9aa1b5" font-family="Inter, sans-serif" font-size="12.5">${s}</text>
        <text x="20" y="100" fill="${c}" font-family="JetBrains Mono, monospace" font-size="11">${['ħω quanta', 'vector E, B', 'scalar U(r)', 'λ → 0'][i]}</text>
      </g>
      ${i < 3 ? `<path d="M${240 + i * 248} 90 L${256 + i * 248} 90" stroke="#9aa1b5" stroke-width="1.5" marker-end="url(#ar)"/>` : ''}`).join('')}
    <text x="500" y="190" text-anchor="middle" fill="#9aa1b5" font-family="Inter, sans-serif" font-size="12.5">each arrow is a limiting approximation: mean-field → neglect polarisation coupling (feature size ≫ λ) → short-wavelength asymptotics (λ → 0)</text>
  </svg>` }));
  root.append(section('The hierarchy of models', diag));

  root.append(section('1 · Electromagnetic foundation', h('div.theory-cols', {},
    prose(String.raw`
<p>In a linear, isotropic, source-free dielectric with permittivity \(\varepsilon(\mathbf r)\) and permeability \(\mu_0\), Maxwell's equations</p>
\[\nabla\times\mathbf E = -\partial_t\mathbf B,\qquad \nabla\times\mathbf H = \partial_t\mathbf D,\qquad \nabla\cdot\mathbf D = 0,\qquad \nabla\cdot\mathbf B = 0\]
<p>combine, for a monochromatic field \(\mathbf E(\mathbf r)e^{-i\omega t}\), into the vector wave equation</p>
\[\nabla^2\mathbf E + k_0^2 n^2(\mathbf r)\,\mathbf E + \nabla\!\left(\mathbf E\cdot\frac{\nabla n^2}{n^2}\right) = 0,\qquad k_0 = \frac{\omega}{c} = \frac{2\pi}{\lambda_0}.\]
<p>The last term couples the Cartesian components. It vanishes where \(n\) is uniform and is negligible when \(n\) varies slowly over a wavelength, which leaves the <strong>Helmholtz equation</strong> for each component \(U\):</p>
\[\left(\nabla^2 + k_0^2 n^2\right) U = 0.\]`),
    prose(String.raw`
<p>The full vector theory is still needed at <em>interfaces</em>. Continuity of tangential \(\mathbf E\) and \(\mathbf H\) gives the <strong>Fresnel equations</strong>, which control lens-surface reflections, ghosts and polarisers. Stacking many interfaces gives thin-film interference, which is the basis of anti-reflection coatings (see <a href="#/flare">Flare &amp; coatings</a>).</p>
<p><strong>Dispersion</strong> enters through \(n(\omega)\). Treating bound electrons as damped Lorentz oscillators gives the Sellmeier form used for every glass here:</p>
\[n^2(\lambda) = 1 + \sum_i \frac{B_i\,\lambda^2}{\lambda^2 - C_i},\]
<p>with UV resonances \(\sqrt{C_{1,2}}\sim 0.1\ \mu\text{m}\) and an IR resonance \(\sqrt{C_3}\sim 10\ \mu\text{m}\). Because the visible band lies between them, \(dn/d\lambda < 0\) (normal dispersion). This single fact is the origin of all chromatic aberration.</p>`),
  )));

  root.append(section('2 · Geometrical optics: the λ → 0 limit', h('div.theory-cols', {},
    prose(String.raw`
<p>Insert the WKB ansatz \(U = A(\mathbf r)\,e^{ik_0 S(\mathbf r)}\) into Helmholtz and collect orders of \(k_0\). The leading order gives the <strong>eikonal equation</strong></p>
\[|\nabla S|^2 = n^2(\mathbf r),\]
<p>whose characteristics are the rays \(\hat{\mathbf s} = \nabla S / n\). They obey the ray equation and, equivalently, <strong>Fermat's principle</strong> of stationary optical path:</p>
\[\frac{d}{ds}\!\left(n\frac{d\mathbf r}{ds}\right) = \nabla n,\qquad \delta\!\int_A^B n\,ds = 0.\]
<p>At a surface with unit normal \(\hat{\mathbf N}\), Fermat's principle gives Snell's law in the vector form that the ray tracer evaluates:</p>
\[n'\,\hat{\mathbf s}' = n\,\hat{\mathbf s} + \left(n'\cos\theta' - n\cos\theta\right)\hat{\mathbf N}.\]
<p>The next order gives the transport equation \(\nabla\cdot(A^2\nabla S)=0\), which is conservation of energy along ray tubes. This is the basis of radiometry. Geometrical optics fails at caustics and foci, where \(A\to\infty\), and at edges. Diffraction takes over exactly there.</p>`),
    prose(String.raw`
<h4>Paraxial (first-order) optics</h4>
<p>For rays close to the axis, \(\sin\theta\approx\theta\) and propagation becomes linear. In reduced coordinates \((y,\ nu)\), translation and refraction are \(2\times2\) matrices:</p>
\[\begin{pmatrix}y\\ n'u'\end{pmatrix} = \begin{pmatrix}1&0\\-\phi&1\end{pmatrix}\begin{pmatrix}y\\ nu\end{pmatrix},\quad \phi = (n'-n)\,c,\qquad \begin{pmatrix}1&t/n\\0&1\end{pmatrix}.\]
<p>The product matrix of the whole system gives the focal length \(f = -1/M_{21}\) and the cardinal points. The <strong>Lagrange invariant</strong> \(\mathcal H = n(\bar u y - u\bar y)\), built from a marginal and a chief ray, is conserved through the system. Its two-dimensional form, the <strong>étendue</strong> \(G = n^2 A\,\Omega\), means no passive optic can make an image brighter than its source (radiance is conserved). This is why a camera's exposure depends only on the f-number.</p>`),
  )));

  root.append(section('3 · Aberration theory', h('div.theory-cols', {},
    prose(String.raw`
<p>A perfect system turns a spherical wave from an object point into a spherical wave converging on its Gaussian image. The <strong>wave aberration</strong> \(W\) is the optical path difference between the real wavefront and that reference sphere, measured in the exit pupil. For a rotationally symmetric system, \(W\) can depend only on the invariants \(H^2,\ \rho^2,\ H\rho\cos\phi\), where \(H\) is normalised field height and \((\rho,\phi)\) are polar pupil coordinates:</p>
\[W(H,\rho,\phi) = \sum_{k,l,m} W_{klm}\,H^k\rho^l\cos^m\phi.\]
<p>The five fourth-order terms are the <strong>Seidel aberrations</strong>:</p>
<table>
<tr><th>Term</th><th>Name</th><th>Image signature</th></tr>
<tr><td>\(W_{040}\rho^4\)</td><td>Spherical</td><td>halo, focus shifts with zone</td></tr>
<tr><td>\(W_{131}H\rho^3\cos\phi\)</td><td>Coma</td><td>comet tail, 60° flare</td></tr>
<tr><td>\(W_{222}H^2\rho^2\cos^2\phi\)</td><td>Astigmatism</td><td>sagittal ≠ tangential focus</td></tr>
<tr><td>\(W_{220}H^2\rho^2\)</td><td>Field curvature</td><td>Petzval surface</td></tr>
<tr><td>\(W_{311}H^3\rho\cos\phi\)</td><td>Distortion</td><td>barrel / pincushion</td></tr>
</table>`),
    prose(String.raw`
<p>The transverse ray error in the image plane is the gradient of \(W\) (Nijboer):</p>
\[\varepsilon_x = -\frac{R}{n'}\frac{\partial W}{\partial x_p},\qquad \varepsilon_y = -\frac{R}{n'}\frac{\partial W}{\partial y_p},\]
<p>where \(R\) is the radius of the reference sphere. Spot diagrams and ray-fan plots are therefore maps of \(\nabla W\), while the PSF depends on \(W\) itself through diffraction.</p>
<p>For circular pupils, the <strong>Zernike polynomials</strong> \(Z_j(\rho,\phi)\) are the orthonormal basis. Because they are orthogonal, the RMS wavefront error is simply \(\sigma_W^2 = \sum_{j\ge2} a_j^2\), and the <strong>Maréchal approximation</strong> connects it to image quality:</p>
\[S \approx e^{-(2\pi\sigma_W/\lambda)^2},\qquad S \ge 0.8 \iff \sigma_W \lesssim \lambda/14.\]
<p>The Petzval sum \(\sum\phi_k/(n_kn'_k)\) fixes the curvature of the image surface, independent of bending. That is why flat-field lenses must spread their positive and negative power across glasses of different index.</p>`),
  )));

  root.append(section('4 · Scalar diffraction and Fourier optics', h('div.theory-cols', {},
    prose(String.raw`
<p>The Rayleigh–Sommerfeld solution of the Helmholtz equation for a field \(U_0\) across an aperture is</p>
\[U(\mathbf r) = \frac{1}{i\lambda}\iint U_0(\boldsymbol\xi)\,\frac{e^{ikr_{01}}}{r_{01}}\cos\chi\;d^2\xi.\]
<p>Expanding \(r_{01}\) in the <strong>Fresnel number</strong> \(N_F = a^2/(\lambda z)\) gives two regimes. Fresnel diffraction (\(N_F\gtrsim1\)) has a quadratic phase kernel. Fraunhofer diffraction (\(N_F\ll1\)) is a pure Fourier transform. A lens of focal length \(f\) applies the phase \(e^{-ik r^2/2f}\), which cancels the quadratic term exactly, so <em>the focal plane of any lens is the Fourier plane of its pupil</em>:</p>
\[U(u,v)\propto \mathcal F\!\left\{P(x,y)\,e^{i\frac{2\pi}{\lambda}W(x,y)}\right\}\!\Big|_{f_x = u/\lambda f,\ f_y = v/\lambda f}.\]
<p>For incoherent light the image is a convolution of the object with the <strong>intensity PSF</strong> \(|U|^2\). Its Fourier transform, the <strong>OTF</strong>, is the normalised autocorrelation of the pupil function:</p>
\[\mathrm{OTF}(\boldsymbol\nu) = \frac{\iint P(\mathbf x + \tfrac{\lambda f}{2}\boldsymbol\nu)\,P^*(\mathbf x - \tfrac{\lambda f}{2}\boldsymbol\nu)\,d^2x}{\iint|P|^2\,d^2x},\qquad \mathrm{MTF} = |\mathrm{OTF}|.\]
<p>The autocorrelation is zero beyond \(\nu_c = D/(\lambda f) = 1/(\lambda N)\). No lens, however perfect, transmits detail finer than this cut-off.</p>`),
    prose(String.raw`
<h4>How the simulations evaluate this</h4>
<p>The pupil \(P\) is rasterised on an \(N\times N\) grid with an anti-aliased (supersampled) edge, multiplied by \(e^{i2\pi W/\lambda}\), zero-padded by a factor \(Q\) and transformed with a radix-2 FFT. The PSF sample spacing is \(\Delta u = \lambda N_\# / Q\), so \(Q\ge2\) samples at Nyquist. Polychromatic PSFs repeat this per wavelength, rescale each by \(\lambda/\lambda_\text{ref}\), weight by the CIE 1931 colour-matching functions and convert to sRGB.</p>
<h4>Coherence</h4>
<p>Natural scenes are spatially incoherent, so intensities add. Laser illumination and starlight across a small aperture are coherent, so amplitudes add. The Van Cittert–Zernike theorem gives the coherence area of a source of angular size \(\theta_s\) as \(A_c\approx\lambda^2/\Omega_s\). This is why stars twinkle and planets do not, and why speckle appears in short telescope exposures (see <a href="#/seeing">Seeing</a>).</p>
<h4>Quantum limit</h4>
<p>Detection is photon counting. The number of photoelectrons in a pixel is Poisson distributed, \(\mathrm{Var}(N) = \langle N\rangle\), so even a perfect sensor has \(\mathrm{SNR} = \sqrt{\langle N\rangle}\). Sensor size, aperture and exposure time matter for noise only through how many photons they collect (see <a href="#/noise">Noise</a>).</p>`),
  )));

  root.append(section('5 · Radiometry of image formation', prose(String.raw`
<p>Radiance \(L\) is conserved along rays in lossless media (\(L/n^2\) is invariant). Combining this with the solid angle that the exit pupil subtends gives the <strong>camera equation</strong> for image-plane irradiance at field angle \(\theta\):</p>
\[E = \frac{\pi\,T\,L}{4N^2(1+|m|/m_p)^2}\cos^4\theta\cdot V(\theta),\]
<p>where \(T\) is the transmission, \(m\) the magnification, \(m_p\) the pupil magnification and \(V\) the vignetting factor. The \(N^2\) dependence defines the f-stop scale (each stop is a factor \(\sqrt2\)). The \(\cos^4\) term is natural vignetting. The \((1+m)^2\) term is the bellows factor in macro photography. Exposure is \(H = E\,t\), and the exposure value \(\mathrm{EV} = \log_2(N^2/t)\).</p>`)));

  root.append(references([
    'M. Born &amp; E. Wolf, <i>Principles of Optics</i>, 7th ed., Cambridge University Press (1999): eikonal, diffraction theory, Nijboer–Zernike theory.',
    'J. W. Goodman, <i>Introduction to Fourier Optics</i>, 4th ed., W. H. Freeman (2017): PSF/OTF, coherent vs incoherent imaging.',
    'W. T. Welford, <i>Aberrations of Optical Systems</i>, Adam Hilger (1986): wave aberration expansion, exact ray tracing.',
    'H. H. Hopkins, <i>Wave Theory of Aberrations</i>, Oxford (1950).',
    'V. N. Mahajan, <i>Optical Imaging and Aberrations</i>, Parts I–III, SPIE Press (1998–2011): Strehl ratio, Zernike, annular pupils.',
    'R. Kingslake &amp; R. B. Johnson, <i>Lens Design Fundamentals</i>, 2nd ed., Academic Press (2010).',
    'I. H. Malitson, "Interspecimen comparison of the refractive index of fused silica", JOSA 55, 1205 (1965).',
    'SCHOTT AG, Optical Glass Data Sheets (Sellmeier coefficients).',
  ]));
}
