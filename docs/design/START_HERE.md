# Start here: how to hand this to Claude Code

## 1. Put the handoff into the repo
Unzip `trainlio-handoff.zip` and replace the `docs/design/` folder in the repository with it, so that `docs/design/README.md` exists. Commit that on its own: `docs: design handoff v3.5`.

## 2. Give Claude Code the tasks one at a time, in this order
Paste the whole file content into Claude Code. When it finishes and the tests are green, review it, then paste the next one.

| # | File | What it builds |
|---|---|---|
| 1 | `CLAUDE_CODE_TASK_logo.md` | Organization logo, monogram fallback (admin + login + header) |
| 2 | `CLAUDE_CODE_TASK_v3.md` | Answers to DESIGN_REQUESTS: coach athletes, past trainings, series, invitations, admin role, e-mails, HEIC… |
| 3 | `CLAUDE_CODE_TASK_assistants.md` | Edit permission, "Moje" filter, read-only mode (`canEdit(session)`) |
| 4 | `CLAUDE_CODE_TASK_v3.4.md` | Attendance + payment in the roster, the K13 player card with tabs, coach notes and messages, main coach deactivation, parent attendance, app icon |
| 5 | `CLAUDE_CODE_TASK_v3.5.md` | Statistics (K20/K20b) and the `Sezóna` period (1 Aug – 31 Jul) |

Skip any step that is already done in the code. Claude Code should check `docs/DESIGN_DEVIATIONS.md` first.

## 3. One line you can paste when unsure
```
docs/design/ is the design handoff. Read docs/design/START_HERE.md and docs/design/README.md, check what is already implemented, then continue with the next task file from the table. Small commits, tests green, ask me when something is ambiguous.
```

## 4. Where things are
- Binding decisions: `README.md`, decisions 1–48 (the later number wins if two decisions conflict)
- Specs per role: `guardian/`, `coach/`, `admin/SPEC.md`
- Components and tokens: `shared/DESIGN_SYSTEM.md`, `shared/tokens.css`
- E-mails: `shared/EMAILS.md` + `emails/*.html`
- App icon: `shared/app-icon/`
- Clickable prototypes: `*/prototype.html` (open in a browser)
- Source of every screen: `design-source/screens/`
