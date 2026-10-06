import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// لوحة التحكم تُنشر تحت مسار فرعي من موقع سعي: saeyiq.web.app/saey-dashboard/
export default defineConfig({
  base: process.env.ADMIN_BASE ?? '/saey-dashboard/',
  plugins: [react()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
});
