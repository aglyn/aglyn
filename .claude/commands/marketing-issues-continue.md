---
description: "STALE 2026-08-08 handoff — its promotion routine and last-promotion SHA are corrected; AGL-1288 was CANCELED, not a bug. Use /handoff for the current queue."
---

> ⚠️ **CORRECTED 2026-08-14 (AGL-1704).** A dated 2026-08-08 session handoff. For
> the current promotion flow and working agreements read
> `.claude/commands/handoff.md`; where it disagrees, it wins. Fixed below: the
> **"Working agreements"** section described promotions as a per-session routine —
> **promotion needs Zach's word and you never open a production PR unasked** — its
> "last promotion" SHA is long stale, and **AGL-1288 was CANCELED**: `div#S:0` is
> Next's streaming slot, not duplicate content.

> ⚠️ **CHARTER OVERRIDE (Zach, 2026-08-08) — supersedes anything below that
> says otherwise.** The marketing site is built by CLICKING in the besigner, in
> Zach's authenticated browser, exactly as a no-code subscriber would: screens,
> layouts, reusable components, templates, the attribute/style panels. **No JSON
> Editor, no Raw Markup, no custom CSS/sx, and no admin scripts that write node
> data.** When the styles panel can't express something, the answer is a new
> user-friendly style form field component (file it as a `Gap ·` issue), not a
> workaround. One-shot scripts are not committed. The full charter is in the
> Linear project description and in memory as `project_marketing_site_charter`.
> In particular, ignore any "you do not need the besigner / use an admin script"
> guidance below — that drift is exactly what this banner corrects.
> Also rescinded (AGL-1302): the all-routes `while read p; do curl` republish sweep
> — it forced ~40 Firestore reads per render and burned 87% of the daily free tier.
> Verify ONE route; use POST /api/screens/revalidate for layout-wide invalidation.

Continue working the **Marketing site on Aglyn** issue queue. Everything below is
verified as of 2026-08-08 — the traps are the expensive part, read them first.

Coordinates: org `aglyn-org` (`jWmGooWE3L`) · host slug **`aglyn-marketing`**, id
**`DXnRbPH4CQ`** · live **`https://aglyn.com`** · console `https://app.aglyn.com`
Figma `UsUolmsFgfymhaKMLBZvzo` — desktop Pricing frame `77:38`, mobile `247:3566`.

---

# THE BIG ONE: you do not need the besigner

Editing node data through the besigner UI cost most of a session and produced two
corrupt saves. **Do it with an admin script instead.** Three already exist and are
the template for anything new:

```bash
node tools/scripts/backfill-scheme-dark.mjs --host=DXnRbPH4CQ          # dry run
node tools/scripts/fix-blog-entry-h1.mjs   --host=DXnRbPH4CQ
node tools/scripts/fix-cta-gradient.mjs    --host=DXnRbPH4CQ
```

All are **dry run by default**, idempotent, and print intermediate counts. Add
`--apply` to write. Copy one wholesale when you need a new data fix.

Non-negotiables any such script must keep:

- **`nodes` has TWO storage forms** — a plain Firestore map AND msgpack bytes. Live
  counts are **map 16, msgpack 56**. A map-only script silently skips 56 of 72
  documents and reports success. Decode by form, write back in the SAME form.
- **Report scanned / per-form / candidates / changed as separate numbers.** "0
  changed" alone is indistinguishable from "decoded nothing".
- **Cover parent docs AND `versions/`**, across `screens`, `layouts`, `components`,
  `templates`. The tenant renders the version the screen's `versionId` points at;
  the shared layout carries nav and footer.
- **Dry run first, always.** It has caught two would-be disasters: promoting the
  blog *list* card title to `<h1>` (a dozen `h1`s on `/blog`), and feeding theme
  tokens to a colour parser (`text.primary → #NaNNaNNaN`, ×929).

## Publishing — also no session needed
The tenant page is `revalidate = 60`. **ISR republishes on its own.** Request each
route twice with a gap; the second read serves the new HTML.

```bash
while read -r p; do curl -s -o /dev/null "https://aglyn.com$p"; done < routes.txt
sleep 8
while read -r p; do curl -s -o /dev/null "https://aglyn.com$p"; done < routes.txt
```

The console's `POST /api/screens/revalidate` (Bearer + App Check, must run from a
page on `app.aglyn.com`) is only for *immediacy*. `{hostId, layoutId}` busts every
screen sharing a layout in one call.

---

# Open, in rough priority order

1. **AGL-1296 — `/pricing` desktop spacing.** Plans **+190**, Compare **+146**,
   Usage header **+28** and metered table **+130** vs frame `77:38`. Likely the same
   too-loose rhythm AGL-1294 found in the cards (type scale one step large). Hero
   −73 and part of Plans +190 are NOT drift — the billing toggle sits in `Plans` in
   the build and `Hero` in the design; it renders in the same place.
2. **AGL-1293 — brand blue fails AA.** `#0090d9` is 3.51:1 on white; theme
   `primary.main` `#00b0ff` is 2.43:1. `#0073ae` is the first value clearing AA.
   `#0090d9` is node data (~165 nodes, scriptable); `#00b0ff` is `console.theme.ts`
   and repaints every surface. **Zach's call.**
3. **AGL-1295 leftovers.** 19 colours were derived algorithmically, not chosen —
   `#f1f3f5` ×80, `#e6f5ff` ×62, `#fbe6fe`, `#e7f8ef`, `#fff1e0`. They pass AA;
   promoting the high-count ones into `BG_MAP` would put them under design control.
4. **Copy divergence.** Figma's toggle says "Annual · save 20%", live says "Annual ·
   save up to 35%". One is stale — probably the design. Ties to the owed
   `pricing-copy/` re-extraction (needs four `get_metadata` dumps, not committed).
5. ~~**AGL-1280** metered-billing framing · **AGL-1288** the `S:0` streaming slot.~~
   **Both closed (verified 2026-08-14): AGL-1280 is Done, and AGL-1288 was
   CANCELED — `div#S:0` is not duplicate content.** It is Next's streaming slot,
   and the tenant dev server renders the page twice, which is what made it look
   like every page shipped its content twice. Do not re-file it.

## Recently shipped — do not redo
AGL-1286 (compare table + `overflow: clip`), AGL-1117 (plan deep-links end to end),
AGL-1294 (plan cards 514 → 425 vs Figma 428), AGL-1295 (dark mode LIVE site-wide),
AGL-1291 (blog entry `h1`), CTA band back on paper per the design.

---

# Traps that cost real time

- **`content-visibility: auto` sections measure a PLACEHOLDER off-screen.**
  `/pricing`'s reservations are 3000/1500/800/500px. Measuring off-screen produced
  two entirely fabricated findings ("CTA +256", "FAQ +271"; truth is −2 and +34).
  Fix: set `contentVisibility:'visible'` + `containIntrinsicSize:'auto none'` in one
  call, measure in the **next**. Scrolling does not work — rAF is throttled in a
  hidden pane and the call times out.
- **Check the FIGMA side for trailing empty space too.** The Usage frame is 1092
  tall with content ending at y=550. Compare content blocks, not frame heights.
- **`<aglyn-text>` uses closed shadow roots.** A DOM contrast sweep sees ~17 of the
  page's text nodes. Use the **light-patch sweep** instead — find elements whose
  computed background is light while in dark; backgrounds sit on ordinary elements.
- **Driving `app.aglyn.com` in real Chrome LOGS THE USER OUT.** It happened. You
  cannot sign back in. Another reason to use scripts.
- **The Browser pane reports ZERO geometry when hidden** and often paints blank; a
  screenshot forces a paint, then measure on the NEXT call.
- **First read after any publish is stale.** Read 2–3 times and trust agreement.
- **Measure page weight GZIPPED.** The dark slices are +19 KB raw but **+428 B gz**.

## Colour rules the scripts encode
- Only literal hex is ever rewritten; tokens and `rgba()` are left alone — they flip.
- The map is **property-aware**: `#161C21` as a background is a card that must lift,
  as a foreground it is text that must go near-white.
- A saturated mid-tone (`#00b0ff`) is a brand colour — untouched in both roles.
- A foreground only lifts when its own surface actually went dark (`common.white`
  and the grey ramp do NOT flip — that is the white-on-white button bug).
- Nested selector objects are re-emitted WHOLE; `mergeSchemeValue` replaces rather
  than deep-merges, so a partial override drops its siblings.

---

# Working agreements
One conventional commit per AGL-###, lowercase subject, ≤100 chars, `git commit
--only` (never `add -A`). Linear: In Progress → In Review → Done, and `get_issue`
before citing an id. **Promotion needs Zach's word before it starts — never open a
production PR unasked.** (Corrected 2026-08-14, AGL-1704: this used to read
"Promotions are batched one per session", which reads as a standing routine an
agent may run.) When he gives the word: gate the pinned SHA in a **worktree, never
the live checkout** — build + test + lint, every exit code read bare, never through
a pipe. Then `main` → `production`, **merge never squash, never rebase**, and
confirm the sha reaches READY with the Vercel MCP (`gh api` cannot poll it) — team
`team_JFfQodGE8VhCAZM6usYTu54M`, projects `aglyn-console` and `aglyn-tenant`, both
deploy from this repo. Do not create a `promote/*` or any other intermediate
branch; push to `main` immediately and batch there.

~~Last promotion: PR #789, sha `12fc2043b`, both READY. `main` is ahead by
`0a0100d2b` and `bd04748b9` (scripts only) — fold into the next batch.~~ **Stale as
of 2026-08-14** — `12fc2043b` is long since in production, which is now well past
it. Never trust a promotion state written down here; re-derive it with
`git rev-list --count origin/production..main`.
