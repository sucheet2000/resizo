import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { transformWithOxc } from 'vite';
import { defineConfig } from 'vitest/config';

const root = path.dirname(fileURLToPath(import.meta.url));

const NODE_TESTS = [
    'tests/lib/**/*.test.js',
    'tests/api/**/*.test.js',
    'tests/app/**/*.test.js',
    'tests/architecture/**/*.test.js',
    'tests/design/**/*.test.js',
];

/**
 * Every component and page in this repo is a `.js` file containing JSX, which
 * is what Next's SWC pipeline accepts. Vite decides the parser language from
 * the extension and turns JSX off for `.js`, so without this the component
 * suite cannot parse a single import. Runs `pre` so the file reaching Vite's
 * own transform is already plain JavaScript.
 */
const JSX_DIRS = ['app', 'components', 'tests'].map((dir) => path.join(root, dir) + path.sep);

function jsxInJs() {
    return {
        name: 'resizo:jsx-in-js',
        enforce: 'pre',
        async transform(code, id) {
            const file = id.split('?')[0];
            if (!file.endsWith('.js')) return null;
            if (!JSX_DIRS.some((dir) => file.startsWith(dir))) return null;

            const result = await transformWithOxc(code, file, {
                lang: 'jsx',
                jsx: { runtime: 'automatic', importSource: 'react' },
            });

            return { code: result.code, map: result.map };
        },
    };
}

export default defineConfig({
    plugins: [jsxInJs()],
    resolve: {
        alias: {
            '@': root,
        },
    },
    test: {
        coverage: {
            provider: 'v8',
            reporter: ['text', 'lcov'],
            include: ['lib/**/*.js', 'app/api/**/*.js', 'components/**/*.js'],
            exclude: [
                // Test fixtures are not product code.
                'tests/**',
            ],
            thresholds: {
                lines: 90,
                functions: 90,
                branches: 85,
            },
        },
        projects: [
            {
                extends: true,
                test: {
                    name: 'node',
                    environment: 'node',
                    globals: false,
                    include: NODE_TESTS,
                    exclude: ['node_modules/**', '.next/**'],
                    clearMocks: true,
                    restoreMocks: true,
                },
            },
            {
                extends: true,
                test: {
                    name: 'components',
                    environment: 'jsdom',
                    globals: false,
                    // tests/pages/ renders whole page trees to static markup and
                    // snapshots what a crawler would read — it needs the DOM parser.
                    include: ['tests/components/**/*.test.jsx', 'tests/pages/**/*.test.jsx'],
                    exclude: ['node_modules/**', '.next/**'],
                    setupFiles: ['tests/components/setup.js'],
                    clearMocks: true,
                    restoreMocks: true,
                },
            },
        ],
    },
});
