import Link from 'next/link';

import SignatureTool from './SignatureTool';
import ContentSection from '@/components/content/ContentSection';
import FaqList from '@/components/content/FaqList';
import HowToSteps from '@/components/content/HowToSteps';
import JsonLd from '@/components/seo/JsonLd';
import { buildMetadata } from '@/lib/seo';
import { breadcrumbList, faqPage, howTo, softwareApplication } from '@/lib/schema';

const PATH = '/signature-resizer';

const BREADCRUMB = [
    { name: 'Home', path: '/' },
    { name: 'Signature Resizer', path: PATH },
];

const DESCRIPTION = 'Resize a scanned signature on your own device — nothing is uploaded. Crop away the '
    + 'paper, set the width and height in pixels a form asks for, hold it under a maximum file size in KB, '
    + 'and save it as JPG or PNG.';

export const metadata = buildMetadata({
    title: 'Signature Resizer — Exact Pixel Size and KB Limit | Resizo',
    description: DESCRIPTION,
    path: PATH,
    ogImage: '/og-crop.jpg',
});

/** The direct answer, written to stand on its own away from this page. */
const ANSWER = 'A form that wants a signature usually wants three things at once: the ink and none of the '
    + 'paper around it, a width and height in pixels, and a file no larger than some number of kilobytes. '
    + 'Doing those one tool at a time means the last step keeps undoing the one before it, so Resizo puts '
    + 'all three in a single pass: drop the scan in, narrow the kept area down to the signature, type the '
    + 'size the form states, and name a maximum file size if the form names one. Quality comes down first '
    + 'and the picture is made smaller only when that was not enough, and the line under the result says '
    + 'which of the two happened. The cropper, the resampler and the encoder are code this page hands to '
    + 'your browser, so the scan is read and rewritten on your own machine.';

const LINK = 'rounded-input font-medium text-accent underline underline-offset-4 transition-opacity duration-120 ease-snap hover:opacity-80';

const FAQS = [
    {
        question: 'What size should my signature image be?',
        answer: 'The size the form in front of you states, and nothing else. The chips on this page are '
            + 'labelled Small, Medium, Large and Extra large because they are examples of sizes forms tend '
            + 'to ask for — no size printed here is an official requirement, and a field that wanted 140×60 '
            + 'will refuse a 300×80 file that looked perfectly good. Read the field, type those two numbers '
            + 'into Width (px) and Height (px), and treat any kilobyte ceiling the same way.',
    },
    {
        question: 'Does my signature get uploaded anywhere?',
        answer: 'No. The cropping, scaling and encoding software is loaded into the page, and your scan is '
            + 'read and rewritten by your own device, so it never reaches us and there is nothing for us to '
            + 'hold. The file you download is written from raw pixels, which means it carries no EXIF or GPS '
            + 'data from the scanner or the phone that made it.',
    },
    {
        question: 'Should I save a signature as JPG or PNG?',
        answer: 'PNG first, unless the form says otherwise. Ink on paper is a small number of flat tones, '
            + 'which is the case PNG stores exactly and compactly, so every stroke keeps its edge. JPG '
            + 'approximates, and approximation shows worst against a hard edge — that is the grey haze that '
            + 'creeps around each stroke at low quality. Plenty of fields accept only one of the two, so '
            + 'what the form asks for outranks both.',
    },
    {
        question: 'Will this remove the paper from behind my signature?',
        answer: 'No. This page crops, scales and encodes; it does not lift the ink off its background, erase '
            + 'a shadow or turn a scan into a transparent cut-out. Choosing PNG keeps whatever transparency '
            + 'the file already had, and a photograph of a page has none — the paper comes through as pale '
            + 'pixels. Choosing JPG fills the area behind the signature with the Background you picked, '
            + 'White or Black, because JPG cannot store transparency at all.',
    },
    {
        question: 'My signature came back smaller than the size I asked for. Why?',
        answer: 'Because the maximum file size was reached by shrinking the picture. Quality is lowered '
            + 'first, down to 50, and only when that still misses the number do the width and height start '
            + 'stepping down. The line under the result always says which way it went — either “Dimensions '
            + 'were not changed to meet the size limit” or a sentence naming the size it was shrunk from and '
            + 'the size it landed on. If the form checks the pixels as well as the bytes, crop closer to the '
            + 'ink and run it again.',
    },
    {
        question: 'Can I use a photo of my signature taken on a phone?',
        answer: 'Yes, as long as it is a JPEG, PNG or WebP — those three, up to 20 MB. A scan too large for '
            + 'what this device can hold in memory is refused before it starts, with the reason. An iPhone '
            + 'picture still in HEIC is not one of them and has to be converted first. A flat, evenly lit '
            + 'shot beats an angled one every time: shadow, creases and paper texture are detail the encoder '
            + 'has to pay for out of the same budget as the ink.',
    },
];

const HOW_TO_ID = 'how-to-resize-a-signature';
const HOW_TO_HEADING = 'How to resize a signature for a form';

/** Rendered by HowToSteps and described by howTo() — one array, never two. */
const STEPS = [
    {
        name: 'Type the size the form asks for',
        text: 'Width (px) and Height (px) sit above the drop zone, because both numbers come off the form '
            + 'rather than off the picture. Leave one side empty and it is worked out from the area you '
            + 'keep. The chips under them are examples only.',
    },
    {
        name: 'Choose the scan on your device',
        text: 'Drop a signature scan or photo onto the panel, or press Browse files. JPEG, PNG and WebP, up '
            + 'to 20 MB, read where it already sits — there is no transfer step.',
    },
    {
        name: 'Narrow the Area to keep down to the ink',
        text: 'The whole image is kept to begin with. Set X, Y, Width and Height under Area to keep and the '
            + 'outline over the preview follows you, dimming everything it is about to throw away. Select '
            + 'the whole image puts it back.',
    },
    {
        name: 'Pick the format and the ceiling',
        text: 'Save as gives you JPG or PNG, and Background — White or Black — decides what fills the space '
            + 'behind the ink when JPG cannot be transparent. Type a number into Maximum file size (KB) if '
            + 'the form names one, or leave it empty for no limit.',
    },
    {
        name: 'Press Make signature',
        text: 'If the crop is a different shape than the box you typed, the select of that name decides '
            + 'between fitting inside it, filling it and trimming the edges, or stretching to it. While a '
            + 'ceiling is being searched for the button reads Finding the size.',
    },
    {
        name: 'Read the line under the result, then Download signature',
        text: 'It names the size and the byte count you finished on, the region that was kept, and whether '
            + 'the dimensions had to change to meet the limit. Press Download signature once those figures '
            + 'match what the form asked for.',
    },
];

export default function SignatureResizerPage() {
    return (
        <>
            <JsonLd
                id="signature-resizer-schema"
                data={[
                    softwareApplication({
                        name: 'Resizo Signature Resizer',
                        description: DESCRIPTION,
                        path: PATH,
                        features: [
                            'Crop a scan down to the signature, then size it in one pass',
                            'Exact width and height in pixels, or one side derived from the other',
                            'Fit inside the size, fill and trim, or stretch — fit is the default',
                            'Saves JPG with a white or black background, or PNG with transparency kept',
                            'Holds the file under a maximum size in KB, quality first and pixels second',
                            'Says whether the dimensions were changed to meet that size limit',
                            'Runs on your own device — the signature is never uploaded',
                        ],
                    }),
                    breadcrumbList(BREADCRUMB),
                    howTo({
                        name: HOW_TO_HEADING,
                        description: 'Crop a scanned signature to the ink, size it to the pixels a form '
                            + 'asks for and keep it under a file size limit, on your own device.',
                        path: PATH,
                        anchor: HOW_TO_ID,
                        steps: STEPS,
                    }),
                    faqPage(FAQS),
                ]}
            />

            <SignatureTool
                answer={ANSWER}
                breadcrumb={BREADCRUMB}
            >
                <HowToSteps
                    id={HOW_TO_ID}
                    heading={HOW_TO_HEADING}
                    steps={STEPS}
                    intro={(
                        <p>
                            The settings sit above the drop zone because every one of them is knowable before
                            there is a file: they come off the form you are filling in. The rectangle is the
                            exception and lives in the panel, because a crop means nothing until there is a
                            picture to measure it against.
                        </p>
                    )}
                />

                <ContentSection id="crop-first" heading="Cut the paper away before anything else">
                    <p>
                        A scan of a signature is mostly paper. The strokes might occupy a fifth of the frame,
                        and every other pixel is margin that still has to be stored, still has to be scaled and
                        still spends part of whatever file size limit the form set. Trimming to the ink is
                        usually the single largest saving available on this page, and it costs nothing.
                    </p>
                    <p>
                        It also changes what the size means. The width and height you type are applied to the
                        area you kept, not to the original scan, so margin left inside the selection becomes
                        margin inside the finished box — ask for 300×80 around a generous crop and the
                        signature itself arrives at half that, looking thin and faint in a field sized for it.
                    </p>
                    <p>
                        The whole image is kept when a file lands, so narrowing it is an edit rather than a
                        required step. Set X, Y, Width and Height under Area to keep and the outline moves over
                        the preview, dimming the part that goes; the line above the fields reads back what you
                        have described as Keeping, with the corner it starts from. Select the whole image
                        restores everything if you go too far.{' '}
                        <Link href="/crop" className={LINK}>The cropper</Link> is the better page when the
                        picture is not a signature and you only want a rectangle out of it — it has
                        aspect-ratio chips and no size or byte fields to fill in.
                    </p>
                </ContentSection>

                <ContentSection id="size-and-shape" heading="Width, height, and what happens when the two shapes disagree">
                    <p>
                        Type both numbers when the form gives both. Leave one side empty and it is worked out
                        from the area you kept, which keeps the signature in its own proportions — a 200 px
                        width asked of a 400×120 selection comes back 200×60.
                    </p>
                    <p>
                        A signature is wide and short, and the box a form names rarely shares that shape. That
                        is genuinely ambiguous, so the select labelled If the crop is a different shape asks
                        you rather than guessing:
                    </p>
                    <ul className="flex list-disc flex-col gap-2 pl-5">
                        <li>
                            <strong className="font-semibold text-ink">Fit inside the size (no distortion)</strong>{' '}
                            is the default. The selection is scaled until all of it sits inside the box, so
                            one side can come back smaller than the number you typed. Nothing is cut off and
                            nothing is squashed.
                        </li>
                        <li>
                            <strong className="font-semibold text-ink">Fill the size and trim the edges</strong>{' '}
                            gives you both numbers exactly, and pays for them by scaling until the box is
                            covered and cutting the overflow off the middle. Safe when the crop is close to
                            the right shape already, and expensive when it is not.
                        </li>
                        <li>
                            <strong className="font-semibold text-ink">Stretch to the exact size (distorts)</strong>{' '}
                            resamples straight to the box, so handwriting comes out visibly squashed or drawn
                            out. It exists for a field that checks the dimensions and nothing else, it is
                            never the default, and the result says Stretched to the exact size you chose so
                            nobody discovers it later.
                        </li>
                    </ul>
                    <p>
                        Fitting is also allowed to enlarge, so a small crop is scaled up to reach the box and
                        the strokes soften as it goes. If the result looks woolly, the answer is a bigger scan
                        rather than a different setting. And the neatest way to land on both of the form&rsquo;s
                        numbers is to crop close to the shape it asked for in the first place.{' '}
                        <Link href="/resize" className={LINK}>Resizing an ordinary photo</Link> is a different
                        job with different controls — a percentage, one side, or a full pixel box.
                    </p>
                </ContentSection>

                <ContentSection id="jpg-or-png" heading="PNG keeps the paper as it is; JPG fills it in">
                    <p>
                        Ink on paper is two tones doing nearly all the work, which is the picture PNG is best
                        at: it stores runs of identical colour exactly, so a tightly cropped signature often
                        lands in a couple of kilobytes with every stroke where it was drawn. JPG approximates
                        instead, and approximation is worst against a hard edge — the grey halo around each
                        stroke at low quality is the encoder guessing at an edge it cannot afford to store.
                    </p>
                    <p>
                        So PNG is the better default for this particular kind of picture, and the form still
                        outranks it. Save as offers JPG and PNG because those are the two that signature
                        fields accept; if yours names one, that is the one.
                    </p>
                    <p>
                        Background — White or Black — only applies to JPG, which has no transparency to keep,
                        and the radios grey out the moment PNG is selected. White is the default because a
                        signature is going onto a document. What neither setting does is remove anything: this
                        page will not lift the ink off its background, so a photograph of white paper stays a
                        rectangle of pale pixels whichever format you choose.
                    </p>
                </ContentSection>

                <ContentSection id="under-a-size-limit" heading="When the form also names a number of kilobytes">
                    <p>
                        Maximum file size (KB) is the ceiling, and leaving it empty means no ceiling at all.
                        The box is reached first and the ceiling is spent afterwards, which is the order that
                        matters: the dimensions are what the form checks by eye, so they are the last thing
                        given up.
                    </p>
                    <p>
                        For a JPG, quality comes down first and stops at 50, because below that the blocking
                        and ringing become visible on a document. Only if 50 is still over the line does the
                        picture start shrinking, at four fifths of each side per step, up to eight steps and
                        never below 32 pixels on the short side. A PNG has no quality dial at all — the encoder
                        here is lossless — so a PNG under a tight ceiling goes straight to losing pixels.
                    </p>
                    <p>
                        None of that is silent, and that is the point of the page. The line under the finished
                        picture reads either Dimensions were not changed to meet the size limit, or a sentence
                        naming the size it was shrunk from and the size it ended on. A form that asked for
                        300×80 will not take 240×64, and you cannot see the difference in a preview — being
                        told is the only way to find out before the form does.
                    </p>
                    <p>
                        Ceilings from 10 KB up to 20 MB are accepted, and anything outside that says so under
                        the field. While the search runs the button reads Finding the size, because it is
                        encoding the picture repeatedly and measuring what actually came out rather than
                        estimating.{' '}
                        <Link href="/compress-image-to-20kb" className={LINK}>Compress it to 20 KB</Link> is
                        the page to use when the crop and the pixels are already right and only the number is
                        wrong.
                    </p>
                </ContentSection>

                <ContentSection id="limits" heading="What this page does not do, and what it needs from your device">
                    <p>
                        JPEG, PNG and WebP, up to 20 MB per file; the finished signature can be at most 8000
                        pixels on a side, and a scan too large for what this device can hold in memory is refused
                        before it starts, with the reason. An iPhone picture still in HEIC is not one of those
                        and has to be converted before it can be cropped here —{' '}
                        <Link href="/heic" className={LINK}>turn it into a JPEG first</Link> and then come
                        back.
                    </p>
                    <p>
                        It crops, scales, fills the space behind a JPG and encodes. It does not remove a
                        background, separate ink from paper, clean up a shadow or a crease, sharpen a blurred
                        stroke, or redraw a signature as a vector. If a form wants a clean signature, the
                        cheapest fix by a wide margin is a better scan: black pen, white paper, flat and evenly
                        lit.{' '}
                        <Link href="/remove-image-metadata" className={LINK}>Stripping the metadata</Link> is
                        the separate job to reach for when the picture itself is already right and you only
                        want the camera and scanner fields out of the file.
                    </p>
                    <p>
                        All of it happens on your own device. The scan is opened where it already sits, the
                        rectangle is cut, the pixels are resampled and the new file is written on the same
                        machine, so nothing is transmitted and no copy of your signature exists anywhere else.
                        Because the output is built from raw pixels it carries no EXIF or GPS data either.
                    </p>
                    <p>
                        The one limit that belongs to you rather than to us is memory. A picture has to be
                        unpacked into raw pixels before any of this can happen, which takes several times the
                        file size, and a byte ceiling means encoding it several times over — so the panel costs
                        the job before it starts and refuses it with a reason rather than letting the tab die
                        holding your only scan.
                    </p>
                </ContentSection>

                <FaqList items={FAQS} id="signature-resizer-faq" />
            </SignatureTool>
        </>
    );
}
