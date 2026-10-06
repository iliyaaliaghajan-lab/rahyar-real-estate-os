import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#effaf8', 100: '#d6f3ee', 200: '#aee6dc', 500: '#14907f',
          600: '#0f766e', 700: '#0d5f59', 900: '#0a3d3a',
        },
      },
      fontFamily: { sans: ['var(--font-vazir)', 'Tahoma', 'sans-serif'] },
    },
  },
  plugins: [],
};
export default config;
