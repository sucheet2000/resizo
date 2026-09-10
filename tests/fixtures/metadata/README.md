# Metadata fixtures

Fourteen files that between them carry every block the Image Metadata Viewer
knows how to read, and several it has to survive rather than read.

Regenerate with `npm run generate:metadata-fixtures`. The generator is
`scripts/generate-metadata-fixtures.js` and produces **byte-identical output on
every run** — fixed sharp settings, no clock, no random number generator. The
only timestamps in these files are the ones written into EXIF, XMP and ICC on
purpose, and they are constants in the script.

## Provenance

**No photograph is in this directory and nobody was photographed for it.** Every
picture is a handful of flat rectangles composited by sharp: an off-white
ground and three coloured blocks. The pixels are never the subject of a test —
these files are read for what surrounds the picture.

**No person's location is in this directory either.** The two sets of
coordinates are public landmarks with published positions, chosen so a reader
can check them against a map:

| Place | Stored as | Decimal |
|---|---|---|
| Royal Observatory, Greenwich | 51°28'40.2"N, 0°00'05.4"W | 51.477833, -0.0015 |
| Sydney Opera House | 33°51'24.5"S, 151°12'55.1"E | -33.856806, 151.215306 |

Greenwich is first because the prime meridian puts its longitude a few metres
**west** of zero. A viewer that ignored the `W` reference reports `+0.0015`
instead of `-0.0015`, and no other coordinate on earth makes that mistake as
small and as easy to miss. Sydney is the opposite corner of the world — south
and east, so both signs flip — and its EXIF is written **big-endian** (`MM`),
because roughly half the cameras in the world are and a little-endian-only
reader turns that latitude into about 855 million degrees.

`public/samples/metadata-sample.jpg` is a byte-for-byte copy of
`gps-greenwich.jpg`. It is the file behind the viewer's "Try the sample photo"
button, and it is a copy rather than a second generation so the page and the
tests are looking at exactly the same bytes.

## What each file holds

Every metadata block below is written by hand from the format specs, with the
builders in `tests/helpers/image-containers.js`. sharp draws the picture and
nothing else — it writes none of the metadata here.

| File | Format | Pixels | Alpha | Resolution | What it is for |
|---|---|---|---|---|---|
| `plain.jpg` | JPEG | 120 × 80 | no | none | The control. sharp writes no JFIF and no Exif, so this really is a JPEG with zero metadata segments. |
| `exif-camera.jpg` | JPEG | 800 × 600 | no | 300 DPI, from EXIF | A full camera block: make, model, lens, both dates, offsets, shutter, aperture, ISO, focal length, Orientation 6. |
| `gps-greenwich.jpg` | JPEG | 480 × 360 | no | 300 DPI, from EXIF | The camera block plus a GPS IFD **and a real embedded thumbnail**. |
| `gps-sydney.jpg` | JPEG | 200 × 150 | no | none | GPS only, big-endian, both signs the other way round. |
| `dpi-300.jpg` | JPEG | 300 × 200 | no | 300 DPI, from JFIF | A JFIF APP0 stating a density, and nothing else. |
| `icc-srgb.jpg` | JPEG | 140 × 100 | no | none | An ICC profile in an APP2 segment. Description `Resizo Fixture sRGB`. |
| `xmp.jpg` | JPEG | 180 × 120 | no | none | An XMP packet, and the one adversarial file here — see below. |
| `malformed-exif.jpg` | JPEG | 120 × 90 | no | 72 DPI, from JFIF | A valid JFIF beside an Exif block whose IFD0 offset points past the end. |
| `huge-comment.jpg` | JPEG | 130 × 90 | no | none | A COM segment holding exactly 60,000 bytes. |
| `png-phys.png` | PNG | 220 × 160 | no | 300 DPI, from pHYs | A pHYs chunk of 11,811 pixels per metre. |
| `png-alpha-text.png` | PNG | 240 × 180 | **yes** | none | Colour type 6, a `tEXt` keyed `Comment` and an `iTXt` keyed `Description` holding UTF-8. |
| `png-as-jpg.jpg` | **PNG** | 100 × 100 | no | none | PNG bytes under a `.jpg` name, and nothing else wrong with it. |
| `webp-alpha.webp` | WebP | 260 × 200 | **yes** | n/a | `VP8X` with the alpha flag set, then `VP8L`. |
| `webp-exif-xmp.webp` | WebP | 280 × 210 | no | n/a | `VP8X` + `ICCP` + `VP8L` + `EXIF` + `XMP `. |

WebP stores no resolution at all, which is why those two rows say n/a rather
than none: `readResolution` **throws** for a WebP rather than returning an
empty reading, and the report has to absorb that.

## The traps, and what each one is aimed at

These are the reason the fixtures are hand-built rather than whatever sharp
happens to emit.

**`exif-camera.jpg` lies about its own size.** `PixelXDimension` and
`PixelYDimension` say 4032 × 3024 on a file that is 800 × 600 — exactly what a
resizer that forgot to rewrite them leaves behind. A report that took its
dimensions from EXIF instead of from the image header shows the wrong picture
size and looks perfectly plausible doing it.

**`exif-camera.jpg` carries a negative rational.** `ExposureBiasValue` is
-1/3 EV, stored as an SRATIONAL. A parser that reads every rational as
unsigned turns that numerator into 4,294,967,295.

**`png-as-jpg.jpg` is not a JPEG.** The extension is the only thing that lies
about it: no text chunks, no resolution, no camera block. A report that trusts
the name over the magic bytes has nothing else to blame.

**`xmp.jpg` contains markup that must never become markup.** `dc:description`
holds an *escaped* script element, so a reader that decodes entities correctly
ends up holding the string `<script>alert(1)</script>` — which then has to
reach the page as text. The packet also carries an *unescaped* HTML comment
between two properties, aimed at the field scanner rather than the renderer: a
reader built out of a regex, or one that reached for `DOMParser`, behaves
differently with markup it does not own sitting in the middle of the packet.
`xmp:CreatorTool` is written in attribute form while everything else is an
element, because real packets mix the two.

**`malformed-exif.jpg` has one broken block and one good one.** The JFIF beside
the unreadable Exif still reads 72 DPI. A viewer that gives up on the whole
file because one block is bad fails here; so does one that throws.

**`huge-comment.jpg` is thirty times the display cap.** 60,000 bytes against a
2,000-character ceiling, and well inside the 65,533 a JPEG segment can hold, so
the truncation path is real rather than theoretical.

**`gps-greenwich.jpg` has a real thumbnail, not a declared one.** IFD1 points at
an actual 48 × 36 JPEG appended after the value pool. "This file contains an
embedded preview image" is a second visible copy of the picture, so it is a
fact about bytes here rather than a tag that claims one.

**`webp-exif-xmp.webp` omits the `Exif\0\0` header.** That is what the WebP
container spec asks for and what libwebp and exiftool write. The prefixed
variant some cameras emit is covered by a synthetic built in
`tests/lib/image-client/metadata-report.properties.test.js`, so both paths are
proved without a second committed binary.

## Why these are committed when `tests/e2e/fixtures/files.js` commits nothing

That file argues, correctly, that a checked-in binary is a claim about its own
contents that nothing verifies. These are the exception, and only because the
claim is verified:
`tests/lib/image-client/metadata-viewer-contract.test.js` re-opens every file
here on every run and reads it back with the independent walkers in
`tests/helpers/image-containers.js` and with sharp — the exact rationals, the
exact packet, the exact profile, the exact chunk order. A fixture that drifted
fails there before anything else can trust it.

The other half of the reason is that these files **are** the assertion. A
viewer's whole job is to report what is stored, so "51 degrees 28 minutes 40.2
seconds north" has to be the same bytes today and in a year — and a fixture
regenerated at run time by whichever sharp is installed would move under the
tests that quote it.
