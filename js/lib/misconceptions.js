// Misconception checks: one predict-then-reveal question per laboratory where physics-education
// research or common photography lore shows a typical wrong intuition. Each entry: question,
// options, index of the correct option, and the explanation shown after an answer.

export const CHECKS = {
  raytracer: {
    q: 'Half of a lens is covered with black card. What happens to the image of a candle on a screen?',
    options: ['Half of the candle disappears from the image', 'The whole candle is still imaged, only dimmer', 'The image becomes blurred', 'The image turns the other way up'],
    answer: 1,
    why: 'Every part of the lens receives light from every point of the candle and sends it to the same image point. Covering half the lens removes half of those rays for every point, so the whole image stays and gets dimmer. Most students expect half the image to vanish (Goldberg and McDermott, 1987).',
  },
  dof: {
    q: 'You change the aperture from f/2 to f/8 without moving. What happens to the zone that looks sharp?',
    options: ['It gets shallower, because 8 is a bigger number', 'It gets deeper', 'It stays the same; only the brightness changes'],
    answer: 1,
    why: 'f/8 is a smaller opening than f/2 (the f-number divides the focal length). A narrower cone of light makes smaller blur spots away from the focus, so the sharp zone grows, about four times here.',
  },
  perspective: {
    q: 'A telephoto lens makes the mountains behind a person look closer and bigger. Why?',
    options: ['The long lens compresses the space between them', 'The photographer stood far away; the lens only crops', 'Telephoto lenses magnify distant objects more than near ones'],
    answer: 1,
    why: 'Relative sizes depend only on where the camera stands. From far away, person and mountains differ less in distance ratio, so the mountains look large next to the person. Any lens from that spot, cropped to the same framing, shows exactly the same picture.',
  },
  noise: {
    q: 'A photo taken in a dark room at ISO 6400 is noisy. What mainly causes the noise?',
    options: ['The high ISO setting adds noise', 'Too few photons reached each pixel', 'The sensor heats up at high ISO'],
    answer: 1,
    why: 'Light arrives as photons at random, and the fewer there are, the larger the relative scatter. The high ISO only amplifies a weak signal that is already noisy; at the same shutter speed and aperture a low ISO picture brightened later looks about as noisy on modern sensors.',
  },
  sensor: {
    q: 'Two cameras take the same picture at f/2 and the same shutter speed: one full frame, one with a small sensor. Which collects more light in total?',
    options: ['Both the same, because f/2 is f/2', 'The full-frame camera', 'The small-sensor camera'],
    answer: 1,
    why: 'f/2 gives the same light per square millimetre, but the full-frame sensor has four times the area of a Micro Four Thirds one, and for the same framing its lens has a wider opening. More total light means less noise in the whole picture.',
  },
  psf: {
    q: 'A star is photographed through a large and through a small telescope, both perfect. In which does the star look like the smaller dot?',
    options: ['The small telescope: it magnifies less', 'The large telescope', 'Both the same: a star is a point'],
    answer: 1,
    why: 'Diffraction spreads light from a point into a disc whose angular size is about the wavelength divided by the aperture. The wider the opening, the smaller that disc, which is why big telescopes show finer detail.',
  },
  seeing: {
    q: 'Why do stars twinkle while planets mostly do not?',
    options: ['Stars change their brightness quickly', 'Turbulent air bends a star\'s point-like light; a planet\'s small disc averages it out', 'Planets are closer, so their light is stronger'],
    answer: 1,
    why: 'Pockets of warmer and cooler air bend starlight by slightly different amounts. A star is a point, so its whole image dances and flickers; a planet is a small disc made of many points that flicker independently and average out.',
  },
  polarisation: {
    q: 'You turn a polarising filter while photographing a blue sky. Where does the sky darken most?',
    options: ['Everywhere equally', 'In a band about 90° away from the Sun', 'Right next to the Sun'],
    answer: 1,
    why: 'Sunlight scattered by air molecules is most strongly polarised at right angles to the sunlight. There the filter can block most of it; close to the Sun or opposite it there is little polarised light to block.',
  },
  colour: {
    q: 'A red apple is lit only by pure blue light. What colour does it look?',
    options: ['Red', 'Purple', 'Almost black'],
    answer: 2,
    why: 'The apple looks red because it reflects red light and absorbs the rest. Blue light contains no red to reflect, so the apple absorbs nearly everything and looks dark.',
  },
  chromatic: {
    q: 'Purple fringes appear along branches against a bright sky. Which change helps most?',
    options: ['Raising the shutter speed', 'Stopping the lens down a little', 'Lowering the ISO'],
    answer: 1,
    why: 'The fringes come from the lens bringing colours to slightly different focus; a smaller aperture narrows each colour\'s cone of light and shrinks the fringes. Shutter speed and ISO do not change the optics.',
  },
};
