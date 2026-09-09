#!/usr/bin/env node
/**
 * Benchmark Sample Generator
 *
 * Writes the four committed inputs under benchmarks/samples/ — a synthetic
 * photograph-like scene, a screenshot, a logo-like transparent graphic and a
 * flat illustration. Every one of them is drawn from a seeded PRNG and shapes
 * only, so a rerun on the same machine produces byte-identical files and the
 * numbers in benchmarks/results/ stay attached to inputs anybody can rebuild.
 *
 * The drawing lives in benchmarks/lib/samples.js, which is what
 * tests/lib/benchmarks/samples.test.js holds to that promise. This file is the
 * command around it.
 *
 * sharp is a devDependency and a test tool (CLAUDE.md > Gotchas). It is used
 * here and in benchmarks/ only — never from app/, lib/ or components/.
 *
 * Usage: npm run generate:bench-samples
 */

const { SAMPLES_DIR, writeSamples } = require('../benchmarks/lib/samples');

async function main() {
    const written = await writeSamples(SAMPLES_DIR);

    for (const sample of written) {
        process.stdout.write(
            `${sample.file.padEnd(26)} ${sample.width}×${sample.height}  `
            + `${(sample.bytes / 1024).toFixed(1)} KB\n`,
        );
    }

    process.stdout.write(`\n${written.length} samples written to ${SAMPLES_DIR}\n`);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
