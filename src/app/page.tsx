import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { signOut } from '@/server/auth/actions'
import { messages } from '@/lib/i18n'

/**
 * Placeholder root. Phase 2 replaces it with the guardian route group; for now
 * it shows whether the visitor is signed in, which is what Phase 1 delivers.
 */
export default async function Home() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 px-4">
      <h1 className="text-2xl font-semibold">{messages.app.name}</h1>
      <p className="text-sm opacity-70">Rezervace sportovních tréninků</p>

      {user ? (
        <form
          action={async () => {
            'use server'
            await signOut()
          }}
        >
          <button type="submit" className="text-sm underline">
            {messages.auth.signOut}
          </button>
        </form>
      ) : (
        <Link href="/prihlaseni" className="text-sm underline">
          {messages.auth.signInTitle}
        </Link>
      )}
    </main>
  )
}
