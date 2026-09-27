# Trainlio — UI/UX Design Brief

## Product

**Trainlio** is a mobile-first sports training booking platform.

The first production use case is private hockey training in Příbram, Czech Republic, but the product architecture supports multiple sports, coaches and independent training organizations in the future.

The UI should currently feel like a focused hockey training application, not like a generic enterprise SaaS platform.

The product serves three user groups:

1. **Guardians / athletes**
2. **Coaches**
3. **Admins**

The first release should prioritize guardian and coach workflows, but the admin design must include basic coach management.

---

# 1. Design objective

Create a UI that feels:

- extremely simple;
- modern;
- trustworthy;
- sporty without looking aggressive;
- easy to operate with one hand on a phone;
- understandable without onboarding;
- suitable for parents as well as coaches;
- visually polished enough to become a commercial SaaS product later.

The interface should reduce decisions.

A parent should be able to open Trainlio, understand the available trainings and book a child within seconds.

The coach should be able to see the upcoming schedule, occupancy and roster without navigating through complex dashboards.

Do not design this as a traditional sports-club management system with dense tables, sidebars and many controls.

---

# 2. Platform priorities

Primary:

**Mobile web / PWA**

Design first for approximately:

- 390–430 px mobile width;
- iPhone / Android portrait mode.

Secondary:

- tablet;
- desktop coach/admin interface.

Guardian screens should remain mobile-first even on desktop.

Coach and admin screens can use more horizontal space on desktop, but should still work well from a phone.

---

# 3. Visual direction

The visual language should communicate:

**sport + organization + calm confidence**

Avoid:

- overly dark "hockey locker-room" aesthetic;
- neon gaming aesthetics;
- excessive gradients;
- overly playful children's-app design;
- corporate banking/dashboard appearance;
- heavy card borders everywhere;
- excessive shadows;
- too many icons;
- visual noise.

Preferred style:

- light background;
- strong typography;
- clean spacing;
- soft surfaces;
- restrained accent color;
- clearly differentiated statuses;
- large touch targets;
- slightly rounded components;
- high readability.

Think modern sports-tech rather than sports merchandise.

Trainlio should still work later for tennis, football, swimming, gymnastics, etc., so avoid hockey imagery as part of the core design system.

Hockey-specific imagery may appear in marketing or onboarding, but not as part of the fundamental navigation language.

---

# 4. Brand feel

Brand name:

**Trainlio**

Possible brand attributes:

- active;
- efficient;
- human;
- reliable;
- clear;
- friendly;
- contemporary.

Trainlio should not feel premium-exclusive.

It should feel accessible to ordinary parents and independent coaches.

Do not make it childish.

---

# 5. Typography

Use a clean modern sans-serif.

Typography should provide strong hierarchy.

Suggested hierarchy:

### Page title
Large, bold.

Example:

`Tréninky`

### Date section
Medium / semibold.

Example:

`Neděle 27. září`

### Training time
Visually prominent.

Example:

`09:00–10:00`

### Supporting information
Smaller and quieter.

Example:

`Příbram · MH · Šatna 4`

### Capacity
Clearly visible but not visually dominant.

Example:

`7 / 10`

Numbers, dates and times should be especially easy to scan.

---

# 6. Czech language

The first release UI is entirely in Czech.

Design components so that longer English labels could fit later.

Do not rely on extremely short Czech-only layouts that would break in localization.

---

# 7. Navigation — Guardian

Use bottom navigation on mobile.

Four primary items:

### Tréninky
Available training sessions.

### Moje tréninky
Bookings for the guardian's children.

### Moji sportovci
Athlete profiles.

### Účet
Account.

Use simple icons with text labels.

Navigation should remain obvious rather than icon-only.

---

# 8. Guardian home — Tréninky

This is the most important guardian screen.

The user should immediately see available upcoming sessions.

Do not require:

`Sport → Coach → Venue → Date → Session`

The initial hockey MVP has one coach context, so sessions should appear directly.

Organize sessions by date.

Example:

**Neděle 27. září**

Training card:

`09:00–10:00`

`Příbram · MH`

`Šatna 4`

`Ročníky 2017–2018`

`7 / 10`

Primary button:

**Přihlásit**

Capacity should be easy to understand visually.

Possible visualization:

`●●●●●●●○○○ 7 / 10`

or a restrained progress bar.

Do not make capacity visualization look like a performance metric or leaderboard.

---

# 9. Training card states

Create clear designs for:

### Available

`7 / 10`

Primary CTA active.

### Last places

Example:

`9 / 10`

Capacity should attract slightly more attention.

Do not use alarming red unless truly necessary.

### Full

`10 / 10`

CTA disabled.

Label:

**Obsazeno**

### Closed by coach

Label:

**Přihlašování uzavřeno**

No booking CTA.

### Updated

Show a small but obvious marker:

**ZMĚNĚNO**

Only booked users need this marker when the significant change happened after their booking.

### Cancelled

Use a strong cancellation state.

Example:

**ZRUŠENO TRENÉREM**

The card remains visible but should visually look inactive.

Do not remove cancelled sessions from history.

---

# 10. Booking flow

Booking should require minimal interaction.

User taps:

**Přihlásit**

Open a bottom sheet or simple modal.

Title:

**Koho chcete přihlásit?**

Show only eligible athletes.

Example:

☐ Ivan Kotov  
☐ Anna Kotova

If several children are selected:

**Přihlásit 2 sportovce**

Do not use a multi-screen wizard.

If only one eligible child exists, consider allowing a simplified confirmation flow.

---

# 11. Atomic multi-child booking UX

Bookings for several selected children are atomic.

Example:

Only one place remains but the guardian selected two children.

Do not silently book one child.

Show:

**Není dostatek volných míst**

`Na tréninku zbývá pouze 1 místo. Vyberte prosím jednoho sportovce.`

Return the user to the selection.

This should feel like a normal state, not a system error.

---

# 12. My Bookings

Screen:

**Moje tréninky**

Use two segments:

### Nadcházející

### Minulé

Each booking must show which child is booked.

Example:

**Ivan Kotov**

`Neděle 27. září`

`09:00–10:00`

`Příbram · MH · Šatna 4`

Button:

**Odhlásit**

---

# 13. Cancellation deadline UX

Users can cancel until exactly 12 hours before training.

When self-cancellation is no longer available, don't simply hide the button.

Show the information:

**Odhlášení již není možné. Kontaktujte trenéra.**

The user must understand why the action disappeared.

---

# 14. Cancelled session in My Bookings

Cancelled sessions remain visible.

Example:

**Ivan Kotov**

~~Neděle 27. září · 09:00~~

**ZRUŠENO TRENÉREM**

The user should immediately distinguish this from a cancelled personal booking.

---

# 15. Athlete profiles

Screen:

**Moji sportovci**

Example:

Profile card:

Photo

**Ivan Kotov**

`23. 10. 2017`

`Lední hokej`

Allow one athlete to have more than one sport.

Example:

**Ivan Kotov**

🏒 Lední hokej  
⚽ Fotbal

Do not create separate visual identities such as "Ivan Hockey" and "Ivan Football".

They are one person with multiple sport profiles.

---

# 16. Athlete profile — core information

Fields:

- Fotografie
- Jméno
- Příjmení
- Datum narození

The photo is optional.

Make photo upload lightweight and non-essential.

---

# 17. Hockey sport profile

For hockey show:

### Klub
Optional.

### Tým / kategorie
Optional.

### Pozice
Select from:

- Brankář
- Obránce
- Centr
- Levé křídlo
- Pravé křídlo
- Univerzál

### Hůl
Select:

- Levé
- Pravé
- Nevím

### Číslo dresu
Optional.

Do not use free text for Position or Stick side.

---

# 18. Multiple sports

Architecture supports several sport profiles per athlete.

The design must anticipate:

**Ivan Kotov**

Sport profiles:

`Lední hokej`

`Fotbal`

`+ Přidat sport`

However, do not over-emphasize this capability in the first hockey MVP.

The concept should simply fit naturally into athlete profile design.

---

# 19. Coach navigation

Coach interface should prioritize sessions.

Mobile navigation can contain:

### Tréninky

### Sportovci

### Více / Účet

Primary creation action should be clearly available:

**+ Trénink**

Also:

**+ Série tréninků**

Avoid putting both as permanent large buttons on every screen if it creates clutter.

A floating action button or contextual create button can be considered.

---

# 20. Coach — training list

Default view is a chronological list, not a calendar.

Example:

**Neděle 27. září**

`09:00–10:00`

`MH · Šatna 4`

`2017–2018`

**8 / 10**

Button:

**Detail**

Coach should be able to scan several trainings quickly.

Use date grouping.

---

# 21. Coach — session detail

This is the central operational screen.

Header:

`Neděle 27. září`

`09:00–10:00`

`Příbram · MH`

`Šatna 4`

`2017–2018`

Capacity:

**8 / 10**

Show main coach.

Show assistant coaches when present.

Then roster.

---

# 22. Coach roster

For each athlete show:

**Ivan Kotov**

`2017 · Centr · Levá hůl`

Optional:

`HC Škoda Plzeň`

Secondary information:

`Přihlásila Milana Kotova`

`27. 9. · 18:42`

Do not overload the default row.

Additional information can open in detail if necessary.

Coach must see who created the booking.

---

# 23. Coach actions

Session actions:

- Přidat sportovce
- Upravit trénink
- Duplikovat
- Zavřít přihlašování
- Zrušit trénink

Destructive action:

**Zrušit trénink**

must be visually separated from normal actions.

Do not make destructive actions overly easy to tap accidentally.

---

# 24. Coach manual athlete addition

Coach taps:

**Přidat sportovce**

Show eligible athletes.

When normal capacity is available:

normal confirmation.

When session is full:

show explicit warning:

**Trénink je již plný**

`10 / 10`

`Chcete sportovce přidat nad stanovenou kapacitu?`

Buttons:

**Zrušit**

**Přidat**

Make it obvious this is a deliberate override.

---

# 25. Capacity editing

Coach can change capacity.

If current occupancy = 8 and new capacity = 6:

show a warning before save:

**Na tento trénink je již přihlášeno 8 sportovců.**

`Nová kapacita je 6.`

`Stávající přihlášky zůstanou zachovány.`

Buttons:

**Zrušit**

**Přesto uložit**

Afterwards the UI may show:

**8 / 6**

Do not represent this as a broken/error state. It is an intentional supported condition.

---

# 26. Create training

Keep the form simple.

Fields:

### Datum
### Začátek
### Konec
### Místo
Příbram

### Hala
- MH — Malá hala
- VH — Velká hala

### Šatna
Optional.

### Kapacita
Default: 10.

### Pro koho?
- Všichni sportovci
- Ročníky

If Ročníky:
`Od: 2017`
`Do: 2018`

### Hlavní trenér

### Asistenti
Optional.

### Informace pro sportovce
Public notes.

### Interní poznámka
Coach/admin only.

Primary CTA:

**Vytvořit trénink**

---

# 27. Create training series

Screen:

**Série tréninků**

Use largely the same form as a single training.

Additional fields:

### Opakování
Example:
`Každou neděli`

### Od
### Do

Before final save show generated occurrence preview.

Example:

**Vytvoří se 9 tréninků**

4. 10.  
11. 10.  
18. 10.  
25. 10.  
...

Primary action:

**Vytvořit 9 tréninků**

Individual occurrences become independent after creation.

Do not design complex Google Calendar-like recurrence editing.

---

# 28. Duplicate training

From session detail:

**Duplikovat**

Open a prefilled Create Training screen.

The user primarily changes date/time.

Do not immediately duplicate on one tap.

---

# 29. Birth-year eligibility change

If coach changes the allowed years and existing athletes become outside the new range, show a specific warning.

Example:

**2 přihlášení sportovci nesplňují novou věkovou podmínku.**

`Jejich přihlášky zůstanou zachovány.`

`Dotčení rodiče budou upozorněni.`

Buttons:

**Zrušit**

**Přesto uložit**

---

# 30. Session cancellation

Use a confirmation dialog.

Title:

**Zrušit trénink?**

Text:

`Trénink zůstane v historii a všichni rodiče přihlášených sportovců obdrží e-mail.`

Buttons:

**Nezrušovat**

**Zrušit trénink**

The destructive action should require a deliberate decision.

Once cancelled, the session cannot be reopened.

---

# 31. Updated session

If a significant property changes after booking:

- date;
- start/end time;
- location;
- facility;
- main coach;

show an `ZMĚNĚNO` badge to affected users.

The updated value should be easy to see.

Do not require a separate change-history screen in MVP.

---

# 32. Changing room

Changing room is parent-visible.

Example:

`Šatna 4`

It may initially be absent.

If later added, it should naturally appear on the booking/session card.

No prominent alert is needed for changing-room-only updates.

---

# 33. Public vs internal notes

There are two different note concepts.

### Informace pro sportovce
Visible to guardians.

Examples:
`Přineste si láhev s vodou.`
`Sraz 15 minut před začátkem.`

### Interní poznámka
Visible only to coach/admin.

The UI must visually distinguish them to avoid accidental disclosure.

---

# 34. Admin — coach management

The admin must be able to manage coaches in the workspace.

For MVP, include an admin section:

### Trenéři

List coaches with:
- first name;
- last name;
- active/inactive status.

Primary action:

**+ Přidat trenéra**

Create coach form:

### Jméno *
### Příjmení *

Optional account/email invitation can be handled separately by the product flow; the core coach identity must at minimum support first name and last name.

Admin should be able to:
- add a coach;
- edit first name;
- edit last name;
- activate/deactivate a coach.

Do not hard-delete coaches who are referenced by past or future training sessions.

A coach should have a stable internal ID independent of display name.

Training creation/editing should use the coach list maintained by admin.

For a session:
- one coach is selected as **Hlavní trenér**;
- zero or more coaches can be selected as **Asistenti**.

Coach names shown to guardians should use:

`First name + Last name`

unless a later product decision introduces preferred display names.

The design should support multiple coaches even though the first Trainlio workspace may initially contain only one.

---

# 35. Status language

Use straightforward Czech.

Avoid technical database terminology.

Suggested user-facing labels:

DRAFT → `Koncept`  
OPEN → normal available state or `Otevřeno`  
CLOSED → `Přihlašování uzavřeno`  
CANCELLED → `Zrušeno`  
COMPLETED → generally show naturally under past sessions rather than emphasizing a status badge.

Booking statuses should similarly use human language.

---

# 36. Empty states

Design thoughtful empty states.

Examples:

### No upcoming trainings
**Momentálně nejsou vypsané žádné tréninky.**

### No bookings
**Zatím nemáte žádný nadcházející trénink.**

### No athletes
**Přidejte prvního sportovce a můžete začít rezervovat tréninky.**

CTA:
**Přidat sportovce**

### No coaches
**Zatím není přidaný žádný trenér.**

CTA:
**Přidat trenéra**

Avoid decorative empty states that consume most of the screen.

---

# 37. Loading and realtime

Occupancy may update while the user is looking at a screen.

Example:

`7 / 10 → 8 / 10`

The update should happen quietly.

Do not show disruptive notifications for ordinary occupancy updates.

If a user is in the booking flow and capacity changes so their request cannot be completed, show a clear state-specific message.

---

# 38. Error design

Errors should be human-readable.

Do not expose:

- SQL errors;
- RPC names;
- technical status codes.

Examples:

**Trénink je již obsazený.**
**Tento sportovec už je přihlášený.**
**Přihlášení již není možné.**
**Některý z vybraných sportovců už nesplňuje podmínky tréninku.**

---

# 39. Accessibility

Target:

- WCAG-conscious contrast;
- minimum comfortable touch area around 44×44 px;
- status must not rely on color only;
- buttons need text labels where possible;
- readable font sizes;
- form errors tied clearly to fields;
- visible keyboard focus states.

---

# 40. Responsive desktop coach/admin interface

Desktop coach/admin view can use more space.

Possible layout:

Left/main area:
training list, coach list or session roster.

Right contextual panel:
session details/actions or edit form.

But do not introduce a large enterprise sidebar unless it genuinely improves navigation.

The mobile architecture remains the primary source of truth.

---

# 41. Design system

Please define:

### Colors
- primary brand;
- neutral palette;
- success;
- warning;
- destructive;
- information/update.

### Typography
- page headings;
- section headings;
- body;
- labels;
- metadata.

### Components
- buttons;
- inputs;
- select;
- date/time inputs;
- checkbox;
- radio;
- bottom sheet;
- dialog;
- badge;
- training card;
- athlete card;
- coach card/row;
- roster row;
- empty state;
- toast;
- bottom navigation.

### States
Every interactive component should include:
- default;
- pressed;
- focus;
- disabled;
- loading;
- error where applicable.

---

# 42. Do not over-design the multi-sport architecture

The backend is multi-sport.

The first UI is primarily hockey.

Do not add:
- sport marketplace;
- global sports selector;
- sport discovery;
- complex workspace switching;
- coach marketplace.

Those are future possibilities, not MVP requirements.

The architecture should accommodate them, but the current interface should remain focused.

---

# 43. Screens to design first

Produce designs for these screens first:

### Guardian
1. OTP login
2. Available trainings
3. Athlete selection / booking bottom sheet
4. My bookings — upcoming
5. My bookings — cancelled / updated states
6. Athlete list
7. Athlete profile
8. Create/edit athlete
9. Account

### Coach
10. Training list
11. Session detail / roster
12. Create training
13. Edit training
14. Create recurring series
15. Manual athlete addition
16. Capacity override dialog
17. Capacity-reduction warning
18. Eligibility-change warning
19. Cancel-session dialog

### Admin
20. Coach list
21. Add coach
22. Edit coach

---

# 44. Deliverables

Before implementation, provide:

1. visual direction;
2. proposed design tokens;
3. mobile navigation;
4. wireframes for the main guardian flow;
5. wireframes for the main coach flow;
6. lightweight wireframes for coach administration;
7. high-fidelity designs for the most important screens;
8. reusable component inventory;
9. responsive behavior notes;
10. interaction/state specifications;
11. any UX problems found in the current requirements.

Do not change business rules simply to make the UI easier.

If a requirement creates a meaningful UX conflict, explicitly flag it.

---

# 45. Primary flows that must feel excellent

Prioritize these above everything else:

### Guardian
Open app → see training → select child → book.

### Guardian
Open My Bookings → understand where/when training is → cancel when allowed.

### Coach
Open app → immediately understand today's/upcoming trainings and occupancy.

### Coach
Open training → see roster.

### Coach
Create several recurring trainings quickly.

### Coach
Make a schedule change and clearly understand who will be notified.

### Admin
Open coach management → add/edit a coach quickly → coach becomes available for session assignment.

---

# 46. Product personality

Trainlio should make scheduling sports training feel organized without making sport feel bureaucratic.

The interface should disappear behind the task.

A successful design is one where a parent rarely needs instructions, a coach can operate it between training sessions from a phone, and an admin can maintain the coach roster without needing a complex back office.
