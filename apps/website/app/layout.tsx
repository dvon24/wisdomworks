import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'WisdomWorks — AI for Every Business',
  description: 'Tell us what you need. AI builds it. AI runs it. AI improves it.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
