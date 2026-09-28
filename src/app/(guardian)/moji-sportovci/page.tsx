import Link from 'next/link'
import { listGuardianAthletes } from '@/server/athletes/queries'
import { AthleteCard } from '@/components/athlete/athlete-card'
import { EmptyState } from '@/components/ui/empty-state'
import { buttonVariants } from '@/components/ui/button'
import { messages } from '@/lib/i18n'

const t = messages.athlete

/** The parent's children (guardian/SPEC.md §G7). */
export default async function MyAthletesPage() {
  const athletes = await listGuardianAthletes()

  return (
    <main className="flex flex-col gap-5">
      <h1 className="font-display text-page font-bold text-ink">{t.listTitle}</h1>

      {athletes.length === 0 ? (
        <EmptyState
          action={
            <Link href="/moji-sportovci/novy" className={buttonVariants({ size: 'md' })}>
              {t.add}
            </Link>
          }
        >
          {t.addFirstEmpty}
        </EmptyState>
      ) : (
        <>
          <ul className="flex flex-col gap-2">
            {athletes.map((athlete) => (
              <AthleteCard key={athlete.id} athlete={athlete} />
            ))}
          </ul>

          <Link
            href="/moji-sportovci/novy"
            className="flex h-btn-block items-center justify-center rounded-control-lg bg-primary-100 text-body font-bold text-primary"
          >
            {t.addBlock}
          </Link>
        </>
      )}
    </main>
  )
}
