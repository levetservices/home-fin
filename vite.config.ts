/// <reference types="vitest" />
/// <reference types="vite/client" />
import { defineConfig } from 'vite';

export default defineConfig({
    test: {
        coverage: {
            include: [ 'src' ]
        },
        environment: 'jsdom',
        // homefin/accounts is a separate Node service with its own node:test suite (npm test there).
        exclude: [ '**/node_modules/**', '**/dist/**', 'homefin/**' ],
        restoreMocks: true
    }
});
