# UI Specification

Trainlio — Sports Training Booking Platform

## Design direction
- Mobile-first
- Very simple
- Large tap targets
- Minimal form complexity
- Czech UI
- Responsive desktop coach dashboard
- Avoid exposing technical multi-sport complexity in the hockey MVP

## Guardian navigation
Bottom navigation:
1. Tréninky
2. Moje tréninky
3. Moji sportovci
4. Účet

## Screen: Tréninky

Card example:

```text
Neděle 27. 9.

09:00–10:00
Příbram · MH · Šatna 4

2017–2018

3 / 10

[Přihlásit]
```

Changing room is guardian-visible and may be absent, in which case the venue line
is `Příbram · MH`.

If all athletes:
`Všichni sportovci`

If full:
`10 / 10`
CTA disabled.

If CLOSED:
`Přihlašování uzavřeno`

## Booking athlete picker

Only show eligible athletes.

Example:
```text
Koho chcete přihlásit?

☑ Ivan Kotov
☑ Anna Kotova

[Přihlásit 2 sportovce]
```

Do not show ineligible children in the default MVP picker.

### Atomic multi-athlete booking (D-05)

Selecting several athletes is one all-or-nothing action. The UI must never
present a result in which some selected siblings are booked and others are not.

When the remaining places are fewer than the selection, the server rejects the
whole request and reports the number of available places. The picker then asks
the guardian to reduce the selection:

```text
Na tento trénink zbývá poslední volné místo.
Vyberte prosím pouze jednoho sportovce.

[Rozumím]
```

```text
Na tento trénink zbývají 2 volná místa.
Vyberte prosím nejvýše 2 sportovce.

[Rozumím]
```

```text
Trénink je již plný.

[Rozumím]
```

Czech plural agreement for the place count is required:

| Places | Text |
|---|---|
| 1 | `zbývá poslední volné místo` |
| 2–4 | `zbývají 2 volná místa` |
| 5 or more | `zbývá 5 volných míst` |

This is a message-formatting concern, handled by the i18n layer with plural
categories, not by string concatenation.

The confirm button is not disabled client-side on the basis of a cached
occupancy value. The count may be stale; the server decides.

## My Bookings

Tabs/sections:
- Nadcházející
- Minulé

Future changed session:
`ZMĚNĚNO`

Cancelled:
`ZRUŠENO TRENÉREM`

Inside the cancellation deadline window:
Disable cancel button and show:
`Odhlášení již není možné. Kontaktujte trenéra.`

The deadline is a workspace setting whose MVP value is 12 hours. The disabled
state is a display affordance only; the server independently rejects a late
cancellation.

Cancelled session, no re-booking possible:
`Trénink byl zrušen.`

Removed by coach:
When a coach has removed an athlete from a session, the guardian sees the
booking in history and no re-booking action:
`Sportovce odebral trenér. Pro opětovné přihlášení kontaktujte trenéra.`

## Athlete profile

Core:
- Jméno
- Příjmení
- Datum narození
- Fotografie

Hockey:
- Klub
- Tým / kategorie
- Pozice
- Hůl
- Číslo dresu

Position select:
- Brankář
- Obránce
- Centr
- Levé křídlo
- Pravé křídlo
- Univerzál

Stick side:
- Levé
- Pravé
- Nevím

## Coach: Training list

List by date, not calendar.

Example:
```text
Neděle 27. 9.

09:00–10:00
MH · Šatna 4
2017–2018
8 / 10

[Detail]
```

Primary actions:
- + Trénink
- + Série tréninků

## Session times and dates

All dates and times shown to any user are rendered in the workspace timezone
(`Europe/Prague` for the MVP workspace), never in the device timezone. A guardian
travelling abroad must see the same training time as the coach.

## Coach: Session detail

Show:
- date/time
- facility
- changing room
- public notes
- internal notes (coach and admin only — never rendered in a guardian view)
- eligibility
- capacity
- occupancy
- main coach
- assistant coaches
- notes
- roster

Roster row:
- athlete name
- birth year
- hockey profile summary
- booked by
- booking time

Actions:
- Přidat sportovce
- Odebrat
- Upravit trénink
- Duplikovat
- Zavřít přihlašování
- Zrušit trénink

## Coach: Capacity warning

If reducing capacity below current occupancy:

```text
Na tento trénink je již přihlášeno 8 sportovců.
Nová kapacita je 6.

Stávající přihlášky zůstanou zachovány.

[Zrušit] [Přesto uložit]
```

## Coach: Manual over-capacity warning

```text
Trénink je již plný (10 / 10).

Chcete sportovce přidat nad stanovenou kapacitu?

[Zrušit] [Přidat]
```

## Recurring series form

Fields:
- weekday / recurrence
- date from
- date to
- start time
- end time
- facility
- changing room optional
- capacity
- all athletes or birth-year range
- main coach
- assistant coaches
- notes

Preview generated dates before save.

The preview shows local dates and times in the workspace timezone. It must show
the same local start time for every occurrence, including occurrences on the far
side of a daylight-saving change. A preview whose times drift by an hour
indicates the generation bug this specification exists to prevent.
