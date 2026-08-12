import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
    resolve: {
        alias: {
            '@': root,
        },
    },
    test: {
        environment: 'node',
        globals: false,
        include: ['tests/**/*.test.js'],
        exclude: ['node_modules/**', '.next/**'],
        clearMocks: true,
        restoreMocks: true,
        coverage: {
            provider: 'v8',
            reporter: ['text', 'lcov'],
            include: ['lib/**/*.js', 'app/api/**/*.js', 'app/auth/**/*.js'],
            // The Supabase factories are replaced wholesale in every test that
            // touches them, so they are never executed and would only report a
            // misleading zero. Everything else, including the sharp, Upstash and
            // next/server modules, is exercised by tests/api.
            exclude: [
                'lib/supabase/**',
                'lib/supabase.js',
                'lib/supabase-server.js',
            ],
            thresholds: {
                lines: 90,
                functions: 90,
                branches: 85,
            },
        },
    },
});
