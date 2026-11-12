# Task for Claude Code — organization logo (handoff v2)

Paste this into Claude Code from the repo root. Assumes the handoff folder lives at `docs/design/` (adjust paths if not).

---

The design handoff in `docs/design/` was updated (see "Changelog" in `docs/design/README.md`). Implement the **organization logo** feature. Read these first, in this order:

1. `docs/design/README.md`: binding decisions 20–22.
2. `docs/design/shared/DESIGN_SYSTEM.md` §6.23 OrgLogo.
3. `docs/design/admin/SPEC.md`: `Organization` type, A0 row, A4 / A4b / A5, file rules, tests 6–10.
4. `docs/design/guardian/SPEC.md`: updated G11 (login header + "Běží na trainlio" footer), updated G1 header, test 10.
5. Visual reference: `admin/prototype.html` (group "Organization") and `guardian/prototype.html` (group "Organization branding"). The specs win if they differ from the prototypes.

## Scope

**Database / Supabase**
- Migration: add `name`, `short_name`, `logo_path`, `logo_background` (`'white' | 'transparent'`, default `'white'`) and `logo_updated_at` to the organization table (create the table if it doesn't exist, seeded with `Hokejová škola Příbram`).
- RLS: everyone in the org can read; only admins of that org can update.
- Storage bucket `org-logos`: public read; insert/update/delete only for admins of the org, with the key prefix `{orgId}/`.
- Regenerate the Supabase types.

**Shared UI**
- `components/ui/OrgLogo.tsx`: sizes 28/36/56/72/96, white plate or transparent mode, and a monogram fallback. The monogram is built by `lib/org.ts#orgInitials(name)`, which uses `toLocaleUpperCase("cs")` and keeps diacritics. If the image fails to load, show the monogram.
- Unit tests (Vitest):
  - `orgInitials`: `Hokejová škola Příbram` → `HŠ`, `Sportovní klub Dobříš` → `SK`, `Slavia` → `SL`, extra whitespace.
  - `OrgLogo`: renders the image vs the monogram; the correct `alt` / `aria-hidden`.

**Admin**
- A0: add the `Organizace` row (OrgLogo 28, value `Logo a název`). Show it to admins only, above `Trenéři`.
- `/coach/more/organization` (A4 / A4b): the state depends on `logoPath`. The name field is required and the short name is optional. The monogram updates live while the name is typed. `Odebrat logo` asks for confirmation in a Dialog.
- A5 bottom sheet: square crop (drag, pinch, `Velikost` slider 50–150 %), `Pozadí loga` Bílé / Průhledné, and a live preview at 36 and 56.
  - The crop is done client-side on a canvas and exported as a 512×512 PNG.
  - SVG is rasterized in the browser. Never store or serve a user's SVG.
  - Use a small, well-maintained crop library, or write a minimal one yourself. Don't pull in heavy dependencies.
- Server action with Zod: PNG / JPEG / SVG, max 2 MB, raster at least 256×256. Use the Czech error messages from the spec, verbatim.
  - Upload goes to `{orgId}/{uuid}.png`. On `Uložit`, update the row and `logo_updated_at`, then delete the previous object.
- Non-admins opening `/coach/more/organization` are redirected server-side to `/coach/more`.

**Guardian**
- G11 login: replace the trainlio wordmark with OrgLogo 72, the org name and `Rezervace tréninků`. Pin the footer `Běží na trainlio` to the bottom.
- G1 `Tréninky`: add the header row (OrgLogo 36 + org name with ellipsis + `Lední hokej · Příbram`) above the H1. Other tabs stay unchanged.
- Load the org data in a server component (layout) and cache it. Serve images through `next/image` with `?v={logoUpdatedAt}`.

**E-mails** (if templates already exist): show the logo in the header, or just the org name as text when there is no logo (no monogram in e-mails).

## Out of scope

- Logo in the coach app header.
- Multiple organizations / switching between them.
- Colour theming from the logo.

## Done when

- Admin tests 6–10 (`admin/SPEC.md` §4) and guardian test 10 (`guardian/SPEC.md` §6) pass in Playwright at a 390×844 viewport.
- Axe shows no serious violations on A4, A5 and G11.
- `tsc --noEmit`, lint and Vitest are green.
- Show me screenshots of A4 (with logo), A4b (without logo), G11 and G1 in both states.

Work in small commits: migration + RLS → OrgLogo + tests → admin A4/A5 → guardian G11/G1 → e-mails → Playwright tests. If something in the spec is ambiguous (see "Open questions" in `admin/SPEC.md`), ask me instead of guessing.
