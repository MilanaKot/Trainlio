# Trainlio — Admin (coach management) UI spec

Audience: Claude Code. Read `../shared/DESIGN_SYSTEM.md` first. Visual reference: `prototype.html` (A0–A3). Admin is a coach account with `isAdmin = true`; admin UI lives inside the coach app under the `Více` tab — no separate back office.

## 1. Routes

| Screen | Route | Access |
|---|---|---|
| A0 More | `/coach/more` | all coaches (section `Správa` only for admins) |
| A1 Coach list | `/coach/more/coaches` | admin |
| A2 Add coach | `/coach/more/coaches/new` | admin |
| A3 Edit coach | `/coach/more/coaches/[coachId]` | admin |

Non-admins hitting A1–A3 → redirect to `/coach/more` (server-side check + RLS).

## 2. Data

```ts
interface Coach {
  id: string;                 // stable internal ID, independent of name
  firstName: string;          // required
  lastName: string;           // required
  active: boolean;
  isAdmin: boolean;
  userId: string | null;      // linked auth account (invitation handled separately)
  assignedSessionsCount: number; // past + future, for A3 helper text
}
```

Rules (brief §34):
- Admin can add a coach, edit first/last name, activate/deactivate.
- **No hard delete** of coaches referenced by sessions (no delete UI at all in MVP).
- Session create/edit pickers (coach K3b/K3c) list **active** coaches only; existing sessions keep inactive coaches visibly assigned.
- Guardian-facing coach name = `firstName + " " + lastName`.
- Must support multiple coaches even if the workspace has one.

## 3. Screens

### A0 · More (`/coach/more`)
H1 `Více`. Profile card: avatar 56, name 17/700, meta `Trenér · Administrátor` (or `Trenér`).
Caption `SPRÁVA` (admins only) → list row: icon + `Trenéři` + value `{count}` + chevron → A1.
Caption `ÚČET` → row `Osobní údaje a e-mail` (→ same account screens as guardian G13/G16/G14 patterns).
Button (white, danger text) `Odhlásit se z aplikace` + confirm dialog.
Bottom nav: `Tréninky`, `Sportovci`, `Více` (active).

### A1 · Coach list (`/coach/more/coaches`)
Back `‹ Více`. Header row: H1 `Trenéři` + primary md button `+ Přidat trenéra` (→ A2).
Caption `AKTIVNÍ · {n}` → list rows (64 px, avatar 40, name 16/600, optional meta `Administrátor`, chevron) → A3.
Caption `NEAKTIVNÍ · {n}` (only if > 0) → muted rows: neutral avatar, muted name, meta `Nezobrazuje se při výběru trenérů`, neutral badge `Neaktivní`, chevron.
Sort: last name, then first name (Czech collation `Intl.Collator("cs")`).
Empty: EmptyState `Zatím není přidaný žádný trenér.` + `Přidat trenéra`.

### A2 · Add coach (`/new`)
Top `Zrušit`; title `Nový trenér`. Panel: `Jméno *`, `Příjmení *` (required marker in danger; `required`, `aria-required`). Error example: empty last name → `Vyplňte příjmení.` (and `Vyplňte jméno.`). Helper below panel: `Trenér bude hned k dispozici při výběru hlavního trenéra a asistentů. Pozvánku do aplikace e-mailem lze poslat později.`
Footer primary lg `Přidat trenéra` → create (active = true) → A1 + toast `Trenér přidán`.
Validation (Zod): trimmed 1–50 chars each; warn (not block) on exact duplicate name: inline notice `Trenér se stejným jménem už existuje.`

### A3 · Edit coach (`/[coachId]`)
Top `Zrušit`; title `Upravit trenéra`. Panel: `Jméno *`, `Příjmení *`.
Caption `STAV` → panel: switch row `Aktivní trenér` / sub `Lze ho vybrat pro nové tréninky` (switch 52 × 32, success when on; real `<input type="checkbox" role="switch">`). Info box (bg): `Po deaktivaci zůstane {name} u všech minulých i naplánovaných tréninků (nyní {count}). Trenéra nelze smazat, jen deaktivovat.`
Footer `Uložit` → toast `Uloženo` → A1.
Renaming updates the name everywhere (sessions reference the stable ID).
Deactivating a coach who is main coach of future sessions: allowed; show extra warning Notice before save: `{name} je hlavním trenérem {n} naplánovaných tréninků. Zůstane u nich uveden.` (open question: should it block or prompt reassignment?).
An admin cannot deactivate themselves or remove the last active admin (disable switch + helper `Nemůžete deaktivovat sám sebe.`).

## 4. Acceptance tests
1. Add coach → appears under Aktivní and in K3b/K3c pickers immediately.
2. Deactivate → moves to Neaktivní; not in pickers; still shown on existing sessions.
3. Rename → new name shown in guardian G6 for sessions where the coach is assigned.
4. No delete action exists anywhere.
5. Non-admin cannot open A1–A3 (server redirect + RLS denies writes).

## 5. Open questions
- E-mail invitation flow for coaches (brief: handled separately).
- Behaviour when deactivating a main coach of future sessions (warn vs. force reassignment).
- Can admins grant/revoke admin rights in MVP? (not designed; assume DB-only).
