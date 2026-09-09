/**
 * ARCHITECTURE BOUNDARY ENFORCEMENT
 *
 * Every rule below was a real, measured problem in this repo before it was a
 * test. Each one also regresses by somebody doing something entirely
 * reasonable — importing a helper, reading a tool's title, reaching for a zip
 * library — which is why prose does not hold them. tests/design/contract.test.js
 * already proved the point on the design side: it caught an agent writing the
 * banned phrase "in your browser" during a real task, months after DESIGN.md
 * said not to.
 *
 * The six rules, and what each one cost when it was broken:
 *
 *  1. THE WORKER'S GRAPH IS REACT-FREE. lib/image-client/image.worker.js runs
 *     on a thread with no DOM. React reaching it means a second copy of React
 *     in a chunk that can never render anything. Before today the guarantee
 *     rested on naming: two pure helpers sat in lib/hooks/ beside four
 *     'use client' files, one useState away from pulling React across.
 *
 *  2. lib/ NEVER IMPORTS FROM app/ OR components/. lib is the bottom layer.
 *     An edge upward makes the engine untestable without a React renderer and
 *     turns every page into a dependency of every tool.
 *
 *  3. THE ENGINE DOES NOT READ THE SITE CATALOGUE. lib/limits.js is numbers the
 *     codecs enforce; lib/catalog/ is page copy. They were one file with a
 *     fan-in of 38, so editing a tool's description touched a module the image
 *     engine imports — and the worker downloaded marketing prose. This regrows
 *     the first time somebody wants a tool's title inside an error message.
 *
 *  4. HEAVY DEPENDENCIES STAY BEHIND import(). A single top-level
 *     `import JSZip from 'jszip'` in lib/upload/bulk-batch.js put 153 KB of
 *     archiver into the first load of /resize, /resize-jpg and /resize-png —
 *     the three highest-traffic routes on the site — paid by everyone who
 *     resizes one image and never opens the bulk tab.
 *
 *  5. NO STATIC CYCLES IN lib/. A cycle among eagerly-evaluated modules means
 *     one of them sees `undefined` where it expects a function, and which one
 *     depends on entry order.
 *
 *  6. CLIENT MODULES NEVER REACH THE CATALOGUE BARREL. lib/catalog/index.js
 *     re-exports the whole registry, the copy of every intent page included.
 *     app/error.js and RelatedTools importing one array from it put 76 KB raw
 *     of page copy into the first load of every route. Client code reads the
 *     leaf it needs; the barrel is for server components.
 *
 * Adding a file to an exception list is not how any of these is satisfied —
 * there are no exception lists. If a rule is genuinely wrong, delete the rule
 * and say why in CLAUDE.md.
 */
import { describe, expect, it } from 'vitest';

import {
    findStaticCycles,
    formatChain,
    importClosure,
    isPackageSpecifier,
    listSourceFiles,
    parseModule,
    resolveSpecifier,
} from '@/tests/helpers/import-graph';

const LIB_FILES = listSourceFiles('lib');
const ENGINE_FILES = LIB_FILES.filter((file) => file.startsWith('lib/image-client/'));
const WORKER = 'lib/image-client/image.worker.js';
const CATALOG = 'lib/catalog/';

/* ------------------------------------------------------------------ *
 * The graph reader is load-bearing — prove it read something first.
 * ------------------------------------------------------------------ */

describe('the import reader itself', () => {
    it('sees the modules it is supposed to see', () => {
        // Without this, a broken parser makes every rule below pass vacuously:
        // an empty graph violates nothing.
        expect(LIB_FILES.length).toBeGreaterThan(20);
        expect(LIB_FILES).toContain(WORKER);

        const worker = parseModule(WORKER);
        expect(worker.staticImports).toContain('@/lib/image-client/operations');

        const closure = importClosure(WORKER);
        for (const expected of [
            'lib/image-client/operations.js',
            'lib/image-client/encode.js',
            'lib/image-client/decode.js',
            'lib/image-client/resize.js',
            'lib/limits.js',
        ]) {
            expect([...closure.keys()]).toContain(expected);
        }
    });

    it('does not mistake prose about an import for an import', () => {
        // lib/image-client/pdf.js explains in a comment that @cantoo/pdf-lib is
        // loaded with import(). A reader that counts comments reports a
        // violation that is not there, and a test that cries wolf gets deleted.
        const pdf = parseModule('lib/image-client/pdf.js');
        expect(pdf.staticImports).not.toContain('@cantoo/pdf-lib');
        expect(pdf.dynamicImports).toContain('@cantoo/pdf-lib');

        // lib/format/upload-helpers.js discusses 'use client' without carrying
        // the directive; lib/image-client/client.js carries it.
        expect(parseModule('lib/format/upload-helpers.js').isClientModule).toBe(false);
        expect(parseModule('lib/image-client/client.js').isClientModule).toBe(true);
    });
});

/* ------------------------------------------------------------------ *
 * 1. React never reaches the worker
 * ------------------------------------------------------------------ */

describe('the worker graph is React-free', () => {
    const closure = importClosure(WORKER);
    const reached = [...closure.keys()];

    it.each(reached)('%s pulls in no React', (file) => {
        const { staticImports, dynamicImports } = parseModule(file);
        const react = [...staticImports, ...dynamicImports].filter(
            (specifier) => specifier === 'react' || specifier === 'react-dom' || specifier.startsWith('react-dom/')
        );

        expect(
            react,
            `${file} imports ${react.join(', ')}, and the image worker reaches it:\n\n` +
                `     ${formatChain(closure.get(file))}\n\n` +
                'The worker runs on a thread with no DOM. React in its graph is a second\n' +
                'copy of React in a chunk that can never render anything — pure weight on\n' +
                'every tool page. Move the part the worker needs into a module with no\n' +
                'hooks (lib/format/ exists for exactly this) and leave the hook behind.'
        ).toEqual([]);
    });

    it.each(reached)('%s is not a client component', (file) => {
        expect(
            parseModule(file).isClientModule,
            `${file} carries 'use client', and the image worker reaches it:\n\n` +
                `     ${formatChain(closure.get(file))}\n\n` +
                "A 'use client' module is a React module by declaration — the directive is\n" +
                'the marker a bundler uses to ship it with the React runtime. Nothing in\n' +
                'the worker graph may carry it. Split the pure part out.'
        ).toBe(false);
    });
});

/* ------------------------------------------------------------------ *
 * 2. lib/ is the bottom layer
 * ------------------------------------------------------------------ */

describe('lib/ never imports upward', () => {
    it.each(LIB_FILES)('%s imports nothing from app/ or components/', (file) => {
        const { staticImports, dynamicImports } = parseModule(file);
        const upward = [...staticImports, ...dynamicImports].filter((specifier) => {
            const resolved = resolveSpecifier(file, specifier);
            return resolved !== null && (resolved.startsWith('app/') || resolved.startsWith('components/'));
        });

        expect(
            upward,
            `${file} imports ${upward.join(', ')} from an upper layer.\n\n` +
                'lib/ is the bottom of the stack: pages and components import it, never the\n' +
                'other way round. An edge upward means the image engine cannot be tested\n' +
                'without a React renderer, and every page becomes a dependency of every\n' +
                'tool. Move the shared thing down into lib/, or pass it in as an argument.'
        ).toEqual([]);
    });
});

/* ------------------------------------------------------------------ *
 * 3. The engine does not read the site catalogue
 * ------------------------------------------------------------------ */

describe('the engine and the site catalogue stay apart', () => {
    it.each(ENGINE_FILES)('%s does not reach lib/catalog/', (file) => {
        const closure = importClosure(file);
        const reached = [...closure.keys()].filter((module) => module.startsWith(CATALOG));

        expect(
            reached,
            `${file} reaches ${reached.join(', ')}:\n\n` +
                `     ${reached.length > 0 ? formatChain(closure.get(reached[0])) : ''}\n\n` +
                'lib/catalog/ is page copy — tool titles, descriptions, intent routes.\n' +
                'lib/limits.js is the numbers the codecs enforce. They were one file once,\n' +
                'which is why editing a marketing sentence touched a module the image\n' +
                'worker downloads. The engine reads lib/limits.js. If the engine appears to\n' +
                'need a title or a description, it does not — the caller does. Return a code\n' +
                'and let the page turn it into words.'
        ).toEqual([]);
    });
});

/* ------------------------------------------------------------------ *
 * 4. Heavy dependencies stay lazy
 * ------------------------------------------------------------------ */

describe('heavy dependencies stay behind import()', () => {
    const HEAVY = [
        { match: (specifier) => specifier === 'jszip' || specifier.startsWith('jszip/'), name: 'jszip', cost: '153 KB, and only the bulk tab needs it' },
        { match: (specifier) => specifier.startsWith('@cantoo/pdf-lib'), name: '@cantoo/pdf-lib', cost: 'only /jpg-to-pdf and /merge-pdf need it' },
        { match: (specifier) => specifier.startsWith('@jsquash/'), name: 'a @jsquash codec', cost: 'a WASM binary per format, loaded per job' },
        { match: (specifier) => specifier.startsWith('libheif-js'), name: 'libheif-js', cost: 'the largest binary on the site, and only /heic needs it' },
    ];

    it.each(LIB_FILES)('%s loads heavy packages lazily or not at all', (file) => {
        const { staticImports } = parseModule(file);
        const offences = staticImports
            .filter(isPackageSpecifier)
            .flatMap((specifier) => {
                const heavy = HEAVY.find((candidate) => candidate.match(specifier));
                return heavy ? [`${specifier} (${heavy.name}: ${heavy.cost})`] : [];
            });

        expect(
            offences,
            `${file} imports ${offences.join(', ')} at the top level.\n\n` +
                'A static import is downloaded with the module that names it. This exact\n' +
                'mistake — `import JSZip from "jszip"` in lib/upload/bulk-batch.js — put\n' +
                '153 KB of archiver into the FIRST LOAD of /resize, /resize-jpg and\n' +
                '/resize-png, the three busiest routes on the site, paid by every visitor\n' +
                'who resizes one image and never opens the bulk tab. Use a memoised\n' +
                '`await import(...)` at the point of use, the way lib/image-client/codecs.js\n' +
                'and lib/image-client/pdf.js already do.'
        ).toEqual([]);
    });

    it('the modules that need them still reach them dynamically', () => {
        // The rule above is satisfiable by deleting the feature. This is the
        // other half: the lazy path must actually exist.
        expect(parseModule('lib/upload/bulk-batch.js').dynamicImports).toContain('jszip');
        expect(parseModule('lib/image-client/pdf.js').dynamicImports).toContain('@cantoo/pdf-lib');
        expect(parseModule('lib/image-client/codecs.js').dynamicImports.some((specifier) => specifier.startsWith('@jsquash/'))).toBe(true);
    });
});

/* ------------------------------------------------------------------ *
 * 6. Client code imports catalogue leaves, never the barrel
 * ------------------------------------------------------------------ */

/**
 * lib/catalog/index.js re-exports everything, including the ten intent
 * entries — the full copy of ten pages. A 'use client' module that imports
 * the barrel for one array drags all of it into a client chunk, and
 * app/error.js is loaded on every route: measured, importing TOOLS from the
 * barrel put 76 KB raw / 19 KB brotli of page copy into the first load of
 * every page on the site, /about included. Client modules read the leaf they
 * need (tools.js, presets.js, categories.js); the barrel is for server code.
 */
describe('client modules never reach the catalogue barrel or the intent copy', () => {
    const CLIENT_FILES = [...listSourceFiles('app'), ...listSourceFiles('components'), ...listSourceFiles('lib')]
        .filter((file) => parseModule(file).isClientModule);

    it('found the client modules', () => {
        expect(CLIENT_FILES.length).toBeGreaterThan(5);
        expect(CLIENT_FILES).toContain('app/error.js');
    });

    it.each(CLIENT_FILES)('%s reaches no page copy', (file) => {
        const closure = importClosure(file, { edges: 'static' });
        const reached = [...closure.keys()].filter(
            (module) => module === 'lib/catalog/index.js'
                || module.startsWith('lib/catalog/intents/')
                || module.startsWith('lib/catalog/guides/'),
        );

        expect(
            reached,
            `${file} reaches ${reached.join(', ')}:\n\n` +
                `     ${reached.length > 0 ? formatChain(closure.get(reached[0])) : ''}\n\n` +
                'The catalogue barrel carries the copy of every intent page. A client\n' +
                'module that imports it ships that copy to the browser on every route\n' +
                'that loads the module. Import the leaf you need — @/lib/catalog/tools,\n' +
                '@/lib/catalog/presets or @/lib/catalog/categories — and leave the barrel\n' +
                'to server components.'
        ).toEqual([]);
    });
});

/* ------------------------------------------------------------------ *
 * 5. No static cycles
 * ------------------------------------------------------------------ */

describe('lib/ has no import cycles', () => {
    it('no module in lib/ eventually imports itself', () => {
        const cycles = findStaticCycles(LIB_FILES).map(formatChain);

        expect(
            cycles,
            `these modules import each other in a loop:\n\n     ${cycles.join('\n\n     ')}\n\n` +
                'Every edge in the loop is a STATIC import, so the bundler has to evaluate\n' +
                'one of these modules before its own dependency is ready: whichever loses\n' +
                'the race sees `undefined` where it expects a function, and which one loses\n' +
                'depends on which page was entered first. Break the loop by moving the\n' +
                'shared value into a module both sides import, not by making one edge\n' +
                'dynamic to hide it.'
        ).toEqual([]);
    });
});
