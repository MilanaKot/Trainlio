# Deviations from the design handoff

`docs/design/` is the handoff as delivered, and it wins by default. This file
lists every place the implementation does something else, and why — so a
reviewer comparing a screen against its spec finds the answer here instead of
assuming the spec was missed.

Each entry is a decision that has been taken. Things still genuinely undecided
belong in `OPEN_DECISIONS.md`.

## Routes stay Czech

`guardian/SPEC.md` §1 says "route names are English for the codebase" and lists
`/trainings`, `/my-trainings`, `/account`. The application serves `/treninky`,
`/moje-treninky`, `/ucet` and the rest in Czech.

Renaming fourteen routes would touch the runbook, the deployment notes, the
browser suite and any link a coach has already sent a parent, in exchange for
consistency with a document that itself calls URLs a detail of the codebase.
Code, schema, comments and docs are English as CLAUDE.md requires; the URL is
something a parent reads.

## The message catalogue stays TypeScript

`shared/DESIGN_SYSTEM.md` §8 proposes `messages/cs.json` in ICU syntax. The
project already has a typed catalogue at `src/lib/i18n/messages/cs.ts` with a
`plural()` helper and its own tests. Same plural categories, same output, an
implementation that is already proven, and no new dependency. English can be
added beside it when it is needed.

## A telephone number needs no country code

`guardian/SPEC.md` §G16 asks for E.164 validation. The column takes a national
number too. A form that refuses `777 123 456` is telling a parent their own
telephone number is wrong, both ends of the call are in the same country, and
`tel:` on a national number dials from the coach's phone at the rink. A number
that starts with `+` is still held to E.164 strictly, so a family abroad works.
The placeholder changed to match (`777 123 456`).

## Changing the e-mail address is not built

`guardian/SPEC.md` §G14 designs `/account/email`. Out of scope for now, by
product decision — the flow exists nowhere in the application and is not in the
brief. The screen is simply absent, as `G15 Jazyk` already is.

## Dark mode is deferred, and needs its own input

The design is a single light palette (brief §3 asks for a light background) and
names no dark colours. Until it does, the dark variant is bound to a class
nothing sets, so the `dark:` utilities still left in pre-design screens are
inert rather than half-applied. A dark theme cannot be derived: the accent and
every status colour fall between 2.7:1 and 3.4:1 on a dark background, and all
six soft fills are pale tints built for white.

## Every active guardian is returned, not one "Rodič"

`coach/SPEC.md` §K2 shows a single `Rodič` row with a single `Telefon`.
`booking_guardians()` returns every active guardian of the athlete. One
guardian is the common case, not a rule — BR-002 has allowed several since the
first migration — and a second parent should not be hidden from a coach trying
to reach the family.
