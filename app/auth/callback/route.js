import { NextResponse } from 'next/server';

export async function GET(request) {
    const requestUrl = new URL(request.url);
    return NextResponse.redirect(new URL('/', requestUrl.origin));
}
