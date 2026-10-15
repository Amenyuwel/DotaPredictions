---
target: admin side
total_score: 23
max_score: 40
na_heuristics: 
p0_count: 2
p1_count: 3
target_identity: "file:C:\\Users\\Amenyuwel\\Desktop\\Projects\\DotaPredictions\\client\\src\\pages\\admin.tsx"
target_fingerprint: "sha256:35ae0f7e6c6a4e47192f89875baa38716d96e856608475db5b9a7c3b961d4607"
target_path: "C:\\Users\\Amenyuwel\\Desktop\\Projects\\DotaPredictions\\client\\src\\pages\\admin.tsx"
timestamp: 2026-10-15T00-13-02Z
slug: client-src-pages-admin-tsx
---
Method: dual-agent (A: design review · B: detector evidence). Source-only: no browser tool, page behind Supabase sign-in.

## Design Health Score: 23/40 (Acceptable)

| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | Visibility of system status | 3 | lastSavedAt never shown; publish dialog closes before request resolves, no "vN is live" |
| 2 | Match system / real world | 3 | Raw stage key ("Publish to main", type "main"); errors read "PUT /api/... -> 409" |
| 3 | User control and freedom | 2 | Stage switch + "Load into draft" silently destroy edits; no beforeunload |
| 4 | Consistency and standards | 2 | Five "changed" markers; two "no data" badge variants; Undo styled destructive |
| 5 | Error prevention | 3 | Emptied number commits 0; free-text colour lists; bad ids silently dropped |
| 6 | Recognition vs recall | 2 | Publish shows a count, not the changes; nav/tabs carry no "has edits" marker |
| 7 | Flexibility and efficiency | 1 | No Ctrl+S; type-name gate on reversible removals; filter matches key only |
| 8 | Aesthetic and minimalist | 2 | Heavy prose; traits table states the rule three times per row |
| 9 | Error recovery | 2 | Server `reason` dropped; export failure unhandled; history error no retry |
| 10 | Help and documentation | 3 | Inline hints present, over-supplied |

## Design specificity
Behaviour is product-specific (server-only preview, gated publish, cascade counts, percent units, hidden-team count). Surface is stock shadcn rail+cards+tables; colours printed as bare words, no weave swatches. Detector: 0 findings (regex-only on TSX). Mechanical: text-2xs (11.2px) used for prose in 11 places; tables lack accessible names.

## Priority issues
- [P0] Enter in an edit dialog drops the value just typed (cells commit on blur; form submits stale draft). edit-dialog.tsx, cells.tsx
- [P0] Clearing a number field commits 0 (Number("") === 0). cells.tsx:62
- [P1] Edits destroyed without guard: stage switch, Load into draft, tab close. admin.tsx, history-panel.tsx, use-draft.ts
- [P1] Roster edit dialogs write no-op/stale overrides (team always writes both fields; player spreads old entry over new, cannot clear). roster-editor.tsx:599-639
- [P1] Publish dialog shows a count, not the change; closes before success; errors land elsewhere. publish-dialog.tsx, admin.tsx
- [P2] Alarm red on routine dirty state; transport-log error headlines; Undo styled destructive. admin-sidebar.tsx:161, admin-api.ts:90, undo-dialog.tsx

## Persona red flags
- Alex: Enter bug; no Ctrl+S; typing names for reversible removals; stats filter misses labels.
- Sam: team-list dot and no-data count are title-only; Alert role=alert on non-urgent notes; focus lost after publish.
- Maintainer on phone: 28px inputs; stand-in silently Core/Carry; errors render off-screen at top.

## Minor
colSpan 6 on 5-col table; "What that means" column duplicates rule; Names in Space Grotesk via CardTitle/DialogTitle; "Add" vs "Add stat"; "team Spirit" chip; live date without time; filter count has no noun; number inputs change on scroll wheel.
