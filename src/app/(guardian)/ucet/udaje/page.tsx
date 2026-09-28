import Link from 'next/link'
import { getOwnProfile } from '@/server/athletes/queries'
import { ProfileForm } from '@/app/(guardian)/ucet/profile-form'
import { messages } from '@/lib/i18n'

const t = messages.account

/** The parent's own details (guardian/SPEC.md §G16). */
export default async function EditProfilePage() {
  const profile = await getOwnProfile()

  return (
    <main className="flex flex-col gap-5 pb-36">
      <Link
        href="/ucet"
        className="flex min-h-11 items-center self-start text-row font-semibold text-muted"
      >
        {messages.common.cancel}
      </Link>
      <h1 className="font-display text-form-title font-bold text-ink">{t.editTitle}</h1>

      <ProfileForm
        firstName={profile?.firstName ?? ''}
        lastName={profile?.lastName ?? ''}
        phone={profile?.phone ?? ''}
      />
    </main>
  )
}
