# UI Specification

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
Příbram · MH

2017–2018

3 / 10

[Přihlásit]
```

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

## My Bookings

Tabs/sections:
- Nadcházející
- Minulé

Future changed session:
`ZMĚNĚNO`

Cancelled:
`ZRUŠENO TRENÉREM`

Inside 12-hour window:
Disable cancel button and show:
`Odhlášení již není možné. Kontaktujte trenéra.`

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

## Coach: Session detail

Show:
- date/time
- facility
- changing room
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
