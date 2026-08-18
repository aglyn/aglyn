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

## Workstream G — docs, guides, API surface, and in-product help

Distilled into work:
- **Docs stay in sync with every shipped feature** (the standing rule, now with teeth: new features
  update `DOCS_HELP_TOPICS`, `generate-docs-help.mjs` runs, `docs-links.spec.ts` guards).
- **Visual docs**: browser screenshots via the emulator/dev environment (Zach's browser for
  production-only surfaces) — SECTION/component-level crops, not just full pages; annotate with
  outlines/callout text where it makes the image teach better. Store under the docs assets
  convention; the brand-assets lore applies (`@2x` labels lie — trust real dimensions).
- **Customer-facing REST API growth**: extend `/v1` with the resources customers will actually
  automate (audit what the console can do that `/v1` can't); every endpoint documented to the
  standard of the existing datasets pages — request/response shapes, idempotency headers, error
  contracts, `conventions.md` kept authoritative. The AGL-1710 lineage is the bar.
- **Guides ladder**: how-to walkthroughs a beginner can follow click-by-click AND technical
  reference pages for developers — both, cross-linked, per major feature (sites, commerce,
  marketplace, forms, data, API).
- **Tooltip pass across Aglyn**: the in-console tooltip/help-tip layer audited and updated to match
  current behavior — tooltips are documentation and drift like documentation; tie them to
  `DOCS_HELP_TOPICS` anchors where a "learn more" belongs. Aglyn Assist (Workstream F) mines its
  Q&A data for which tooltips and guides are missing.

## Workstream H — GA reports and dependency hygiene

- **Build numerous GA4 reports** — using Zach's browser session on analytics.google.com (property
  `Aglyn — Platform`, 302497406). Start from the AGL-1637 click-list (dimension registrations, key
  events, internal-traffic filter activation), then build the reports themselves: funnel
  explorations (signup → publish → purchase; pricing-CTA per tier via `content_id`), revenue
  (purchase/refund net), retention/churn (cancellation event, downsell funnel once AGL-1859 ships),
  traffic split by `content_group` (marketing/docs/console), UTM acquisition, Web Vitals (RUM),
  audiences (by plan via `org_plan` user property; by ICP proxy where derivable). Record every
  report/audience created on AGL-1637 so the GA workspace state is reproducible.
- **Fix ALL Dependabot alerts and PRs** — `gh api repos/aglyn/aglyn/dependabot/alerts` for the
  alert list, `gh pr list --author app/dependabot` for the PRs. Triage each: security alerts first
  (upgrade, or document why not exploitable in our usage), then version-bump PRs (rebase/merge the
  safe ones through the normal gate — never merge a dependency bump ungated; a major bump gets its
  own verification pass). ⚠️ Lockfile lore applies: never blanket-rename or hand-edit lockfiles;
  one bump per commit where risk is nontrivial. Close obsolete PRs with a reason.

## Browser, auth, and env access

The grant is in the mandate below (verbatim). Operational notes on that grant: the browser is ONE resource — serialize browser tasks, never fan
them out to concurrent agents; never enter credentials/API keys into fields (read them from where
they already are); `vercel env ls` CANNOT see team-level shared envs (use the REST API or the
dashboard — a "missing" var may be shared-but-unlinked, which is invisible at runtime until linked
per-project: the exact AGL-1636/AGL-1846 failure, twice).

## The mandate — Zach's consolidated directive, verbatim (2026-08-17)

This is the canonical text, confirmed by Zach as the complete concatenated directive. Every
workstream above is its distillation; when in doubt, THIS text wins.

> once the background agents are done and the promotion gate is done. Write me a new command to
> start in a new session, making note that we need to make sure we are completing everything in the
> backlog and getting things ready to release on Sept 1, spawning each one in a new background
> agent, completing as many as possible at once, updating linear as we go, file and fix all at the
> same time and update statuses as we go. We gotta get these things ready to go and be released to
> the public and start accepting payments, selling marketplace items, and the storefronts of the
> hosts ready to receive payments and fulfill orders and shipments etc, all of the commerce features
> and addons and plugins, and our subscription tiers, our usage metering, data analysis and security
> measure and billing overages etc, and everything else you suggest. We need to make sure we are not
> losing money when we release and will enable features that will not produce churn but rather
> commitment and making it more easy to upgrade and not as easy to downgrade similar to how claude
> subscriptions work etc, I already asked for this before not sure how it was lost, we need to hide
> the lower tiers or something or make them less visible and make the upgrade paths more visible,
> then produce a funnel to try and prevent canceling account first by asking for them to complete
> survey why they are churning or deleting account or canceling account etc and then offer them a
> smaller subscription tier or a short term discount etc. All of Stripe and staff needs to be
> polished and ready to go. Let's make sure our console and besigner actually match the features we
> promote in our product mockups/screenshots, don't change the screenshots just make our feature
> match more similar to what we are advertising. Don't forget you can use my browser to test and use
> my authentication session, but first try using the local dev environment or emulator environment,
> you can use my browser to manage anything such as stripe, google cloud, firebase, aglyn, vercel
> etc, also when looking for env always double check shared/global envs. Don't forget we always need
> to keep the docs in sync and create new pages and reorganize as necessary, take screenshots of the
> browser and make as visualized as possible, you also don't always need screenshot the entire page
> but can screenshot sections of the site of components, maybe even add outlines and text if need to
> better visualize and make the image more descriptive or helpful. Add more API's to our customer
> facing API and document it extremely well. Also add helpful how-to guides and walk through guides
> and make it easy for anybody but also very descriptive for those who are also technical and need
> reference guides where necessary etc, also make sure we are updating the tooltip documentation
> tips across Aglyn. Fix all of the dependabot alerts and prs etc.
>
> Also build numerous reports for us in GA, and it can use my browser to do it. Also Add a new
> console ai generative chat bot helper tool persisted on every page to assist with direction or how
> to do things, direct them to documentation or help them use aglyn or to automate current view etc
> create a new element or change the screen design or build page content or build an entire site for
> them or update attribute value in besigner etc, the expanse of this tool can be entirely up to
> you, remember we need to make it easy for all 3 of our ICPs, Multi-Site orgs, agencies, and
> beginner mom and pop or fresh business looking to get started etc. We need to make sure it is easy
> for someone who doesn't know code and even easier for someone who does know code. We may need to
> make this a paid feature to keep from costing us too much money and keep our profit margins high,
> provide all limitations to possibly make a free version available. We will also want to use the
> data and questions and answers to help better build our docs so we will need to store that info
> and allow us to learn from it to improve docs and the ai tool.
