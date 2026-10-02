# Answers to `DESIGN_REQUESTS.md` (handoff v3)

Answer to the requests written 2 October 2026. Every entry says what was decided and where it lives. Move the decided ones into `docs/DESIGN_DEVIATIONS.md` / the specs as your process requires. The only things still open are listed at the end.

## A. Shipped without a design

| DR | Answer | Where |
|---|---|---|
| **DR-01** Coach `Sportovci` tab | Designed. Grouped by birth year, sorted by last name, with search (always visible) and year chips. Row: avatar, name, `{position} · {n} nadcházející`. Inactive athletes in a separate group at the bottom. **A row opens a new read-only athlete screen** with the sport profile, guardians (call/SMS), the internal note (the only thing a coach edits) and upcoming/past trainings. No deactivation or profile editing by the coach. | coach/SPEC K12, K13 · DS §6.27, 6.28, 6.31 |
| **DR-02** Coach past trainings | Becomes a proper `Nadcházející / Minulé` segmented control, as for the parent. A past row shows `{n} přihlášených` (plural rules), **no meter**. Newest first, no FAB. | coach/SPEC K1, K14 |
| **DR-03** Series list | Lives under `Více › Plánování › Série tréninků`. Card: weekday badges, time, place/years, range, `{total} tréninků, zbývá {n}`. Groups `Probíhající / Ukončené`, plus an empty state. A row opens a **filtered list** of that series' trainings with a note that the series cannot be edited as a whole. | coach/SPEC K15, K15b, K16 · admin/SPEC A0 · DS §6.29 |
| **DR-04** Removed booking, no way back | D-06 kept: the parent cannot re-book. G4b card footer: info icon + `Znovu přihlásit může jen trenér`, no button. G6d footer: coach avatar, the same sentence, coach name + phone, and two buttons `Zavolat` / `Napsat SMS`. Without a coach phone, only the sentence and the name. This needs a new optional `Coach.phone`. | guardian/SPEC G4b, G6d · admin/SPEC A2/A3 · coach/SPEC K0 |
| **DR-05** E-mails | One template and eight events (the seven listed + E08). Details are always a block; a changed value is highlighted with the old one struck through under it; several children in one e-mail; every e-mail links into the app (screen per event); no web font; readable with images blocked; plain text with identical content. | shared/EMAILS.md · emails/*.html |
| **DR-06** Components without a DS entry | Stepper → §6.11 updated (typing, clamp on blur). Radio pills → §6.25 ChoiceGrid. Six-box code → §6.26 CodeInput. Switch → §6.24. Tab bar and icons → §6.17 updated (longest-prefix rule confirmed, icon list). Picker sheets → §6.13 "Picker sheet" + §6.27 SearchField. | shared/DESIGN_SYSTEM.md |

## B. Nothing designed, nothing built

| DR | Answer | Where |
|---|---|---|
| **DR-07** Inviting a coach | Designed end to end. A2 gets `E-mail` (for sign-in) + `Telefon`; the button becomes `Přidat a poslat pozvánku`. A1 shows the badges `Pozván` / `Bez přístupu`. A3 has three access states (signed in / invited + resend at most once an hour / no e-mail). Invitation e-mail A6. First sign-in screen K0. **Invitations never expire**: sign-in is always a code, so an invitation that is never accepted simply stays `Pozván`. | admin/SPEC A1–A3c, A6 · coach/SPEC K0 · DS §6.30 |
| **DR-08** Admin rights in the UI | Yes, in A3 (section `ROLE`, switch `Administrátor`). The last admin cannot lose the role: the switch is disabled with an explanation, and the server returns `LAST_ADMIN`. Revoking your own role requires a confirmation sheet. Deactivating a coach also revokes the role. | admin/SPEC A3, A3d, A3e |
| **DR-09** Changing e-mail | Stays out (product decision). If it returns, it will be designed as a two-code flow, not from the old G14. | — |
| **DR-10** Second sport | Later. Keep `+ Přidat sport` hidden. | — |
| **DR-11** Language / dark mode | Language stays hidden. Dark mode stays **off** until a dedicated dark palette is designed; do not bind the `dark:` variant to anything. | — |

## C. One decision each

| DR | Decision |
|---|---|
| **DR-12** Parent informed about a coach booking? | **Yes**, e-mail E08 `BOOKING_ADDED_BY_COACH` with the cancellation deadline. |
| **DR-13** iPhone photos | **Accept HEIC/HEIF and convert to JPEG in the browser.** While converting: `Převádím fotku…`. On failure: `Fotku se nepodařilo převést. Zkuste ji nahrát jako JPG.` The 5 MB limit applies before conversion. |
| **DR-14** Confirmations 1–9 | **All nine confirmed** as built: logo in the coach header; public note only on the detail; `Od ročníku / Do ročníku`; parent surname optional; all active guardians on the roster; Czech routes; reopening registration allowed; out-of-range athletes cannot be added manually; removed/cancelled bookings move to Minulé at `end_at`. |

## Still open

- Deactivating a coach who is the main coach of future sessions: warn only (current) or force reassignment? (admin/SPEC §5)
- DR-09, DR-10, DR-11: deferred, as above.
