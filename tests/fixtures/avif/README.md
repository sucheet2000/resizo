# AVIF fixtures

Five files no encoder will write for you, and one reason they are committed.

Everything else the AVIF suite needs is a picture, and pictures are drawn at
test time: `tests/e2e/fixtures/files.js` writes its own AVIFs into `os.tmpdir()`
on every run. These five are not pictures. Each one is a file that is **wrong in
a specific, named way** — a still that declares itself an animation, a download
that stopped halfway, a picture with a quarter turn stored beside it — and the
wrongness is the fixture. No encoder produces any of them.

Regenerate with:

```bash
node scripts/generate-avif-fixtures.js
```

## Provenance

**Nothing here was downloaded and no third-party image is involved.** The base
picture is 96 × 64 of flat rectangles from a fixed table — four quadrants in
four colours and a white block high on the left — drawn by
`scripts/generate-avif-fixtures.js` and encoded by sharp at quality 60. No
PRNG, no clock, no text and therefore no font, which is the one thing that
would make two machines draw different pixels.

The asymmetry is deliberate and it is the assertion: a rotated or mirrored copy
is only distinguishable from the original if no two corners look alike. A 180°
turn would swap the quadrants back into a plausible picture, so the white block
breaks the last symmetry and says which way up the file is.

Each committed file is then **the base with bytes moved**, by
`tests/helpers/isobmff-edit.js`, which writes those bytes from ISO/IEC 14496-12
and ISO/IEC 23008-12 rather than from anything under `lib/`.

The base itself is **not** committed: it would be a fifth picture with nothing
wrong with it, and the suite already draws better ones.

## Not byte-pinned, on purpose

The bytes are a function of whichever libheif and aom sharp was built against.
Measured here:

| Component | Version |
|---|---|
| sharp | 0.35.3 |
| libvips | 8.18.3 |
| libheif | 1.23.1 |
| aom | 3.14.1 |

`tests/lib/image-client/avif.properties.test.js` re-opens all five on every
vitest run and asserts **what each file says**, never its length and never its
hash. Regenerating against a newer libheif is expected to change the bytes and
must not change a single assertion. A stale or swapped fixture fails there
rather than quietly weakening a Playwright flow.

## The five files

| File | Bytes | What it is | What a decoder does with it |
|---|---:|---|---|
| `avis-brand.avif` | 331 | The base with its **major brand rewritten to `avis`**. Compatible brands still read `mif1, avif, miaf`; the picture behind it is untouched and the `ispe` still says 96 × 64. | libvips refuses it: *Input buffer contains unsupported image format*. The engine must refuse it **before** any decode, by the brand, with `avif-animated`. |
| `irot-90.avif` | 341 | The base with an **`irot` of 90°** appended to `ipco` and associated with the primary item as an essential property. | libvips decodes it to **64 × 96** — the stored `ispe` is still 96 × 64, and the first pixel is the source's top-right green. Anti-clockwise, which is what the box means. |
| `imir.avif` | 341 | The base with an **`imir` of axis 1** added the same way. | libvips decodes it to 96 × 64 with the halves exchanged left to right: the first pixel is the source's top-right green. |
| `truncated.avif` | 290 | The base **cut in half inside `mdat`**. Every box before it is complete, `iloc` still describes both extents, and the bytes those extents point at are not all there. | libvips reads the metadata fine and then refuses the decode: *Extent in iloc box references data outside of file bounds*. This is the hardest damaged file to catch — a reader that checks only the header sees nothing wrong. |
| `garbage-after-ftyp.avif` | 84 | A **valid `ftyp` and then a sentence**. The sniffer reads the first sixteen bytes, so this is recognised as an AVIF and then falls apart. | libvips refuses it: *Insufficient input data*. |

## Why the two transform fixtures matter

`irot` and `imir` are applied **by the browser's own decoder**, and the engine's
`applyOrientation` runs only on the WASM lane, which AVIF never takes. So the
risk is not that a rotation is missed — it is that one is applied twice. These
two files are how "the picture came back the shape the container says" is a
measurement instead of an argument: the suite decodes each with libvips and
with the browser, and the two have to agree.

Separately: when sharp is asked for `withMetadata({ orientation: 6 })`, libvips
writes **both** an `Exif` item *and* the equivalent `irot` of 270° into the
AVIF. The orientation is stated twice in one file. That is what
`exifOrientationAvif` in `tests/e2e/fixtures/files.js` is built on, and it is
the case a double rotation would show up in.
