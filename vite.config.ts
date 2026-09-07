import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages serves a project site from /<repo>/, not from the domain root,
// so every asset link has to carry that prefix or it resolves to a 404 on
// aladdinbiyabangerd.github.io. Nothing else in the app hardcodes a path; use
// import.meta.env.BASE_URL if anything ever needs to.
export default defineConfig({
  base: '/spendly/',
  plugins: [react()],
})
