/**
 * /about — what the site says about itself, rendered.
 *
 * The one page that describes the project rather than a tool, so it carries
 * the two claims most likely to go stale: who builds it and what is promised.
 * Both are pinned here in their durable form — every core tool free to use,
 * with no account, no watermark and no daily quota — and neither may promise
 * that the project can never be commercial.
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import AboutPage, { metadata } from '@/app/(marketing)/about/page';
import { pageFacts } from './helpers/page-facts';

describe('/about', () => {
    const facts = pageFacts(renderToStaticMarkup(createElement(AboutPage)), metadata);
    const text = facts.paragraphs.join(' ');

    it('canonicalises to itself', () => {
        expect(facts.metadata.alternates.canonical).toBe('https://www.resizo.net/about');
    });

    it('states the durable promise rather than permanent non-commercial status', () => {
        expect(text).toMatch(/every core Resizo tool is free to use/i);
        expect(text).toMatch(/no account, no watermark and no daily quota/i);
        expect(text).not.toMatch(/non-commercial|noncommercial|no paid tier|free forever|always free/i);
        expect(facts.metadata.description).not.toMatch(/non-commercial/i);
    });

    it('keeps the no-upload promise', () => {
        expect(text).toMatch(/nothing is uploaded/i);
        expect(facts.metadata.description).toMatch(/nothing is uploaded/i);
    });

    it('introduces no sales language', () => {
        expect(text).not.toMatch(/upgrade|pricing|premium|subscribe|buy now/i);
    });
});
