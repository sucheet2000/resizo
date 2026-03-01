export default function robots() {
    return {
        rules: [
            {
                userAgent: '*',
                allow: ['/', '/about', '/privacy', '/terms'],
                disallow: ['/api/', '/dashboard', '/auth/'],
            },
        ],
        sitemap: 'https://www.resizo.net/sitemap.xml',
    };
}
