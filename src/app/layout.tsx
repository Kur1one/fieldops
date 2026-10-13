import type { Metadata, Viewport } from 'next';
import { ClientBoot } from '@/components/ClientBoot';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Выезды', template: '%s · Выезды' },
  description: 'Заявки и отчёты о выездах',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'Выезды', statusBarStyle: 'default' },
  icons: { icon: '/icons/icon-192.png', apple: '/icons/apple-touch-icon.png' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#1a56db',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body>
        <ClientBoot />
        {children}
      </body>
    </html>
  );
}
