// Phenomena in the wild: real photographs explained by the laboratories. Every image is public
// domain or CC BY; credits and licences are listed here and in THIRD_PARTY_NOTICES.md.

export const GALLERY = [
  {
    id: "hubble-m100",
    title: "Hubble before and after its 1993 repair",
    img: "img/gallery/hubble-m100-1993.webp",
    alt: "The galaxy M100 photographed by Hubble: blurred on the left, sharp with resolved star clusters on the right",
    see: "The core of the spiral galaxy M100, photographed by Hubble's Wide Field and Planetary Camera before (left) and after (right) the first servicing mission in December 1993.",
    physics: "Hubble's primary mirror had been polished about 2.2 µm too flat at its edge. That small error is spherical aberration: rays from the rim focus behind rays from the centre, so each star became a sharp core inside a wide halo. The replacement camera carried optics with the opposite error, and the galaxy's star clusters and dust lanes appeared.",
    labs: [["fieldpsf?tel=hubble&form=rc&dK=-0.0116", "Field-dependent PSF: Hubble 1990"], ["zernike", "Wavefront aberrations"]],
    credit: "NASA", licence: "Public domain", source: "https://commons.wikimedia.org/wiki/File:Improvement_in_Hubble_images_after_SMM1.jpg",
  },
  {
    id: "webb-deep-field",
    title: "Diffraction spikes and lensed arcs in Webb's First Deep Field",
    img: "img/gallery/webb-first-deep-field.webp",
    alt: "Webb's First Deep Field: galaxies, stars with six long and two short spikes, and thin orange arcs around a galaxy cluster",
    see: "The galaxy cluster SMACS 0723, imaged by the James Webb Space Telescope in 2022. Stars show six long spikes and two short horizontal ones; thin orange arcs curve around the cluster.",
    physics: "The spikes are diffraction: light bends at the straight edges of Webb's hexagonal mirror segments, and each edge throws light sideways at right angles to itself; the two short spikes come from the strut that holds the secondary mirror. The arcs are galaxies far behind the cluster, their light bent and magnified by the cluster's mass: gravitational lensing.",
    labs: [["psf?preset=jwst", "Diffraction & the PSF: JWST"], ["lensing", "Gravitational lensing"]],
    credit: "NASA, ESA, CSA and STScI", licence: "Public domain", source: "https://commons.wikimedia.org/wiki/File:Webb%27s_First_Deep_Field.jpg",
  },
  {
    id: "eht-m87",
    title: "The shadow of a black hole, from an Earth-sized telescope",
    img: "img/gallery/eht-m87.webp",
    alt: "An orange ring of light around a dark centre: the Event Horizon Telescope image of the black hole in M87",
    see: "The first image of a black hole's shadow, in the galaxy M87, from observations by the Event Horizon Telescope in April 2017 at 1.3 mm wavelength.",
    physics: "No single dish can resolve a ring 42 millionths of an arcsecond across. Radio telescopes across the Earth recorded the same waves and combined them as an interferometer whose resolution is set by their separation: about λ/B ≈ 25 microarcseconds for baselines up to 10 700 km. The ring is light bent around the black hole, brighter on the side where hot gas moves towards us.",
    labs: [["interferometry?array=eht&sky=ring", "Interferometry & aperture synthesis"], ["lensing", "Gravitational lensing"]],
    credit: "Event Horizon Telescope Collaboration", licence: "CC BY 4.0", source: "https://commons.wikimedia.org/wiki/File:Black_hole_-_Messier_87.jpg",
  },
  {
    id: "green-flash",
    title: "The green flash at sunset",
    img: "img/gallery/green-flash.webp",
    alt: "A sequence of sunset images: the last sliver of the Sun, distorted into layers, turns green at its top edge",
    see: "A sequence of the setting Sun photographed by Aleksandar Cikota for ESO in 2016. The disc is squashed into layers, and in the last moments its top rim turns green.",
    physics: "Near the horizon the atmosphere acts as a weak prism: it lifts blue and green images of the Sun slightly higher than the red one, by tens of arcseconds. Blue light is scattered away along the long path through the air, so the last rim to disappear is green. Temperature layers over the sea bend the light unevenly and slice the disc into mirages.",
    labs: [["adc", "Atmospheric dispersion & ADC"], ["seeing", "Atmospheric seeing"]],
    credit: "Aleksandar Cikota/ESO", licence: "CC BY 4.0", source: "https://commons.wikimedia.org/wiki/File:Green_flash_at_sunset_(greenflash-20161212-cc).jpg",
  },
];
