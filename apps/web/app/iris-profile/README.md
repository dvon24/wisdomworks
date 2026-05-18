# /iris-profile — "What Iris Has Learned About You"

Drop this entire folder into `apps/web/app/iris-profile/` and the route is live.

## Files

| File | Role |
|---|---|
| `page.tsx` | Route entry (`default export Page()`). Thin wrapper around `<IrisProfile />`. |
| `IrisProfile.tsx` | Main client component — owns fetch state, dismiss state, layout. |
| `RuleCard.tsx` | One disposition rule with confidence bar + dismiss button. |
| `AgentCard.tsx` | Collapsible operating manual for one agent. |
| `KpiBand.tsx` | 4-tile summary band at the top. |
| `types.ts` | TS types matching the `GET /api/iris-profile` response. |
| `styles.module.css` | Co-located scoped styles. |

All components are client components (`'use client'`) because dismissing rules uses optimistic `useState`.

## Data flow

1. `IrisProfile` resolves the tenant phone in this order:
   1. explicit `phone` prop (if you wrap the page),
   2. `?phone=` URL search param,
   3. nothing — API resolves owner from session cookie.
2. `GET /api/iris-profile[?phone=...]` is fetched on mount and on `↻ Refresh`.
3. The `↻ Refresh` button calls the same fetch.

## Dismiss flow

1. User clicks **Dismiss** on a rule card.
2. The card's id is added to `dismissingIds` → the `.dismissing` CSS class plays a 380ms fade-out.
3. After 380ms, the rule is removed from local state and the KPI band decrements.
4. In parallel, `POST /api/iris-profile/dismiss-rule` is fired with `{ rule_id }`.
5. On HTTP error, the timer is cleared, the rule stays in state, and an error banner appears. `load()` re-fetches to resync.

## Design tokens used (NOT redefined here)

The component references existing global CSS by name. Make sure these classes / vars exist in your global stylesheet (they already do in `apps/web/app/page.tsx`'s deck system):

**CSS variables**

```
--text
--text-dim
--text-faint
--accent
--accent-soft
--accent-line
--accent-deep
--glass-border
--glass-border-strong
```

**Global classes**

```
.glass
.glass-strong   (not used here, but referenced family-wide)
.mono
.pill           (+ .pill.dim, .pill.info, .pill.ok, .pill.warn, .pill.bad)
.pop-in
.breathe
```

If any of these are missing, the page still renders — it just won't look right.

## What I did NOT include (per request)

- Route registration (you wire it).
- API endpoints — `GET /api/iris-profile` already exists; `POST /api/iris-profile/dismiss-rule` will ship the same day.
- Auth wiring — the fetch uses `credentials: "include"`, your API handles the cookie.
- Tailwind config or new design tokens.

## Notes

- The page is **single-tenant per render**. There is no tenant switcher.
- The page is **read-only** with one mutation (dismiss). No bulk actions on purpose.
- All copy is in the components — search for the text directly to edit.
