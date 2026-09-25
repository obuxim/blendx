import { defineConfig } from 'blendx';

export default defineConfig({ database: { driver: 'pglite', url: 'memory://' } });
