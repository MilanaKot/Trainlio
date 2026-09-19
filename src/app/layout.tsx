import type { Metadata, Viewport } from 'next'
import { messages } from '@/lib/i18n'
import './globals.css'

export const metadata: Metadata = {
  title: messages.app.name,
  description: 'Rezervace sportovních tréninků',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Mobile-first, but never at the cost of letting a parent zoom in on a
  // birth date or a changing-room number.
  maximumScale: 5,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="cs">
      <body>{children}</body>
    </html>
  )
}
