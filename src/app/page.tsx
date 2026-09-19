import { messages } from '@/lib/i18n'

/**
 * Placeholder root. Replaced in Phase 2 by the guardian and coach route groups
 * under (guardian)/ and (coach)/.
 */
export default function Home() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-3 px-4">
      <h1 className="text-2xl font-semibold">{messages.app.name}</h1>
      <p className="text-sm opacity-70">Rezervace sportovních tréninků</p>
    </main>
  )
}
