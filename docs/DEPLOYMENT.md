# Deployment

Trainlio — Sports Training Booking Platform

Written for the first production deployment: one coach, one workspace, Příbram.
Everything here is done once, in this order, because several steps depend on the
one before.

The application is English in code and schema and Czech on screen. This document
is English; the messages a coach would actually send are given in Czech, ready to
paste.

---

## What you are standing up

| Piece                             | Service  | Why it cannot be skipped                        |
| --------------------------------- | -------- | ----------------------------------------------- |
| Database, auth, storage, realtime | Supabase | Every invariant in the product is enforced here |
| Application                       | Vercel   | Next.js server components and the cron route    |
| Email                             | Resend   | Both the sign-in code and every notification    |

Nothing is optional. A deployment without Resend has no sign-in at all, because
the one-time code _is_ the authentication.

---

## 1. Supabase project

Create the project in an EU region. The data is Czech children's names and birth
dates, and the controller is a Czech sports club.

```
Region:              eu-central-1 (Frankfurt) or closer
Postgres version:    17
Project name:        trainlio-production
```

Record the database password somewhere durable at creation. It is shown once,
and point-in-time recovery restores need it.

### Apply the schema

```bash
supabase link --project-ref <ref>
supabase db push
```

`db push` applies `supabase/migrations/` in order. It must be the only way the
production schema ever changes: an edit made in the dashboard is invisible to
`db:validate`, and the next `db push` will disagree with it.

Verify before going further:

```bash
supabase db lint
PSQL="psql <production connection string>" pnpm db:validate   # against a COPY, never production
```

`db:validate` creates and drops databases. Point it at a scratch instance.

### Storage

The `athlete-photos` bucket and its policies are created by migration 08. Confirm
in the dashboard that it is **not** public. A public bucket would make every
child's photograph readable by URL, which is the one storage mistake that cannot
be walked back once a URL has been shared.

### Realtime

Migration 07 adds `training_session_occupancy` and `training_sessions` to the
publication. Confirm `bookings` is **not** in it: the projection is what a
guardian may see, and the bookings behind it are not.

---

## 2. Resend

One domain, two uses. Verify it once and both work.

1. Add the sending domain and publish the DKIM, SPF and DMARC records it gives
   you. Sign-in codes that land in spam are indistinguishable from a broken
   product.
2. Create an API key with **sending** permission only.
3. Note the sender address. It must be on the verified domain —
   `trener@vasedomena.cz`, not a Gmail address.

### Supabase Auth SMTP

In the Supabase dashboard, **Authentication → Emails → SMTP**:

```
Host:      smtp.resend.com
Port:      465
Username:  resend
Password:  <the Resend API key>
Sender:    <the verified address>
```

This is a project setting, not a repository one. `supabase/config.toml`
deliberately does not carry it: pointing the local stack at Resend takes mail
away from Mailpit and breaks local sign-in entirely.

Supabase's built-in SMTP is rate limited to a handful of messages an hour and is
not a production option. A club with fifteen parents signing in on a Monday
evening will exhaust it.

### The one-time-code template

**Authentication → Emails → Magic Link**, using the Czech template in
`supabase/templates/auth_otp.html`. Check that `{{ .Token }}` is present: the
default template sends a link, and Trainlio's sign-in form asks for a code.

---

## 3. Vercel

Import the repository. Framework detection finds Next.js; nothing needs
overriding.

### Environment variables

Set all of these for **Production** _and_ **Preview**. A preview deployment with
no configuration fails at build, which is the intended behaviour
(`assertEnv()` in `next.config.ts`) and is confusing if you were not expecting
it.

| Variable                        | Value                         |
| ------------------------------- | ----------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`      | `https://<ref>.supabase.co`   |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → API → anon public  |
| `NEXT_PUBLIC_SITE_URL`          | `https://<your-domain>`       |
| `SUPABASE_SERVICE_ROLE_KEY`     | Supabase → API → service_role |
| `RESEND_API_KEY`                | The Resend key                |
| `AUTH_SENDER_EMAIL`             | The verified sender           |
| `CRON_SECRET`                   | `openssl rand -base64 32`     |

The service-role key bypasses row level security completely. It belongs in
Vercel's environment and nowhere else — not in `.env.local` committed anywhere,
not in a preview branch's logs, not in a support ticket.

### Cron

`vercel.json` schedules `/api/notifications/drain` every five minutes. Vercel
sends `Authorization: Bearer $CRON_SECRET`, so the secret must be set in the
Vercel project or every firing is refused with a 401 and no email ever goes out.

After the first deployment, check **Vercel → Cron Jobs** shows a run, and that
its response body has `"sent"` and `"queue"` in it.

### Supabase redirect URLs

**Authentication → URL Configuration**:

```
Site URL:        https://<your-domain>
Redirect URLs:   https://<your-domain>/**
```

Without this, sign-in appears to work and then returns the parent to a page that
signs them straight back out.

---

## 4. The first coach

There is no interface for granting a coach role, deliberately: it is an
administrative act, and D-17 keeps staff membership out of the guardian model
entirely.

The coach signs in once, through the normal form, so their profile exists. Then,
in the Supabase SQL editor:

```sql
-- Confirm the profile, and that you have the right person.
select p.id, p.display_name, u.email
from public.app_profiles p
join auth.users u on u.id = p.auth_user_id
where u.email = 'trener@example.cz';

insert into public.workspace_members (workspace_id, profile_id, role)
select w.id, p.id, 'COACH'
from public.workspaces w
cross join public.app_profiles p
join auth.users u on u.id = p.auth_user_id
where u.email = 'trener@example.cz'
  and w.name like 'Příbram%';
```

They now see `/trener` on their next navigation.

### Workspace settings

The seed creates the workspace with the MVP defaults. Change them here, not in
code:

```sql
update public.workspaces
   set cancellation_deadline_hours = 12,      -- D-03
       delivery_email_retention_days = 90,    -- D-18
       timezone = 'Europe/Prague'
 where name like 'Příbram%';
```

---

## 5. Verify the whole path

Do this on production, once, before telling any parent about it. The failures
that matter are the ones between the pieces, and each of these crosses a
boundary.

1. **Sign-in.** Request a code at `/prihlaseni` with a real address. It arrives
   within a minute, from your domain, in Czech, and is six digits.
2. **Registration.** Add an athlete. The workspace notice names the club before
   you submit.
3. **A session.** As the coach, publish one for next week.
4. **Booking.** As the parent, book. The count moves from `0 / 10` to `1 / 10`.
5. **Realtime.** In a second browser, watch the count move when the first books.
6. **The roster.** As the coach, confirm the parent's name is beside the child.
7. **Notification.** Cancel the session. Within five minutes the parent has an
   email naming the child. Check **Vercel → Cron Jobs** if it does not.
8. **Privacy.** As a second parent with a child of their own, confirm you see the
   occupancy count and no other family's name anywhere.

Step 8 is the one worth doing slowly. Everything else failing is visible;
this one failing is not.

---

## 6. Backups and recovery

### What Supabase gives you

| Plan | Backups              | Point-in-time recovery |
| ---- | -------------------- | ---------------------- |
| Free | None you can rely on | No                     |
| Pro  | Daily, 7 days        | Add-on, 7 days         |

**The Free plan is not a production plan for this application.** A booking
system holds the only record of who is coming to a training; losing a day of it
means a coach who cannot tell whether a child is expected. Pro with PITR is the
minimum.

### Verify a restore before you need one

An untested backup is a belief, not a backup. Once, before launch:

1. Restore the production database to a new project from a backup.
2. Run `pnpm db:validate` against it.
3. Check `select * from public.occupancy_reconciliation()` returns no rows —
   the projection agreeing with the bookings is the thing most likely to be
   wrong after a partial restore.
4. Delete the restored project.

### What is not in a database backup

- **Storage.** Athlete photographs live in a bucket, not in Postgres. Supabase
  backs them up separately; confirm on your plan.
- **Vercel environment variables.** Keep the `CRON_SECRET` and the Resend key in
  a password manager. A rotated key nobody recorded means a silent stop to all
  email.
- **The Supabase SMTP settings.** A project restore does not carry them.

---

## 7. What to watch

| Signal                               | Where                                             | What it means                                                |
| ------------------------------------ | ------------------------------------------------- | ------------------------------------------------------------ |
| Cron failing                         | Vercel → Cron Jobs                                | No parent is being emailed about anything                    |
| `queue.failed` climbing              | Drain response body                               | Resend is rejecting; check the key and the domain            |
| `queue.undispatched_events` climbing | Same                                              | The drain is not running at all                              |
| Occupancy drift                      | `select * from public.occupancy_reconciliation()` | The projection disagrees with the bookings — see the runbook |

A weekly look at the reconciliation query costs a minute and is the only way a
silent drift would ever surface.

---

## 8. Data protection

The coach's club is the **controller**: they decide what is collected and for
how long. Trainlio is the **processor**. That division matters for who answers a
parent's erasure request — it is the club, and the runbook has the procedure.

What is held, and where:

| Data                            | Where                       | Erasable                           |
| ------------------------------- | --------------------------- | ---------------------------------- |
| Parent's email                  | `auth.users` only           | Yes, with the account              |
| Parent's display name           | `app_profiles.display_name` | Yes, cleared on anonymisation      |
| Child's name, birth date, photo | `athletes`, Storage         | Yes, on explicit request           |
| Who booked what, and when       | `bookings`, `audit_log`     | **No** — see below                 |
| Address a message was sent to   | `notification_deliveries`   | Cleared after the retention window |

Bookings and audit entries are kept after an erasure, attributed to an opaque
profile id with no name behind it. They record what the club did, not who the
person was, and deleting them would remove a training from the club's own
history. That is the trade the schema was built for (D-18), and it is worth
saying plainly to a parent who asks.

The procedure is in [`RUNBOOK.md`](RUNBOOK.md) under _A parent asks to be
deleted_.

---

## Rolling back

A bad application deploy is a Vercel rollback: instant, and it changes no data.

A bad **migration** is not. Migrations are forward-only, because a down
migration that drops a column drops the bookings in it. If a migration is wrong:

1. Roll the application back to the deployment before it.
2. Write a new migration that corrects the schema forward.
3. Never edit an applied migration file — `db push` tracks them by name, and an
   edited file is skipped in silence.
