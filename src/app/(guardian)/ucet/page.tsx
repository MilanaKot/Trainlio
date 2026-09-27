import { createClient } from '@/lib/supabase/server'
import { signOut } from '@/server/auth/actions'
import { messages } from '@/lib/i18n'
import { ProfileForm } from './profile-form'

export default async function AccountPage() {
  const supabase = await createClient()

  // The email is read from the authentication record, never from a domain
  // table — app_profiles deliberately has no email column.
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { data: profile } = await supabase
    .from('app_profiles')
    .select('id, first_name, last_name, phone')
    .maybeSingle()

  return (
    <main className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">{messages.account.title}</h1>

      <p className="text-sm opacity-70">{user?.email}</p>

      <ProfileForm
        firstName={profile?.first_name ?? ''}
        lastName={profile?.last_name ?? ''}
        phone={profile?.phone ?? ''}
      />

      <form
        action={async () => {
          'use server'
          await signOut()
        }}
        className="border-t border-black/10 pt-6 dark:border-white/15"
      >
        <button type="submit" className="min-h-11 text-sm underline">
          {messages.auth.signOut}
        </button>
      </form>
    </main>
  )
}
