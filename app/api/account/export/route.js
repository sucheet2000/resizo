import { buildCsv } from '@/lib/csv';
import { enforceRateLimit } from '@/lib/http/rate-limit';
import { binaryResponse, jsonError } from '@/lib/http/responses';
import { createServerClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const maxDuration = 30;

const HISTORY_COLUMNS = 'created_at, original_filename, original_width, original_height, resized_width, resized_height, output_format, original_size_bytes, resized_size_bytes';

const HISTORY_HEADER = [
    'Date',
    'Filename',
    'Original Width',
    'Original Height',
    'Resized Width',
    'Resized Height',
    'Format',
    'Original Size (bytes)',
    'Resized Size (bytes)',
];

const REVIEWS_HEADER = ['Date', 'Name', 'Role', 'Rating', 'Review'];

function isoDate(value) {
    return value ? new Date(value).toISOString() : '';
}

export async function GET(request) {
    try {
        const limited = await enforceRateLimit(request, 'account');
        if (limited) return limited;

        const supabase = await createServerClient();

        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) {
            return jsonError('Unauthorized.', 401);
        }

        const { data: history, error: historyError } = await supabase
            .from('resize_history')
            .select(HISTORY_COLUMNS)
            .eq('user_id', user.id)
            .order('created_at', { ascending: false });

        if (historyError) {
            console.error('[api:account/export] history fetch failed:', historyError);
            return jsonError('Failed to fetch your data.', 500);
        }

        // Reviews are personal data too, but the user_id column ships in
        // supabase/migrations/0001_add_user_id_to_reviews.sql and may not exist
        // everywhere yet — a failure drops the section rather than the export.
        const { data: reviews, error: reviewsError } = await supabase
            .from('reviews')
            .select('created_at, name, role, rating, review')
            .eq('user_id', user.id)
            .order('created_at', { ascending: false });

        if (reviewsError) {
            console.warn('[api:account/export] review section skipped:', reviewsError.message);
        }

        const rows = [
            ['Resize History'],
            HISTORY_HEADER,
            ...(history ?? []).map((row) => [
                isoDate(row.created_at),
                row.original_filename,
                row.original_width,
                row.original_height,
                row.resized_width,
                row.resized_height,
                row.output_format,
                row.original_size_bytes,
                row.resized_size_bytes,
            ]),
        ];

        if (!reviewsError) {
            rows.push([], ['Reviews'], REVIEWS_HEADER);
            for (const row of reviews ?? []) {
                rows.push([isoDate(row.created_at), row.name, row.role, row.rating, row.review]);
            }
        }

        const response = binaryResponse(buildCsv(rows), {
            contentType: 'text/csv; charset=utf-8',
            filename: 'resizo-my-data.csv',
        });
        response.headers.set('Cache-Control', 'no-store, private');

        return response;
    } catch (error) {
        console.error('[api:account/export]', error);
        return jsonError('An internal server error occurred.', 500);
    }
}
