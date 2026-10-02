# Trainlio — Admin (coach management & organization) UI spec

Audience: Claude Code. Read `../shared/DESIGN_SYSTEM.md` first. Visual reference: `prototype.html` (A0–A6, incl. A3b–A3e). Admin is a coach account with `isAdmin = true`; admin UI lives inside the coach app under the `Více` tab — no separate back office.

## 1. Routes

| Screen | Route | Access |
|---|---|---|
| A0 More | `/coach/more` | all coaches (section `Správa` only for admins) |
| A1 Coach list | `/coach/more/coaches` | admin |
| A2 Add coach | `/coach/more/coaches/new` | admin |
| A3 Edit coach | `/coach/more/coaches/[coachId]` | admin |
| A4 / A4b Organization | `/coach/more/organization` | admin |
| A5 Adjust logo | bottom sheet on A4 (client state, not a route) | admin |

Non-admins hitting A1–A4 → redirect to `/coach/more` (server-side check + RLS).

## 2. Data

```ts
interface Coach {
  id: string;                 // stable internal ID, independent of name
  firstName: string;          // required
  lastName: string;           // required
  active: boolean;
  isAdmin: boolean;           // = workspace_role WORKSPACE_ADMIN (v3: editable in A3)
  userId: string | null;      // linked auth account, set on first sign-in
  email: string | null;       // v3: sign-in e-mail; null → "Bez přístupu"
  phone: string | null;       // v3: optional; shown to guardians only in G6d
  invitedAt: string | null;   // v3: last invitation e-mail sent
  firstSignInAt: string | null; lastSeenAt: string | null; // v3
  assignedSessionsCount: number; // past + future, for A3 helper text
}
// derived access state (v3, DR-07)
type CoachAccess = "no_email" | "invited" | "signed_in";
// no_email: email == null · invited: email != null && firstSignInAt == null · signed_in: firstSignInAt != null
```

```ts
interface Organization {
  id: string;
  name: string;                 // required, 2–80 chars, e.g. "Hokejová škola Příbram"
  shortName: string | null;     // optional, ≤ 24 chars, e.g. "HŠ Příbram" — used where the full name does not fit
  logoPath: string | null;      // Supabase Storage key in bucket `org-logos`; null → monogram
  logoBackground: "white" | "transparent"; // default "white"
  logoUpdatedAt: string | null; // ISO; used as cache-buster (?v=)
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
Caption `PLÁNOVÁNÍ` (all coaches, v3) → row with calendar icon `Série tréninků` + value `{running series}` + chevron → coach K15.
Caption `SPRÁVA` (admins only) → row `Organizace` with OrgLogo 28 as icon + value `Logo a název` + chevron → A4; then row: icon + `Trenéři` + value `{count}` + chevron → A1.
Caption `ÚČET` → row `Osobní údaje a e-mail` (→ same account screens as guardian G13/G16/G14 patterns).
Button (white, danger text) `Odhlásit se z aplikace` + confirm dialog.
Bottom nav: `Tréninky`, `Sportovci`, `Více` (active).

### A1 · Coach list (`/coach/more/coaches`)
Back `‹ Více`. Header row: H1 `Trenéři` + primary md button `+ Přidat trenéra` (→ A2).
Caption `AKTIVNÍ · {n}` → list rows (64 px, avatar 40, name 16/600, meta, optional badge, chevron) → A3. Meta/badge by access state (v3):
- `signed_in` → meta `Administrátor` (if admin) or none, no badge;
- `invited` → meta `Ještě se nepřihlásil` + warning badge `Pozván`;
- `no_email` → meta `Chybí e-mail` + neutral badge `Bez přístupu`.
Badges `white-space: nowrap`, never wrap.
Caption `NEAKTIVNÍ · {n}` (only if > 0) → muted rows: neutral avatar, muted name, meta `Nezobrazuje se při výběru trenérů`, neutral badge `Neaktivní`, chevron.
Sort: last name, then first name (Czech collation `Intl.Collator("cs")`).
Empty: EmptyState `Zatím není přidaný žádný trenér.` + `Přidat trenéra`.

### A2 · Add coach (`/new`)
Top `Zrušit`; title `Nový trenér`. Panel: `Jméno *`, `Příjmení *` (required marker in danger; `required`, `aria-required`). Errors: `Vyplňte příjmení.` / `Vyplňte jméno.`
**v3:** caption `KONTAKT` → panel: `E-mail` (label suffix `Pro přihlášení`, type email, helper `Pošleme sem pozvánku. Bez e-mailu se trenér do aplikace nepřihlásí.`) and `Telefon` (suffix `Nepovinné`, type tel, helper `Rodiče ho uvidí, když trenér jejich dítě odhlásí z tréninku.`). E-mail is optional but recommended; invalid → `Zadejte platný e-mail.`; already used by another coach/guardian → `Tento e-mail už v aplikaci používá někdo jiný.`
Helper below: `Trenér bude hned k dispozici při výběru hlavního trenéra a asistentů, i když se ještě nepřihlásil.`
Footer primary lg: `Přidat a poslat pozvánku` when e-mail is filled, otherwise `Přidat trenéra` → create (active = true; send invitation A6 if e-mail) → A1 + toast `Trenér přidán` / `Trenér přidán, pozvánka odeslána`.
Validation (Zod): trimmed 1–50 chars each; warn (not block) on exact duplicate name: inline notice `Trenér se stejným jménem už existuje.`

### A3 · Edit coach (`/[coachId]`)
Top `Zrušit`; title `Upravit trenéra`. Panel: `Jméno *`, `Příjmení *`.
**v3 — caption `PŘÍSTUP DO APLIKACE`** → panel: status Notice + `E-mail` field (+ actions). Three states:
- **A3 · `signed_in`:** success-soft status, check icon, `Přihlášen` + `Naposledy v aplikaci {d. m.} v {HH:MM}` (own card: `To jste vy`). Changing the e-mail here changes the sign-in address after save (next sign-in uses the new one).
- **A3b · `invited`:** warning-soft status, clock icon, `Čeká na první přihlášení` + `Pozvánka odeslána {d. m.} v {HH:MM}`. Outline md button `Poslat pozvánku znovu` (mail icon) + helper `Znovu lze poslat nejdřív za hodinu. Změníte-li e-mail, pošle se nová pozvánka po uložení.` Rate limit 1/h per coach (button disabled with that helper while limited). Toast `Pozvánka odeslána`.
- **A3c · `no_email`:** neutral status, lock icon, `Bez přístupu` + `Bez e-mailu se trenér nemůže přihlásit. U tréninků ho přesto můžete uvádět.` E-mail field empty (focused in the design); `Poslat pozvánku` disabled until a valid e-mail is typed; saving with an e-mail sends the invitation.
Invitations **do not expire** — sign-in is always a 6-digit code to the e-mail (no passwords), so the invitation is only a convenience link; an invited coach can sign in whenever. Unaccepted invitations simply stay `Pozván`.
**v3 — caption `ROLE`** (DR-08) → panel: Switch row `Administrátor` / sub `Spravuje trenéry, pozvánky a organizaci`. Rules (enforced server-side, the UI explains them):
- Any admin can grant/revoke admin to another coach (also to an `invited` coach — it applies after first sign-in).
- **The last admin cannot lose the role** — on own card when you are the only admin: switch on + disabled, Notice `Jste jediný administrátor. Práva si můžete odebrat, až je udělíte jinému trenérovi.` (A3d). Server returns `LAST_ADMIN` otherwise.
- Revoking **your own** role when another admin exists → BottomSheet confirm (A3e): title `Odebrat si práva administrátora?`, text `Přijdete o správu trenérů a organizace. Tréninky dál uvidíte a upravíte. Práva vám může vrátit jen {other admin}.`, primary `Odebrat práva` / outline `Ponechat`. After save → redirect to A0 (Správa section disappears).
- A deactivated coach cannot be admin (deactivation also revokes the role; last active admin cannot be deactivated).
Caption `STAV` → panel: switch row `Aktivní trenér` / sub `Lze ho vybrat pro nové tréninky` (switch 52 × 32, success when on; real `<input type="checkbox" role="switch">`). Info box (bg): `Po deaktivaci zůstane {name} u všech minulých i naplánovaných tréninků (nyní {count}). Trenéra nelze smazat, jen deaktivovat.`
Footer `Uložit` → toast `Uloženo` → A1.
Renaming updates the name everywhere (sessions reference the stable ID).
Deactivating a coach who is main coach of future sessions: allowed; show extra warning Notice before save: `{name} je hlavním trenérem {n} naplánovaných tréninků. Zůstane u nich uveden.` (open question: should it block or prompt reassignment?).
An admin cannot deactivate themselves or remove the last active admin (disable switch + helper `Sám sebe deaktivovat nemůžete.`, A3d).

### A6 · Invitation e-mail (DR-07)
Sent on A2 save (with e-mail), on A3b `Poslat pozvánku znovu`, and when an e-mail is added/changed on a not-yet-signed-in coach. Layout = the shared e-mail template (`../shared/EMAILS.md` §1). Subject `Pozvánka do aplikace · {org name}`. Body: H1 `Pozvánka do aplikace`; `Dobrý den, {admin} vás přidal jako trenéra do aplikace pro rezervace tréninků {org}. Uvidíte v ní své tréninky, kdo je přihlášený, a kontakty na rodiče.`; detail block `Jméno` / `Přihlašovací e-mail`; button `Přihlásit se do aplikace` → `/prihlaseni?email={email}` (prefilled; sends the code immediately); text `Po kliknutí vám pošleme jednorázový kód na tento e-mail. Heslo nepotřebujete. Přihlásit se můžete kdykoli — pozvánka nevyprší.`; fallback URL line; footer `Pozvánku jste nečekali? Tento e-mail ignorujte, bez přihlášení se nic nestane.`
After the first sign-in the coach sees K0 (coach spec).

### A4 · Organization — logo uploaded (`/coach/more/organization`)
Back `‹ Více`; H1 `Organizace`.
Caption `LOGO` → panel: OrgLogo 96 + column of buttons: outline md `Změnit logo` (opens file picker → A5) and text danger `Odebrat logo` (confirm Dialog `Odebrat logo?` / `Místo loga se zobrazí iniciály názvu.` / `Odebrat` + `Zrušit`; on confirm → A4b state). Helper: `PNG, SVG nebo JPG · nejlépe čtvercové, alespoň 256 × 256 px · max. 2 MB. Nejlépe vypadá logo s průhledným pozadím.`
Caption `NÁZEV` → panel: `Název organizace *` (required), `Krátký název` (label suffix `Nepovinné`, helper `Použije se tam, kde se celý název nevejde.`).
Footer primary lg `Uložit` → toast `Uloženo` → A0. Errors: empty name → `Vyplňte název organizace.`
**No "how parents will see it" preview block** — removed in review.

### A4b · Organization — no logo (same route, `logoPath = null`)
Same as A4, but the `LOGO` panel contains an upload drop zone (whole zone is a `<label>` wrapping a visually hidden `<input type="file" accept="image/png,image/svg+xml,image/jpeg">`): min-height 168, radius 16, bg `#F7F9FF`, dashed-look `inset 0 0 0 2px #C7D4FA`, 52 px icon tile, bold primary `Nahrát logo`, helper `PNG, SVG nebo JPG · čtvercové, min. 256 × 256 px · max. 2 MB`. Below: info row (bg) with OrgLogo 44 monogram + `Dokud logo nenahrajete, zobrazí se v aplikaci iniciály názvu.` Monogram updates live while typing the name.
Desktop: drag & drop onto the zone also works.

### A5 · Adjust logo (bottom sheet, opened after a file is chosen)
Title `Upravit logo`, close `×` (aria `Zavřít`).
Crop area 260 px high on a checkerboard (shows transparency); fixed square crop window 200 × 200 (radius 24, outside dimmed). Drag to move, pinch / slider to zoom.
`Velikost` slider (50–150 %, helper `Posunutím obrázek vycentrujete`), full-width 44 px touch height.
`Pozadí loga` SegmentedControl `Bílé` (default) / `Průhledné` → `logoBackground`.
Row `Náhled v aplikaci` with live OrgLogo 36 and 56.
Buttons: primary lg `Použít logo`; outline lg `Vybrat jiný soubor`.
On `Použít logo`: crop client-side in a canvas → export **512 × 512 PNG** (keeps transparency) → upload → A4 with the new logo; save happens with `Uložit` on A4 (or immediately — pick one and be consistent; recommended: upload immediately to a temp key, commit on `Uložit`).

File rules (validate client-side **and** in the server action with Zod):
- Types: PNG, JPEG, SVG. Max 2 MB. Min 256 × 256 px for raster (error `Logo je příliš malé. Nahrajte alespoň 256 × 256 px.`).
- Wrong type → `Tento formát nepodporujeme. Nahrajte PNG, SVG nebo JPG.`; too big → `Soubor je větší než 2 MB.`
- **SVG is rasterized to PNG in the browser** before upload (never serve user SVG — XSS risk).
- Storage: bucket `org-logos`, public read, write only for admins of that org (Storage RLS). Key `{orgId}/{uuid}.png`; delete the previous object after a successful save.
- Serve via `next/image` with `?v={logoUpdatedAt}` for cache busting.

## 4. Acceptance tests
1. Add coach → appears under Aktivní and in K3b/K3c pickers immediately.
2. Deactivate → moves to Neaktivní; not in pickers; still shown on existing sessions.
3. Rename → new name shown in guardian G6 for sessions where the coach is assigned.
4. No delete action exists anywhere.
5. Non-admin cannot open A1–A4 (server redirect + RLS denies writes, incl. Storage).
6. Upload PNG → A5 opens → `Použít logo` → `Uložit` → logo shows in A0 row, guardian G1 header and login.
7. Upload SVG → stored object is PNG 512 × 512.
8. `Odebrat logo` + confirm → monogram `HŠ` everywhere; old Storage object deleted.
9. 3 MB file / GIF / 100 × 100 PNG → correct error message, nothing uploaded.
10. Change name to `Sportovní klub Dobříš` → monogram becomes `SK` live and after save.
11. A2 with e-mail → invitation e-mail sent; A1 shows `Pozván`; coach signs in with the code → K0 → A1 no badge, A3 `Přihlášen`.
12. A2 without e-mail → A1 `Bez přístupu`; adding an e-mail in A3c and saving sends the invitation.
13. `Poslat pozvánku znovu` twice within an hour → second attempt disabled/refused.
14. Only admin opens own A3 → admin switch disabled with the explanation; API call to revoke returns `LAST_ADMIN`.
15. With two admins, revoking own role → confirmation sheet → after save the `Správa` section is gone from A0.

## 5. Open questions
- ~~E-mail invitation flow~~ → designed v3 (A2, A3–A3c, A6, coach K0).
- Behaviour when deactivating a main coach of future sessions (warn vs. force reassignment) — still open.
- ~~Admin rights in the UI~~ → designed v3 (A3 `ROLE`, A3d, A3e).
- ~~Org logo in the coach header~~ → yes (confirmed v3).
- E-mail templates: logo in the header when present, otherwise the organization name as text (no monogram in e-mails).
