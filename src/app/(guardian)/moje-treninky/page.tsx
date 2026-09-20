import { messages } from '@/lib/i18n'

/** Placeholder. Built in Phase 5 — the booking engine. */
export default function Page() {
  return (
    <main className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">{messages.nav.myBookings}</h1>
      <p className="text-sm opacity-70">{messages.placeholder.comingSoon}</p>
    </main>
  )
}
