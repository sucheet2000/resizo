# Committed E2E assets

Every other E2E fixture is generated at run time with sharp (see `../files.js`). The two
files here are the exception, and this note is their provenance.

## `sample-96x64.heic` and `sample-96x64.png`

A 96×64 scene of four flat colour quadrants and one pale diagonal band — no text, no fonts,
no photograph, nothing licensed from anyone. `sample-96x64.png` is the source, drawn from an
SVG by sharp. `sample-96x64.heic` is that PNG encoded once, on macOS 26 with Apple's `sips`
(build 316), which writes HEVC-in-HEIF (`ftyp` brand `heic`):

```
sips -s format heic -s formatOptions 90 sample-96x64.png --out sample-96x64.heic
```

It is committed rather than generated because no encoder in the repository's dependencies
writes HEVC: sharp's libvips is built with AV1 (aom) but not HEVC, so it can neither create
this file nor read it back. The E2E flow therefore proves the HEIC path from the other side —
the converted output is decoded with sharp and compared pixel-for-pixel, within a lossy
tolerance, against `sample-96x64.png`, the image the HEIC was made from. CI only consumes the
committed file and needs no HEVC encoder.

Regenerate only on a Mac, only on purpose, and commit both files together.
