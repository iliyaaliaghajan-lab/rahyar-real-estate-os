import type { Metadata, Viewport } from 'next';
import { Vazirmatn } from 'next/font/google';
import './globals.css';
import { AppShell } from '@/components/AppShell';

const vazir = Vazirmatn({ subsets: ['arabic', 'latin'], variable: '--font-vazir', display: 'swap' });

export const metadata: Metadata = {
  title: 'اتحاد — سیستم عامل همکاری املاک',
  description: 'سیستم عامل هوشمند برای مدیریت فایل، مشتری، تطبیق و همکاری در کسب‌وکار املاک',
  manifest: '/manifest.webmanifest',
  icons: {
    icon: [
      { url: '/icon.svg', type: 'image/svg+xml' },
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
    ],
    apple: '/apple-touch-icon.png',
  },
  appleWebApp: { capable: true, title: 'اتحاد', statusBarStyle: 'default' },
};
export const viewport: Viewport = {
  themeColor: '#0D2347',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fa" dir="rtl" className={vazir.variable}>
      <body className="font-sans">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
