/**
 * jsdom setup for the component + hook suite.
 *
 * Four jobs, and nothing else belongs here:
 *
 *  1. wire @testing-library/jest-dom's matchers into vitest's `expect`
 *  2. unmount every tree between tests (the suite runs with `globals: false`,
 *     so Testing Library's own auto-cleanup hook never registers itself)
 *  3. give jsdom the object-URL API it does not implement — the upload and
 *     download paths both live on `URL.createObjectURL`, and a spy cannot be
 *     attached to a method that is not there
 *  4. give jsdom an `offsetParent`. jsdom performs no layout, so the real one
 *     is `null` for every element on the page; Modal's focus trap uses it to
 *     skip hidden controls and would otherwise conclude that a dialog full of
 *     buttons contains nothing focusable. The replacement answers the one
 *     question the trap asks — "is this element displayed?" — and keeps
 *     `display: none` subtrees excluded, which is the behaviour under test.
 */
import '@testing-library/jest-dom/vitest';

import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach } from 'vitest';

let objectUrlSequence = 0;

beforeEach(() => {
    objectUrlSequence = 0;
    URL.createObjectURL = function createObjectURL() {
        objectUrlSequence += 1;
        return `blob:http://localhost:3000/resizo-${objectUrlSequence}`;
    };
    URL.revokeObjectURL = function revokeObjectURL() {};
});

Object.defineProperty(window.HTMLElement.prototype, 'offsetParent', {
    configurable: true,
    get() {
        if (!this.isConnected || this === document.body) return null;

        for (let node = this; node instanceof window.HTMLElement; node = node.parentElement) {
            if (window.getComputedStyle(node).display === 'none') return null;
        }

        return document.body;
    },
});

afterEach(() => {
    cleanup();
});
