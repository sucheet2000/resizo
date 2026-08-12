import SpikeClient from './SpikeClient';

/**
 * PHASE 0 SPIKE — THROWAWAY. Not for merge.
 *
 * Never indexable: this is an internal benchmark harness, not a page. The
 * explicit robots block also stops it inheriting the site-wide `index: true`
 * from app/layout.js, which metadata merges shallowly from.
 */
export const metadata = {
    title: 'Phase 0 device spike',
    description: 'Internal on-device WASM benchmark harness. Not a product page.',
    robots: {
        index: false,
        follow: false,
        googleBot: { index: false, follow: false },
    },
};

export default function SpikePage() {
    return <SpikeClient />;
}
