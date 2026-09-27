import type { Metadata, Viewport } from 'next'
import { Barlow_Semi_Condensed, Manrope } from 'next/font/google'
import { messages } from '@/lib/i18n'
import './globals.css'

/*
 * Two families, as DESIGN_SYSTEM §2 specifies: Manrope for text, Barlow Semi
 * Condensed for everything numeric — times, dates and counts, which is what a
 * parent scans a list for.
 *
 * `latin-ext` is not optional. Without it ř, ů, ě, š, č, ž and ý fall back to a
 * different face mid-word, which is visible in every Czech surname on a roster.
 */
const manrope = Manrope({
  subsets: ['latin', 'latin-ext'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-manrope',
  display: 'swap',
})

const barlow = Barlow_Semi_Condensed({
  subsets: ['latin', 'latin-ext'],
  weight: ['500', '600', '700'],
  variable: '--font-barlow',
  display: 'swap',
})

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
  // The status bar picks up the app background rather than the browser's white.
  themeColor: '#F3F5F9',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="cs" className={`${manrope.variable} ${barlow.variable}`}>
      <body>{children}</body>
    </html>
  )
}
