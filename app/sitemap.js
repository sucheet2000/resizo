export default function sitemap() {
    return [
        {
            url: 'https://www.resizo.net',
            lastModified: new Date(),
            changeFrequency: 'weekly',
            priority: 1.0,
        },
        {
            url: 'https://www.resizo.net/about',
            lastModified: new Date(),
            changeFrequency: 'monthly',
            priority: 0.8,
        },
    ];
}
