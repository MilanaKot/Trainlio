import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

/**
 * The root sends people where they belong.
 *
 * Workspace staff go to the coach area, everyone else signed in to their
 * athletes. A coach who is also a parent lands on the coach area and reaches
 * their children through the guardian URLs, which is the common case for the
 * MVP's single coach.
 */
export default async function Home() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/prihlaseni')

  const { data: staff } = await supabase
    .from('workspace_members')
    .select('workspace_id')
    .eq('is_active', true)
    .limit(1)

  redirect(staff && staff.length > 0 ? '/trener' : '/moji-sportovci')
}
