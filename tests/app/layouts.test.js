/**
 * The two route-group layouts carry the site chrome.
 *
 * The footer is where every page names the builder and links the tools, the
 * guides, the about page and the source. tests/components/layout renders
 * SiteFooter on its own, so deleting it from a layout would stay green there;
 * this is the test that reads the layouts and refuses that.
 */
import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const LAYOUTS = ['app/(marketing)/layout.js', 'app/(tools)/layout.js'];

describe.each(LAYOUTS)('%s', (file) => {
    const source = fs.readFileSync(path.join(ROOT, file), 'utf8');

    it('renders the header and the footer around a main landmark', () => {
        expect(source).toMatch(/import SiteHeader from '@\/components\/layout\/SiteHeader'/);
        expect(source).toMatch(/import SiteFooter from '@\/components\/layout\/SiteFooter'/);
        expect(source).toMatch(/<SiteHeader \/>/);
        expect(source).toMatch(/<main[^>]*>\{children\}<\/main>/);
        expect(source).toMatch(/<SiteFooter \/>/);
    });
});
