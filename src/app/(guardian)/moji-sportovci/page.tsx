import Link from 'next/link'
import { listGuardianAthletes } from '@/server/athletes/queries'
import { AthleteCard } from '@/components/athlete/athlete-card'
import { messages } from '@/lib/i18n'

export default async function MyAthletesPage() {
  const athletes = await listGuardianAthletes()

  return (
    <main className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">{messages.athlete.listTitle}</h1>

      {athletes.length === 0 ? (
        <div className="flex flex-col gap-2 rounded-xl border border-dashed border-black/15 p-6 text-center dark:border-white/20">
          <p className="font-medium">{messages.athlete.addFirst}</p>
          <p className="text-sm opacity-70">{messages.athlete.addFirstHint}</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {athletes.map((athlete) => (
            <AthleteCard key={athlete.id} athlete={athlete} />
          ))}
        </ul>
      )}

      <Link
        href="/moji-sportovci/novy"
        className="flex min-h-12 items-center justify-center rounded-lg bg-black px-4 text-base font-medium text-white dark:bg-white dark:text-black"
      >
        {messages.athlete.add}
      </Link>
    </main>
  )
}
