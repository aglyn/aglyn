# /release — ship Aglyn to the public on September 1

Standing mandate from Zach (2026-08-17): **complete everything in the backlog and get Aglyn ready to
release to the public on Sept 1** — accepting payments, selling marketplace items, storefronts taking
payments and fulfilling orders/shipments, every commerce feature/add-on/plugin, subscription tiers,
usage metering, data analysis, security measures, billing overages. Spawn each item in a background
agent, complete as many as possible at once, update Linear as you go — **file AND fix at the same
time** — and keep statuses current.

## Orient first (state moves under you — never trust a written-down count)

1. Read `.claude/HANDOFF.md` and `MEMORY.md` (follow links before acting on anything unfamiliar).
2. `git rev-list --count origin/production..origin/main` + `git log --oneline` for the real batch.
3. Linear: project **"Public beta: paying customers on September 1"** is the spine; also sweep the
   `awaiting-smoke` label (~78 remain, 20/agent-pass, method proven on AGL-1501…AGL-1579) and
   `awaiting-decision` (Zach's — surface, don't flip).
4. `git status --porcelain` — other agents' dirty files tell you where NOT to send a new one.
   ⚠️ This environment auto-stages new files; `.claude/commands/{handoff,queue}.md` sit staged from
   an old session — never sweep them into a commit.

## Operating rules (learned, not theoretical — give agents the constraints VERBATIM from /queue)

- **File AND fix concurrently. Both halves are mandatory** — the issue is the record even when the
  fix lands in the same pass; the backlog shrinks by fixes marked Done, not by unrecorded work.
- Statuses move as work moves: In Progress when an agent starts, In Review + `awaiting-promotion`
  when landed on main, Done when the commit is an ancestor of `origin/production` (rules changes:
  Done only when DEPLOYED). Confirm every Linear id with `get_issue` before citing — predicted ids
  have auto-linked to strangers three times.
- Promotion flow: push to main immediately; batch only production PRs; gate in the isolated worktree
  at `/private/tmp/aglyn-gate` (recipe in HANDOFF — real node_modules via `cp -Rc`, both standalone
  installs, private npm cache, boundary-rule fault injection); PR main→production on **Zach's word**;
  real merge commit; verify DEPLOYED (Vercel prints to stderr); run stacked deploys (rules / indexes
  / TTL / Remote Config) from the promoted SHA and verify each.
- Two nx processes in one checkout destroy each other's `dist`. localhost Stripe key is LIVE.
  Never swap a shared file to prove a red. Test doubles model real semantics. Decompose every count.

## Workstream A — backlog burn-down

Every open issue in the beta project gets an agent or a reason it can't have one. Keep 5–6 agents
running in disjoint file areas; smoke sweeps in 20-issue batches; the In-Progress reconciler pattern
(evidence table per issue) whenever staleness accumulates.

## Workstream B — money-path release readiness (WE MUST NOT LOSE MONEY)

Audit-then-fix, end to end, with real evidence at each step:
- Platform revenue: subscription checkout/renewal/tax (TX registration live, 80% base verified),
  `platformRevenue` recording, GA4 purchase events, metering + **billing overages actually billed**.
- Marketplace: publisher onboarding → paid listing → purchase → transfer split → refund → payout
  (AGL-1548's drill ran at $0; the first nonzero sale self-exercises the rest — watch it land).
- Storefronts: orders, shipping (zones/rates/refusals), fulfillment routes, inventory ledger,
  refunds/disputes (lost disputes reverse the seller share), POS, subscriptions with recurring tax.
- Margin guards: fees vs plan pricing, add-on entitlements vs what's billed (AGL-1775 note),
  metered usage floors, anything that hands out paid features free (the fail-open class).

## Workstream C — pricing & retention architecture ⚑ REPEATED DIRECTIVE — WAS LOST ONCE, NEVER AGAIN

Zach has now asked for this TWICE (first ask predates 2026-08-17 and was dropped; this file is the
durable record). Model: **how Claude subscriptions work** — upgrading is frictionless, downgrading
is deliberate, commitment over churn:
1. **Tier visibility**: hide or de-emphasize the lower tiers (pricing page + in-console upgrade
   surfaces); make upgrade paths prominent and one-click. Marketing /pricing is besigner content —
   publication-first, edit by clicking, coordinate with Zach's browser session.
2. **Asymmetric friction**: upgrades instant with proration; downgrades take effect end-of-cycle,
   require a confirm flow, and never one-click from the billing card.
3. **Cancellation/deletion funnel** (account cancel AND account delete both): step 1 a short
   why-are-you-leaving survey (stored — feeds Workstream F's data loop and GA4), step 2 offer a
   smaller tier, step 3 offer a time-boxed discount (coupon minted `duration: once/3mo`, guarded —
   remember the 100%-off-forever lesson), step 4 only then cancel, effective end-of-cycle.
4. Instrument every step to GA4 (`churn_survey`, `downsell_accepted`, …) so the funnel is measurable.

## Workstream D — Stripe + staff polish

Everything a first paying customer or a support conversation touches: Stripe dashboard config
(events, tax, branding, receipts), staff console surfaces complete (org view, overrides, audit
trails, refusal/spam counters), the runbooks current.

## Workstream E — the product must match what we advertise

Audit the marketing site's mockups/screenshots (product pages, /pricing feature lists) against the
real console/besigner. **Never change the screenshots — change the product to match them.** File an
issue per gap, fix in the same pass where reachable, and produce the parity table on a tracking
issue so Zach can see advertised-vs-real at a glance.

## Workstream F — **Aglyn Assist**: the in-console AI helper (new build; scope is Claude's call)

A generative chat assistant persisted on every console page. Serves all three ICPs — multi-site
orgs, agencies, and first-business beginners — easy for people who don't code, easier for people who
do.

**Capability ladder (ship in phases, each phase valuable alone):**
1. **Answer + direct**: how-to help grounded in the docs (docs content is in-repo; retrieval over
   `apps/docs` + `DOCS_HELP_TOPICS` anchors), deep links into the exact console page or doc section.
2. **Guide**: context-aware — knows the current view (route, org, host, screen) and walks the user
   through it; "automate current view" = prefill/execute the form or flow the page offers, with
   explicit confirm before any write.
3. **Act in the besigner**: create elements, update attribute values, change screen design, build
   page content, scaffold an entire site — through the SAME programmatic surface the besigner
   exposes (`window.Aglyn.getBesignerController()`; attribute blur-commit and save-confirmation lore
   applies). Every action lands as a DRAFT/new version (the existing versioning is the undo), never
   an unreviewed publish.
4. **Build**: full-site generation from a brief (templates + content), agency batch operations.

**Architecture**: Claude API (load the `claude-api` skill before writing any of it — models,
streaming, tool use, caching). Server-side proxy route (never expose keys client-side), tool-use
schema over console/besigner actions, per-org context injection. Respect the plugin/realm sandbox
lore where the assistant touches tenant content.

**Pricing/margin (Zach's constraint: don't let it eat margins):** metered per-org message/token
budgets recorded like `platformRevenue`; ship as a paid add-on or Pro+ entitlement via the existing
entitlement system. Free-tier option, fully limited: N messages/day, capability ladder capped at
level 1 (answers + links only), no act/build. Cost telemetry per org from day one so pricing can be
tuned with data.

**The data loop (Zach's ask):** store every Q&A exchange (org-scoped, consent-disclosed in the
privacy policy — add the disclosure to the legal sitting BEFORE launch of the feature), plus
explicit thumbs-up/down. Build the staff mining view: top unanswered questions, docs gaps ranked by
frequency → each becomes a docs issue (file-and-fix). The assistant improves the docs; the docs
improve the assistant.

**Phase 1 target for Sept 1**: level 1–2 (answer/guide) behind a release flag + entitlement, the
data loop recording, the paid gate wired. Levels 3–4 follow post-launch.

## Deploys-owed tracker

Check HANDOFF + recent issue comments every session: rules / indexes / TTL / Remote Config stack up
between promotions and are deployed from the promoted SHA, then verified (drift checkers are live
and will tell you the truth: `check:rules-drift`, `check:index-drift`, `check:legal-drift`).

## Zach-only list (surface, don't block on)

The Google backup support case (AGL-1843), GA dashboard click-list (AGL-1636 comment), legal
besigner sitting (the drift tool's 8 DIFFERS + AGL-1840 + subprocessor rows), Vercel/HubSpot/
Visitor Queue cleanups, the Webfile RT number, ruling signature, off-project backup replication.

## Definition of done for Sept 1

A stranger can: sign up → build a site → publish on their domain → sell a product with correct tax,
shipping, inventory → get paid; a publisher can sell a plugin and get their split; Zach can see all
of it in GA4 and the console with staff traffic excluded, nobody undercharged, nothing fail-open,
and every guard able to go red.
