import { NextResponse } from 'next/server';
import { createServerClient } from '../../../../../../lib/supabase-server';

export const maxDuration = 30;

export async function GET() {
    try {
        const supabase = await createServerClient();

        // Verify the requester is authenticated
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
        }

        // Fetch all resize history rows for this user
        const { data, error: fetchError } = await supabase
            .from('resize_history')
            .select('created_at, original_filename, original_width, original_height, resized_width, resized_height, output_format, original_size_bytes, resized_size_bytes')
            .eq('user_id', user.id)
            .order('created_at', { ascending: false });

        if (fetchError) {
            console.error('Export fetch error:', fetchError);
            return NextResponse.json({ error: 'Failed to fetch your data.' }, { status: 500 });
        }

        // Build CSV
        const headers = [
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

        const escape = (val) => {
            if (val === null || val === undefined) return '';
            const s = String(val);
            // Wrap in quotes if it contains commas, quotes, or newlines
            if (s.includes(',') || s.includes('"') || s.includes('\n')) {
                return `"${s.replace(/"/g, '""')}"`;
            }
            return s;
        };

        const rows = (data || []).map((row) => [
            escape(row.created_at ? new Date(row.created_at).toISOString() : ''),
            escape(row.original_filename),
            escape(row.original_width),
            escape(row.original_height),
            escape(row.resized_width),
            escape(row.resized_height),
            escape(row.output_format),
            escape(row.original_size_bytes),
            escape(row.resized_size_bytes),
        ].join(','));

        const csv = [headers.join(','), ...rows].join('\r\n');

        return new NextResponse(csv, {
            status: 200,
            headers: {
                'Content-Type': 'text/csv',
                'Content-Disposition': 'attachment; filename="resizo-my-data.csv"',
            },
        });

    } catch (error) {
        console.error('Export error:', error);
        return NextResponse.json({ error: 'An internal server error occurred.' }, { status: 500 });
    }
}
