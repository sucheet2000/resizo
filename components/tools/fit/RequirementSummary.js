'use client';

/**
 * RequirementSummary
 *
 * The answer to the question a visitor actually came with: did the file I
 * just made meet the requirement? Every row comes off the RESULT's own
 * `checks` array (lib/image-client/requirements.js validateOutput), never off
 * the live form — the /crop lesson that a panel reading live settings can end
 * up describing a file that no longer exists.
 *
 * Shared by /passport-photo (moved here from its own directory) and
 * /image-size-fitter — the fit op's `validateOutput` shape is the same
 * either way, and only /passport-photo ever supplies a `preset`.
 *
 * THE STATUS IS WORDS, NEVER COLOUR ALONE.
 *
 * DESIGN.md allows exactly one accent colour on this whole site, so there was
 * never a red/green pair available to lean on here even before accessibility
 * came into it. "Meets" / "Fails" / "Not required" is read the same way by
 * everyone, sighted or not; the accent on "Fails" reuses the colour an inline
 * error already carries elsewhere on the page rather than introducing a new
 * semantic colour.
 *
 * "Not required" is its own state, not a blank cell. A check the requirement
 * never asked for (no byte ceiling was set, no DPI was requested) still gets
 * a row, because a visitor scanning the list for "did DPI get checked?"
 * deserves an answer instead of a gap that looks like an oversight.
 *
 * Below the checks: the preset's own list of photographic rules Resizo has no
 * way to evaluate — pose, expression, lighting, recency — so a row of "Meets"
 * above is never mistaken for "accepted by the authority". That list and the
 * source link only render for a verified preset; a custom job has no
 * authority to cite and claims none.
 */

function formatVerifiedDate(iso) {
    if (typeof iso !== 'string' || iso.trim() === '') return null;
    const date = new Date(`${iso}T00:00:00Z`);
    if (Number.isNaN(date.getTime())) return null;
    return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        timeZone: 'UTC',
    });
}

function statusText(ok) {
    if (ok === true) return 'Meets';
    if (ok === false) return 'Fails';
    return 'Not required';
}

/** Colour is decoration here, not the signal — see the file note above. */
function statusClassName(ok) {
    if (ok === true) return 'text-ink';
    if (ok === false) return 'text-accent';
    return 'text-ink-muted';
}

const LINK = 'font-medium text-accent underline underline-offset-4 transition-[text-decoration-thickness] duration-120 ease-snap hover:decoration-2';

export default function RequirementSummary({ checks, preset, className = '' }) {
    const list = (Array.isArray(checks) ? checks : []).filter((check) => check?.key && check?.label);
    if (list.length === 0) return null;

    const applicable = list.filter((check) => check.ok !== null && check.ok !== undefined);
    const met = applicable.filter((check) => check.ok === true).length;

    const cannotVerify = Array.isArray(preset?.cannotVerify) ? preset.cannotVerify.filter(Boolean) : [];
    const verifiedDate = formatVerifiedDate(preset?.source?.verifiedAt);

    return (
        <div className={`flex flex-col gap-5 ${className}`.trim()}>
            <div>
                <h3 className="text-ui font-medium text-ink">
                    What was checked
                    {applicable.length > 0 ? ' ' : null}
                    {applicable.length > 0 ? (
                        <span className="ml-2 font-data text-micro font-normal text-ink-muted">
                            {met} of {applicable.length} met
                        </span>
                    ) : null}
                </h3>

                <dl className="mt-2 flex flex-col border-t border-line">
                    {list.map((check) => (
                        <div
                            key={check.key}
                            className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 border-b border-line py-2"
                        >
                            <dt className="text-ui text-ink">{check.label}</dt>
                            <dd className="flex flex-wrap items-baseline gap-x-3 text-ui">
                                <span className="font-data text-ink-muted">
                                    <span className="sr-only">required </span>
                                    {String(check.required)}
                                </span>
                                <span className="font-data text-ink">
                                    <span className="sr-only">actual </span>
                                    {String(check.actual)}
                                </span>
                                <span className={`font-medium ${statusClassName(check.ok)}`.trim()}>
                                    {statusText(check.ok)}
                                </span>
                            </dd>
                        </div>
                    ))}
                </dl>
            </div>

            {cannotVerify.length > 0 ? (
                <div>
                    <h3 className="text-ui font-medium text-ink">
                        Photographic requirements not checked by Resizo
                    </h3>
                    <ul className="mt-2 flex list-disc flex-col gap-1 pl-5 text-ui text-ink-muted">
                        {cannotVerify.map((item) => <li key={item}>{item}</li>)}
                    </ul>
                </div>
            ) : null}

            {preset?.source?.url ? (
                <p className="text-micro text-ink-muted">
                    {`${preset.name ?? preset.jurisdiction ?? 'This requirement'} is stated by `}
                    <a href={preset.source.url} rel="noopener" className={LINK}>
                        {preset.source.label ?? preset.source.url}
                    </a>
                    {verifiedDate ? `, verified ${verifiedDate}.` : '.'}
                </p>
            ) : null}
        </div>
    );
}
