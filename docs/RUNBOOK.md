# Incident runbook

Trainlio — Sports Training Booking Platform

For the person operating the club's Trainlio: what to do when something is
wrong, in the order that finds it fastest.

This document is English, as all documentation is. Anything meant to be **sent
to a parent** is given in Czech, ready to paste.

---

## Before anything else

Two questions, in this order:

1. **Is a training about to start?** If so, deal with the people first: message
   the parents, and fix the system afterwards. A coach with a phone and a group
   chat beats a debugging session.
2. **Is this one parent, or everyone?** Ask the parent to try in a private
   window. One parent with a stale session is not an outage.

---

## Nobody receives a sign-in code

**Symptom.** A parent enters their email at `/prihlaseni`, the form moves to the
code step, and no email arrives.

Check in this order:

1. **Resend → Logs.** Is the message there?
   - **Not there at all** → Supabase is not reaching Resend. Check
     **Authentication → Emails → SMTP** in the Supabase dashboard. The most
     common cause is a rotated Resend key that was never updated here.
   - **There, bounced** → the address is wrong, or the domain's DNS changed.
     Check DKIM and SPF are still published.
   - **There, delivered** → it is in the parent's spam folder. Ask them to
     search for the sender address.
2. **Rate limiting.** Supabase Auth allows one code per address per minute. A
   parent pressing the button repeatedly gets nothing back. The form's countdown
   says so, but people do not always read it.

To a parent:

> Dobrý den, přihlašovací kód se posílá z adresy `<odesílatel>`. Zkontrolujte
> prosím složku Hromadné/Spam. Pokud kód nepřijde do dvou minut, napište mi a
> přihlásím vás jinak.

**Do not** create accounts by hand as a workaround. A profile without an
authentication record cannot sign in at all, and the parent is worse off.

---

## No notification emails, for anything

**Symptom.** A coach cancels a training and no parent is told.

The drain is a cron job. It has three ways to fail, and the response body tells
you which:

1. **Vercel → Cron Jobs.** Is `/api/notifications/drain` running every five
   minutes?
   - **Not running** → check `vercel.json` is deployed and cron is enabled for
     the project.
   - **Running, 401** → `CRON_SECRET` is missing or different in Vercel's
     environment. This is the single most common cause, because the secret is
     set in two places and only one of them is in the repository.
   - **Running, 500** → the drain threw. Check the function logs.
2. **The response body.** A healthy run looks like:

   ```json
   {
     "expandedEvents": 1,
     "createdDeliveries": 4,
     "attempted": 4,
     "sent": 4,
     "failed": 0,
     "scrubbed": 0,
     "queue": { "undispatched_events": 0, "pending": 0, "failed": 0, "sent": 12 }
   }
   ```

   - `undispatched_events` climbing → the drain is not running, or is failing
     before expansion.
   - `failed` climbing with `sent` at zero → Resend is rejecting everything.
     Check the API key and that the sender is still on a verified domain.
   - `pending` climbing with `attempted` at zero → deliveries exist but are not
     being claimed. Look for rows with no `recipient_email`: a profile whose
     login was removed has no address, which is correct and is not an error.

3. **Run it by hand** to see the result immediately:

   ```bash
   curl -sS -H "Authorization: Bearer $CRON_SECRET" \
     https://<your-domain>/api/notifications/drain | jq
   ```

   It is safe to run repeatedly. Expansion is idempotent, and a claimed
   delivery is not claimed twice.

Nothing is lost while this is broken. Events queue in the outbox and go out when
the drain runs again — late, but not missing. Tell the parents directly in the
meantime:

> Dobrý den, trénink `<den a čas>` je zrušen. Omlouvám se, že vás e-mail
> nezastihl — posíláme ho z aplikace a ta má dnes výpadek.

---

## A parent says the training list is empty

**Symptom.** A signed-in parent sees _Zatím nejsou vypsané žádné tréninky_ when
trainings exist.

Almost always one of three things, in order of likelihood:

1. **They have no athlete registered.** A parent with no child in the club sees
   no workspace at all — that is D-01 working, not a fault. Check
   `/moji-sportovci`: if it is empty, that is the answer.
2. **Their child is registered to a different club.** Only the workspace their
   child belongs to becomes visible.
3. **Every training has already ended.** The list shows future trainings only.

If none of those fit, it is a fault. Check the Vercel function logs for a line
beginning `listBookableSessions failed:` — a query error is reported with its
PostgREST code rather than rendering an empty list, which is exactly so that
this case is distinguishable from the three above.

---

## The occupancy count looks wrong

**Symptom.** A training shows `7 / 10` and the roster lists eight children, or a
parent is told a training is full when it is not.

```sql
select * from public.occupancy_reconciliation();
```

An empty result means the projection agrees with the bookings and the problem is
elsewhere — most likely a stale browser tab. Ask the parent to reload.

A row means real drift:

```
 training_session_id | projected | actual | drift
 ---------------------+-----------+--------+-------
 <uuid>              |         7 |      8 |     1
```

The projection is maintained by trigger and recomputes from scratch on every
booking _status_ change, so the next booking or cancellation on that session
repairs it by itself. To repair it now, without waiting for a parent:

```sql
select jsonb_pretty(public.repair_occupancy('<uuid>'));
-- or, for every drifting session:
select jsonb_pretty(public.repair_occupancy());
```

It reports what it changed, and appends an `OCCUPANCY_REPAIRED` audit entry —
a count that moved without a booking moving is exactly the thing someone will
later need explained. Confirm afterwards:

```sql
select * from public.occupancy_reconciliation();   -- expect no rows
```

Do not try to force the trigger by touching a booking row. It fires on a status
change, not on any write, so `update ... set updated_at = now()` does nothing —
and faking a status change would put a booking in the audit log that never
happened.

Also worth running, because it sees a failure the query above cannot:

```sql
select * from public.sessions_without_occupancy();
```

A session with no projection row has no lock to serialize on, which is worse
than a wrong count: two parents could take the same last place. If this returns
anything, stop taking bookings for that session and escalate — it means a
trigger did not fire, and the cause needs finding before the row is recreated.
`repair_occupancy()` deliberately will not create it: conjuring the row would
destroy the evidence of the fault.

---

## Two children took the same last place

**Symptom.** A training with capacity 10 has 11 confirmed bookings and no coach
overrode anything.

Check whether a coach _did_ override:

```sql
select a.first_name, a.last_name, b.coach_capacity_override, b.created_by_role
from public.bookings b
join public.athletes a on a.id = b.athlete_id
where b.training_session_id = '<uuid>' and b.status = 'CONFIRMED';
```

`coach_capacity_override = true` on the eleventh row is the system working:
a coach added a child above capacity and confirmed it. `BOOKING_CAPACITY_OVERRIDDEN`
in the audit log says who and when.

If every row is `false` and `created_by_role = 'USER'`, that is a genuine
overbooking, and it should not be possible — every booking path locks the
occupancy row first. Capture the state before anything changes it:

```sql
select * from public.audit_log
where entity_id in (select id from public.bookings where training_session_id = '<uuid>')
order by created_at;
```

Then decide with the coach who keeps the place. Remove the other booking through
the coach roster, not with SQL: the roster's removal writes the audit entry and
blocks a silent re-booking by the parent.

---

## A coach cannot see the coach area

**Symptom.** A coach signs in and lands on _Moji sportovci_, with no `/trener`.

They are not staff of the workspace. Either the grant was never made, or it was
deactivated:

```sql
select m.role, m.is_active, w.name
from public.workspace_members m
join public.workspaces w on w.id = m.workspace_id
join public.app_profiles p on p.id = m.profile_id
join auth.users u on u.id = p.auth_user_id
where u.email = 'trener@example.cz';
```

No rows → make the grant, as in [`DEPLOYMENT.md`](DEPLOYMENT.md) §4.
`is_active = false` → reactivate it:

```sql
update public.workspace_members m
   set is_active = true
  from public.app_profiles p
  join auth.users u on u.id = p.auth_user_id
 where m.profile_id = p.id and u.email = 'trener@example.cz';
```

---

## A parent asks to be deleted

This is the club's decision to make, not the platform's: the club is the
controller. Confirm in writing who asked and for what, then:

**1. Find the profile.**

```sql
select p.id, p.display_name, u.email
from public.app_profiles p
join auth.users u on u.id = p.auth_user_id
where u.email = 'rodic@example.cz';
```

**2. Look before you act.** This changes nothing:

```sql
select jsonb_pretty(public.anonymization_preview('<profile id>'));
```

Read `athletes_left_without_guardian` carefully. A child with no active guardian
keeps their existing bookings and can never be booked into a new training. If
another parent should take over, add their guardian access **before** step 3.

**3. Erase.**

```sql
-- The child's own name is only cleared if the request covers them and this
-- parent was their last active guardian. Pass false if it does not.
select jsonb_pretty(
  public.anonymize_profile('<profile id>', 'Žádost o výmaz, e-mail z 2026-09-20', true));
```

**4. Confirm.** The display name is gone, `anonymized_at` is stamped, the login
is deleted, and no address of theirs remains in the delivery audit. One audit
entry per workspace records that it happened.

What is kept, and why — worth saying to the parent in these words:

> Dobrý den, váš účet i jméno jsme odstranili a e-mail smazali. V systému
> zůstávají záznamy o tom, kdo a kdy byl přihlášen na jednotlivé tréninky, už
> ale bez jakéhokoli jména — jsou to záznamy o provozu klubu, ne o vás.

**This cannot be undone.** There is no reverse function, deliberately.

---

## Restoring from a backup

Only when data is genuinely lost — not for a single wrong row, which is a
targeted fix.

1. **Stop writes.** Turn the Vercel deployment off, or the restore races live
   bookings.
2. Restore in the Supabase dashboard to the point in time before the loss.
3. Run `pnpm db:validate` against a copy.
4. `select * from public.occupancy_reconciliation();` — expect no rows.
5. `select * from public.sessions_without_occupancy();` — expect no rows.
6. Bring the deployment back.

Anything booked between the restore point and now is gone and will not come
back. Tell the coach exactly which window it was, so they can ask those parents
to book again:

> Dobrý den, kvůli technické obnově dat se mohly ztratit přihlášky zadané mezi
> `<čas>` a `<čas>`. Zkontrolujte prosím Moje tréninky a v případě potřeby
> přihlaste dítě znovu. Omlouváme se.

---

## Escalating

Capture these before asking anyone for help; all three are cheap and all three
are gone if the system is restarted first:

1. The Vercel function logs for the affected window.
2. `select * from public.occupancy_reconciliation();` and
   `select * from public.sessions_without_occupancy();`
3. The relevant slice of the audit log:

   ```sql
   select created_at, action, entity_type, entity_id, actor_profile_id, metadata
   from public.audit_log
   where created_at > now() - interval '2 hours'
   order by created_at;
   ```

The audit log is append-only and is the record of what actually happened, as
distinct from what anyone remembers happening.
