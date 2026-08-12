/**
 * Theme Colours for Non-CSS Consumers
 *
 * `viewport.themeColor` and any generated image asset need literal hex — they
 * cannot read a CSS custom property. These two values mirror `--surface` in
 * app/globals.css and nothing else may hard-code them.
 *
 * tests/design/contract.test.js asserts the two files agree, so a token change
 * in globals.css that is not mirrored here fails the suite.
 */
export const THEME_COLORS = {
    light: '#F8F7F5',
    dark: '#131110',
};
