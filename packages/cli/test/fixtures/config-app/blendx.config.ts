import { defineConfig } from '@blendx/core';

export default defineConfig({
  schema: './db/schema.dbml',
  database: { driver: 'pglite', url: 'memory://' },
  openapi: { title: 'Addition API', version: '1.0.0' },
});
