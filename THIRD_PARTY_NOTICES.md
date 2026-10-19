# Third-party notices

Optica Viva is released under the [MIT License](LICENSE). It includes or derives from the following third-party material, which remains under its own licence.

## KaTeX

`vendor/katex/` contains KaTeX 0.16.11, © Khan Academy and other contributors, under the MIT License. The full text is in [`vendor/katex/LICENSE`](vendor/katex/LICENSE).

## colour-science datasets

The tables in `js/lib/colordata.js` were generated from the datasets of the [colour-science](https://github.com/colour-science/colour) Python package. They reproduce the CIE publications CIE 15:2018 and CIE 13.3-1995. The colour-science licence:

```
BSD 3-Clause License

Copyright 2013 Colour Developers
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its
   contributors may be used to endorse or promote products derived from
   this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

## Published physical data

Glass Sellmeier coefficients (SCHOTT AG data sheets; Malitson 1965), CIE colorimetric tables, and other constants cited on each laboratory page are factual reference data. Their sources are credited where they are used.

The Biogon prescription in `js/lib/raytrace.js` is Example 2 of L. Bertele, US patent 2,721,499 (1955), an expired patent; the Hubble Space Telescope and JWST values are published design data (credited on the ray-tracer page).

## Photographs in *Phenomena in the wild* (`img/gallery/`)

Resized and converted to WebP; otherwise unchanged.

| File | Credit | Licence | Source |
|---|---|---|---|
| `hubble-m100-1993.webp` | NASA | Public domain | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Improvement_in_Hubble_images_after_SMM1.jpg) |
| `webb-first-deep-field.webp` | NASA, ESA, CSA and STScI | Public domain | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Webb%27s_First_Deep_Field.jpg) |
| `eht-m87.webp` (cropped to a square) | Event Horizon Telescope Collaboration | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Black_hole_-_Messier_87.jpg), ESO eso1907a |
| `green-flash.webp` | Aleksandar Cikota/ESO | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Green_flash_at_sunset_(greenflash-20161212-cc).jpg) |
