import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { SignInForm } from './sign-in-form'

export default async function SignInPage() {
  const supabase = await createClient()

  // getUser() revalidates against the auth server. getSession() only reads the
  // cookie, so it must never gate a redirect.
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (user) redirect('/')

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4 py-8">
      <SignInForm />
    </main>
  )
}
