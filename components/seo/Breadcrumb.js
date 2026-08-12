/**
 * Breadcrumb
 *
 * The visible trail that BreadcrumbList JSON-LD describes. Google will show a
 * breadcrumb rich result from the markup alone, but markup describing a trail
 * that is not on the page is the kind of mismatch that earns a manual action —
 * so both come from the same `items` array.
 *
 * @param {Array<{ name: string, path?: string, href?: string }>} items
 */
import Link from 'next/link';

export default function Breadcrumb({ items, className = '', label = 'Breadcrumb' }) {
    const trail = (Array.isArray(items) ? items : []).filter((item) => item?.name);
    if (trail.length === 0) return null;

    return (
        <nav aria-label={label} className={className}>
            <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-micro text-ink-muted">
                {trail.map((item, index) => {
                    const href = item.path ?? item.href;
                    const isLast = index === trail.length - 1;

                    return (
                        <li key={`${item.name}-${index}`} className="flex items-center gap-2">
                            {index > 0 ? (
                                <span aria-hidden="true" className="font-data text-line">
                                    /
                                </span>
                            ) : null}

                            {isLast || !href ? (
                                <span aria-current={isLast ? 'page' : undefined} className="text-ink">
                                    {item.name}
                                </span>
                            ) : (
                                <Link
                                    href={href}
                                    className="rounded-input underline underline-offset-4 transition-colors duration-120 ease-snap hover:text-ink"
                                >
                                    {item.name}
                                </Link>
                            )}
                        </li>
                    );
                })}
            </ol>
        </nav>
    );
}
