/**
 * Field
 *
 * The wrapper exists so an unassociated label is impossible. The whole
 * component is one assertion repeated: getByLabelText finds the control.
 */
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import Field, { fieldDescribedBy } from '@/components/ui/Field';

describe('Field label association', () => {
    it('associates the label with the control', () => {
        render(
            <Field id="target-width" label="Width in pixels">
                <input id="target-width" />
            </Field>,
        );

        expect(screen.getByLabelText('Width in pixels')).toBe(document.getElementById('target-width'));
    });

    it('associates a visually hidden label just the same', () => {
        render(
            <Field id="quality" label="Quality" labelHidden>
                <input id="quality" />
            </Field>,
        );

        expect(screen.getByLabelText('Quality')).toBeInTheDocument();
        expect(screen.getByText('Quality')).toHaveClass('sr-only');
    });

    it('associates a select and a textarea, not only an input', () => {
        render(
            <>
                <Field id="output-format" label="Output format">
                    <select id="output-format"><option>WebP</option></select>
                </Field>
                <Field id="review-body" label="Your review">
                    <textarea id="review-body" />
                </Field>
            </>,
        );

        expect(screen.getByLabelText('Output format').tagName).toBe('SELECT');
        expect(screen.getByLabelText('Your review').tagName).toBe('TEXTAREA');
    });

    it('renders the suffix beside the control without losing the label', () => {
        render(
            <Field id="target-size" label="Target size" suffix={<span>KB</span>}>
                <input id="target-size" />
            </Field>,
        );

        expect(screen.getByLabelText('Target size')).toBeInTheDocument();
        expect(screen.getByText('KB')).toBeInTheDocument();
    });
});

describe('Field hint and error', () => {
    it('gives the hint a predictable id', () => {
        render(
            <Field id="quality" label="Quality" hint="1 to 100.">
                <input id="quality" aria-describedby={fieldDescribedBy('quality', { hint: '1 to 100.' })} />
            </Field>,
        );

        expect(screen.getByText('1 to 100.')).toHaveAttribute('id', 'quality-hint');
        expect(screen.getByLabelText('Quality')).toHaveAccessibleDescription('1 to 100.');
    });

    it('carries the sr-only "Error: " prefix on the error line', () => {
        render(
            <Field id="quality" label="Quality" error="Quality must be between 1 and 100.">
                <input id="quality" />
            </Field>,
        );

        const error = document.getElementById('quality-error');
        expect(error).toHaveTextContent('Quality must be between 1 and 100.');
        expect(within(error).getByText('Error:', { exact: false, selector: 'span' })).toHaveClass('sr-only');
    });

    it('renders neither line when neither is given', () => {
        render(
            <Field id="quality" label="Quality">
                <input id="quality" />
            </Field>,
        );

        expect(document.getElementById('quality-hint')).toBeNull();
        expect(document.getElementById('quality-error')).toBeNull();
    });
});

describe('fieldDescribedBy', () => {
    it('is undefined when there is nothing to describe', () => {
        expect(fieldDescribedBy('quality')).toBeUndefined();
        expect(fieldDescribedBy('quality', {})).toBeUndefined();
    });

    it('joins hint and error in reading order', () => {
        expect(fieldDescribedBy('quality', { hint: 'x', error: 'y' })).toBe('quality-hint quality-error');
    });

    it('names only the line that exists', () => {
        expect(fieldDescribedBy('quality', { hint: 'x' })).toBe('quality-hint');
        expect(fieldDescribedBy('quality', { error: 'y' })).toBe('quality-error');
    });
});
