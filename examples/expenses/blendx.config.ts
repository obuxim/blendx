import { defineConfig } from 'blendx';

export default defineConfig({
  // PostgreSQL when DATABASE_URL is set; otherwise PGlite in ./.data, so it runs anywhere.
  database: process.env.DATABASE_URL ? { driver: 'pg' } : { driver: 'pglite', url: './.data' },
  openapi: { title: 'Expenses API', version: '1.0.0' },
});
