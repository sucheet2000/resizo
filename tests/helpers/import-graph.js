/**
 * A tiny import-graph reader for the architecture test.
 *
 * There is no dependency-graph library in this repo and there is not going to
 * be one: the whole point of tests/architecture/boundaries.test.js is that it
 * costs nothing to keep. So this file does the three things that test needs and
 * stops — read a source file, list the modules it imports, and follow those
 * imports until nothing new turns up.
 *
 * WHY IT STRIPS COMMENTS FIRST
 *
 * Half the modules in lib/image-client/ open with a long comment that MENTIONS
 * the imports they deliberately do not make ("@cantoo/pdf-lib is behind an
 * import() inside pdf.js"). A grep for `import ... from '@cantoo/pdf-lib'`
 * matches that prose and reports a violation that does not exist. A test that
 * cries wolf gets deleted, so the scanner below removes comments before it
 * looks for anything — while stepping over strings, template literals and
 * regular expressions, because `split(/[\\/]/)` in lib/image/filename.js
 * contains a slash-slash that a naive stripper reads as the start of a comment.
 *
 * WHY STATIC AND DYNAMIC IMPORTS ARE KEPT APART
 *
 * They are different facts. A static import is downloaded with the module that
 * names it; a dynamic `import()` is a separate chunk fetched on demand. The
 * lazy-dependency rule only makes sense if the two can be told apart, and a
 * cycle only breaks module evaluation if every edge in it is static.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const SOURCE_EXTENSIONS = ['.js', '.mjs'];

/** Repo-relative, forward-slashed, so failure messages read the same on any OS. */
const relative = (absolute) => path.relative(ROOT, absolute).split(path.sep).join('/');

const absolute = (relativePath) => path.join(ROOT, relativePath.split('/').join(path.sep));

/** Every .js/.mjs file under `dir`, repo-relative, sorted for stable output. */
export function listSourceFiles(dir) {
    const start = absolute(dir);
    if (!fs.existsSync(start)) return [];

    const found = [];
    const stack = [start];

    while (stack.length > 0) {
        const current = stack.pop();
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
            const child = path.join(current, entry.name);
            if (entry.isDirectory()) stack.push(child);
            else if (SOURCE_EXTENSIONS.includes(path.extname(entry.name))) found.push(relative(child));
        }
    }

    return found.sort();
}

export const readSource = (relativePath) => fs.readFileSync(absolute(relativePath), 'utf8');

/** Word-ish tokens after which a `/` opens a regular expression, not a division. */
const REGEX_MAY_FOLLOW = new Set([
    'return', 'typeof', 'instanceof', 'in', 'of', 'do', 'else', 'yield',
    'await', 'new', 'delete', 'void', 'throw', 'case',
]);

/**
 * Removes line and block comments, leaving strings, template literals and
 * regular expressions intact.
 */
export function stripComments(source) {
    let out = '';
    let index = 0;
    let previousToken = '';

    const regexAllowed = () =>
        previousToken === '' ||
        REGEX_MAY_FOLLOW.has(previousToken) ||
        '([{,;:=!&|?+-*%~^<>'.includes(previousToken);

    while (index < source.length) {
        const character = source[index];
        const following = source[index + 1];

        if (character === '/' && following === '/') {
            while (index < source.length && source[index] !== '\n') index += 1;
            continue;
        }

        if (character === '/' && following === '*') {
            index += 2;
            while (index < source.length && !(source[index] === '*' && source[index + 1] === '/')) {
                // Newlines are kept so that line-anchored patterns still line up.
                if (source[index] === '\n') out += '\n';
                index += 1;
            }
            index += 2;
            continue;
        }

        if (character === '"' || character === "'" || character === '`') {
            out += character;
            index += 1;
            while (index < source.length) {
                if (source[index] === '\\') {
                    out += source[index] + (source[index + 1] ?? '');
                    index += 2;
                    continue;
                }
                out += source[index];
                index += 1;
                if (source[index - 1] === character) break;
            }
            previousToken = character;
            continue;
        }

        if (character === '/' && regexAllowed()) {
            out += character;
            index += 1;
            let inCharacterClass = false;
            while (index < source.length) {
                const inner = source[index];
                if (inner === '\n') break;
                if (inner === '\\') {
                    out += inner + (source[index + 1] ?? '');
                    index += 2;
                    continue;
                }
                out += inner;
                index += 1;
                if (inner === '[') inCharacterClass = true;
                else if (inner === ']') inCharacterClass = false;
                else if (inner === '/' && !inCharacterClass) break;
            }
            previousToken = '/';
            continue;
        }

        out += character;
        if (/[A-Za-z0-9_$]/.test(character)) {
            previousToken = /[A-Za-z0-9_$]/.test(previousToken.slice(-1)) ? previousToken + character : character;
        } else if (!/\s/.test(character)) {
            previousToken = character;
        }
        index += 1;
    }

    return out;
}

const STATIC_IMPORT = /(?:^|\n)\s*(?:import|export)\b[^;\n]*?\bfrom\s*['"]([^'"]+)['"]/g;
const SIDE_EFFECT_IMPORT = /(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g;
const DYNAMIC_IMPORT = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

const matchAll = (source, pattern) => [...source.matchAll(pattern)].map((match) => match[1]);

/**
 * Reads one module: what it imports statically, what it imports dynamically,
 * and whether it is a React client module.
 *
 * A `'use client'` directive has to be the first statement, but comments may
 * come before it — and several files in lib/ discuss the directive in prose
 * without carrying it, so the check runs on the comment-stripped source.
 */
export function parseModule(relativePath) {
    const code = stripComments(readSource(relativePath));

    return {
        file: relativePath,
        staticImports: [...matchAll(code, STATIC_IMPORT), ...matchAll(code, SIDE_EFFECT_IMPORT)],
        dynamicImports: matchAll(code, DYNAMIC_IMPORT),
        isClientModule: /^\s*['"]use client['"]/.test(code),
    };
}

/**
 * Turns an import specifier into a repo-relative file, or null when it names a
 * package rather than a file in this repo.
 */
export function resolveSpecifier(fromFile, specifier) {
    let target = null;

    if (specifier.startsWith('@/')) target = path.join(ROOT, specifier.slice(2));
    else if (specifier.startsWith('.')) target = path.resolve(path.dirname(absolute(fromFile)), specifier);
    else return null;

    const candidates = [
        target,
        ...SOURCE_EXTENSIONS.map((extension) => target + extension),
        ...SOURCE_EXTENSIONS.map((extension) => path.join(target, `index${extension}`)),
    ];

    const hit = candidates.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
    return hit ? relative(hit) : null;
}

/** True for a bare specifier — a package name, not a file in this repo. */
export const isPackageSpecifier = (specifier) => !specifier.startsWith('.') && !specifier.startsWith('@/');

/**
 * Every module reachable from `entry`, with the shortest import chain that
 * reaches each one. The chain is what makes a failure actionable: "the worker
 * imports React" is a puzzle, "image.worker.js → operations.js → useThing.js →
 * react" is a fix.
 *
 * `edges` picks which imports count: 'static' for the graph a bundler must
 * evaluate eagerly, 'all' to include the on-demand chunks as well.
 */
export function importClosure(entry, { edges = 'all' } = {}) {
    const chains = new Map([[entry, [entry]]]);
    const queue = [entry];

    while (queue.length > 0) {
        const current = queue.shift();
        const parsed = parseModule(current);
        const specifiers =
            edges === 'static'
                ? parsed.staticImports
                : [...parsed.staticImports, ...parsed.dynamicImports];

        for (const specifier of specifiers) {
            const resolved = resolveSpecifier(current, specifier);
            if (!resolved || chains.has(resolved)) continue;
            chains.set(resolved, [...chains.get(current), resolved]);
            queue.push(resolved);
        }
    }

    return chains;
}

/** `a.js → b.js → c.js`, for a failure message a reader can act on. */
export const formatChain = (chain) => chain.join('\n     → ');

/**
 * Static-edge cycles among the given files, each returned as the list of files
 * in the loop. Dynamic edges are excluded on purpose: `import()` inside a
 * function is how a legitimate two-way dependency is broken, not an instance
 * of one.
 */
export function findStaticCycles(files) {
    const graph = new Map(
        files.map((file) => [
            file,
            parseModule(file)
                .staticImports.map((specifier) => resolveSpecifier(file, specifier))
                .filter((target) => target !== null && files.includes(target)),
        ])
    );

    const cycles = [];
    const visited = new Set();
    const stack = [];
    const onStack = new Set();

    const visit = (file) => {
        visited.add(file);
        stack.push(file);
        onStack.add(file);

        for (const next of graph.get(file) ?? []) {
            if (onStack.has(next)) {
                cycles.push([...stack.slice(stack.indexOf(next)), next]);
            } else if (!visited.has(next)) {
                visit(next);
            }
        }

        stack.pop();
        onStack.delete(file);
    };

    for (const file of files) if (!visited.has(file)) visit(file);

    return cycles;
}
