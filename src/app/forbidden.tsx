import Link from 'next/link'
import { messages } from '@/lib/i18n'

const t = messages.coach.stats

/**
 * 403: a page this person may not open — another coach's K20b for anybody
 * but an administrator (coach test 28). Said, not passed off as missing.
 */
export default function Forbidden() {
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-3 px-4 py-8">
      <h1 className="font-display text-page font-bold text-ink">{t.forbiddenTitle}</h1>
      <p className="text-body text-muted">{t.forbiddenBody}</p>
      <Link
        href="/trener/statistiky"
        className="flex min-h-11 items-center text-row font-bold text-primary"
      >
        {t.forbiddenBack}
      </Link>
    </main>
  )
}
