import type { Metadata } from 'next';
import dynamic from 'next/dynamic';
import './globals.css';

const Providers = dynamic(() => import('./providers'), { ssr: false });

export const metadata: Metadata = {
  title: 'MoltiGuild',
  description: 'AI labor marketplace visualized as a living isometric pixel city',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
