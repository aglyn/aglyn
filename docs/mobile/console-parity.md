# Console parity in the native apps

Zach, 2026-10-07: everything you can do on the website you can do in the
app. Every console area is a native screen on iPhone, iPad, Android phone and
tablet, Mac and Windows. Only the Besigner opens, in the in-app web view
(`native-architecture.md`, "Native console, Besigner-only web view").

This is the checklist. A row is done when its screens and actions work on BOTH
platform trees (SwiftUI and Compose), verified on the seeded emulator stack.
The owning lane ticks its own rows: `[x]` Apple · `[x]` Kotlin.

| area | console routes / plugin | lane | Apple | Kotlin |
| -- | -- | -- | -- | -- |
| Home, site switcher | `(home)`, `[orgSlug]`, `hosts`, `hosts/[host]` | leads | [x] | [x] |
| Orders, products, stock, sales | `commerce` | leads | [ ] | [ ] |
| POS register, readers, kiosk | `commerce` POS, `kiosk/[pluginId]` | leads | [ ] | [ ] |
| Redirects | `redirects` | leads | [x] | [x] |
| Commerce integrations cards | `accounting`, `shipping`, `post-purchase`, `tax-engines`, `marketing-platforms`, `fulfillment-networks`, `couriers`, `sales-channels` | next lane | [ ] | [ ] |
| Sites, pages and their versions | `hosts/[host]/screens/*` (opening a page = Besigner) | AGL-3668 | [x] | [x] |
| Components, layouts, templates | `hosts/[host]/components/*`, `layouts/*`, `templates/*` (lists native, editing = Besigner) | AGL-3668 | [x] | [x] |
| Site setup | `hosts/[host]/setup/{details,emails,seo,theme,tracking}`, `theme` | AGL-3668 | [x] | [x] |
| Content collections | `hosts/[host]/content/*` | AGL-3668 | [x] | [x] |
| Media | `hosts/[host]/media`, `[orgSlug]/media`, `video-delivery` | AGL-3668 | [x] | [x] |
| Forms and submissions | `forms` | AGL-3668 | [x] | [x] |
| Datasets and data | `data`, `[orgSlug]/data` | AGL-3668 | [ ] | [x] |
| Fonts, theme presets, plugin marketplace, logic | `fonts`, `theme-presets`, `marketplace`, `logic` | AGL-3668 | [ ] | [ ] |
| CRM | `crm` | AGL-3669 | [x] | [x] |
| Inbox | `inbox` | AGL-3669 | [x] | [x] |
| Emails, campaigns, funnels, texts | `email`, `marketing`, `funnels`, `sms` (email design = Besigner) | AGL-3669 | [ ] | [x] |
| Sequences (internal only) | `outreach`, where the console shows it | AGL-3669 | [x] | [x] |
| Bookings, events calendar | `bookings`, `events-calendar` | AGL-3670 | [x] | [x] |
| Analytics | `hosts/[host]/analytics` | AGL-3670 | [x] | [x] |
| Automations | `workflows` | AGL-3670 | [x] | [x] |
| Notifications and their settings | `manage/notifications/*` | AGL-3670 | [x] | [x] |
| AI | `ai` (credits, jobs, settings) | AGL-3671 | [ ] | [ ] |
| Site admin | `hosts/[host]/admin/{activity,backup,danger,domain,error-pages,general,plugins,security}`, `hosts/[host]/users` | AGL-3671 | [ ] | [ ] |
| Workspace settings | `[orgSlug]/settings/*`, `[orgSlug]/plugins/*` | AGL-3671 | [ ] | [ ] |
| Team and roles | `[orgSlug]/team/*` | AGL-3671 | [x] | [x] |
| Billing and usage | `billing`, `[orgSlug]/billing/*` (paying = Stripe's hosted pages) | AGL-3671 | [ ] | [ ] |
| Your account | `manage/user/*`, `manage/report-issue` | AGL-3671 | [ ] | [ ] |
| Support | `support`, `[orgSlug]/support/*` | AGL-3671 | [ ] | [ ] |
| Staff | `admin/*` (staff claims only) | AGL-3667 in AGL-3671 | [ ] | [ ] |

## Staff gaps (AGL-3667)

The audit of every page under the console `admin/*` route and the plugin staff
pages that render at `/admin/{id}` (`apps/console/app/(app)/admin`,
`constants/admin-nav-tabs.ts`, the `staffPages` of the AI and marketplace
plugins), against `libs/native/screens/staff.screens.json` and the AI plugin's
`ai.signals`. The Staff row above stays unticked on both platforms until every
line here is done; each line names the console source it was read from.

| page | what the console has that the screens lack | state |
| -- | -- | -- |
| Organization | Enterprise custom billing (`org-detail` page, `/api/admin/enterprise-billing`, needs `Idempotency-Key`) | done (action `headers`) |
| Organization | Override editor: stored plan, staff comp and caps, every quota, feature and early-access switch with what the workspace holds now, the reason code and note, saved through `/api/admin/org-override` (generated from the console's lists in `utils/org-override-fields.ts`; the route replaces the whole set, so all of it is sent). The save reports what took effect | done |
| Organization | Request or cancel erasure: the web page batches the flag and its audit row in the browser; a native client cannot build the audit row's index fields or batch atomically, so `/api/admin/org-erasure` makes both writes in one batch and tells the owner | done |
| Organization | Suspend and unsuspend sent free text where the route takes a reason code (it refused every one), and pause or resume AI (`/api/admin/lockdown` feature `ai-assist`, `ai-generate`) | done |
| Organization | How they found us (`/api/admin/acquisition`) | done |
| Organization | Subscription card with cancel, typed workspace name and reason (`/api/admin/billing/cancel-subscription`) | done |
| Organization | Rename, logo and contact, ownership transfer to a member, owner handoff (`/api/orgs/settings`, `/api/orgs/invites`) | done |
| Organization | Media library card (`/api/admin/media-library`, `/asset`) and the activity card: done. Effective entitlements table | open |
| Site | Suspend and unsuspend had the same reason-code bug (fixed). Rebuilt on the console's cards: the site with its live address (one `liveDomain` on `/api/admin/sites`), status, leaving notice and the subdomain change; the custom domain with the platform's verdict, the record to add and the conflicting records (`/api/domains/status`, texts generated from `domain-status.ts`) and re-attach; ownership with the four workspace actions and the plan proposal; the move review (`/api/admin/site-transfer` GET, holds and warnings) beside the move; usage (counts from the server through the new load `count`, the workspace's media after the site is known through `late`); pages, email designs, layouts, components, templates and forms with their draft previews; settings snapshot; activity. Native lists show the first 200 of each collection, in the order the site stores them, where the console pages through all of them. The move's destination is typed as a workspace ID, where the console searches by name | done |
| Person | System email: follow-up, preview (subject and recipient; the console also draws the HTML) and send (`/api/admin/users/system-email`), product-email consent facts, acquisition: done. Erase card: to be read against `StaffUserEraseCard` | open |
| Overview | The anomalies list read fields the route never sends (fixed), people total, top usage (the metered plugin counts stay on each workspace's usage by month), marketplace purchases and refund reversals (`/api/marketplace/admin/overview`) | done |
| Health | The nine probes (the old list read a shape the route never answers), CSP and server config (also read the wrong fields), scope drift (`/api/admin/backfill-scope`), pending erasures (`/api/admin/run-erasures`), idempotency claims | done (paged jobs: action `loop`) |
| Maintenance | `/admin/maintenance`: schedule readings and the three guarded jobs (audit archive, plugin artifact reaper, plugin verdict re-verification), generated from `maintenance-jobs.ts`; the console also locks the real run until a preview has been read, which the screen leaves to the route's reason and typed phrase | done |
| System emails | The page listed only templates that already had a stored document, so an email never designed was missing; now the whole catalog (generated from `system-email-catalog.ts`) with design, edit in the Besigner, send a test with the sample values, back to default; platform suppressions with filters, search and release (`/api/admin/emails/suppressions`); delivery history import; the message viewer from every delivery row (plain text; the console also draws the formatted HTML); the delivery rows read fields the route does not send (fixed). Designing an email the first time needed the browser to encode its nodes, so a staff route does it (`/api/admin/emails/open-version`). Per-token overrides and the populate-from picker of the test drawer are not carried | done |
| Abuse reports | Queue with status and category filters, counts and the put-back deadline warning; one report with its DMCA notice, risk notice, held send, held page, payment signal, seller pattern and owner asks, and the status decision with the repeat-infringer note; the counter-notice queue and one counter-notice with the sworn statements, the clock and each step (forward, restore, suit filed, withdrawn, rejected). The risk notice's links to console pages are listed as text; the session log is not kept | done |
| Lockdown | Rebuilt: every native lock was refused for sending free text where the route takes a reason code. Now platform lock with the typed phrase, each lever (the core ones and the AI plugin's), workspace, site, account and domain locks with mode, takedown enforcement, self-lifting hours, billing cancel, owned workspaces, site money and owner email, unlock, check state, "what would this caller be told", resend with send-again, active locks. The console's session log of the actions taken is not kept (each action shows its own result) | done |
| Plugin reviews | `/admin/plugin-reviews` queue with search and status, and a submission: status, overview, capabilities, declared elements, verifier checks and findings, publisher attestation, the review checklist (toggles), versions with realm trust grant and revoke (super), stop and allow bytes, approve or reject a version, list, start review, verify, decline verification, delist, unverify, reject, take down and restore. Core staff specs, because the marketplace has no Apple package yet; the checklist, rejection reasons and status texts are generated from the plugin's model files | done |
| Marketplace reports | `/admin/marketplace-reports` (`/api/marketplace/admin/reports`): state filter, mark reviewing, resolve with a note | done |
| Revenue | Read fields its route never sends (`mrrUsd`, `byPlan`, `subscriptions`), so it was empty. Rebuilt on `/api/admin/revenue`: period, the lower-bound and coverage warnings, the two bases, how each org is treated, the gap and its causes, where the money came from, gross versus net, the orgs attribution and the plugin attribution tables (generated texts from `revenue-view.ts`). The bars of the console's charts are lists | done |
| Margin | Rows read the right bands but showed neither cost nor margin; now MRR, net, cost, margin and rating, the utilization of each band, a plan filter. The fleet-wide distributions of each band and of margin are not computed natively | partial |
| Feature flags | Edit sent PATCH to a route that takes PUT, and read `enabled` and `note` where the route nests them under `value`; now label, description, on or staged rollout, plan targeting, note, with the publish confirmation | done |
| Support | The queue read the newest hundred instead of `view=queue`: now open, closed or all, the open count, tier, plan, who is owed a first reply; the thread shows who is staff | done |
| Coupons | Promotion codes live inside each coupon, so Activate and Deactivate never showed; codes are their own list now (flatten), the create form gains the expiry, and the result reports the full-use check | done |
| Alerts | Per-type switches and delivery, the digest hour (it POSTed to a route that takes PUT), the test per type (it sent none), recipients, webhook and health checks | done |
| Platform settings | Mail sent this hour beside the send-rate form | done |
| Audit log | Only the archive was native; now the admin actions (latest 100, scope and action filters) and one entry with before and after, then the archive. The console's date range and CSV export are not carried | partial |
| Workspaces, Sites and People lists | Filters (plan, billing status, suspended; suspended, own domain, workspace; disabled, staff, role) with the console's newest-first order; the Workspaces list shows last activity and erasure requested. The plan shown is the stored plan, where the console resolves a comp; the console's column picker and header sorts are not carried | partial |
| Sales tax, Churn | read against the console page in the PRs that follow | open |

Texts (`sms`): the plugin is infrastructure with no console page of its own.
The console's texts surfaces are the Commerce settings card's "Also send as
texts" switch (native: `sms.texts`, Customer texts) and the order dialog's
"Resend receipt" Text channel. Kotlin orders have it. Apple is left open: its
order detail (PR #1226, the commerce lane's) resends a receipt by email only,
so the Text channel there is the one thing keeping the Apple box above
unticked. The card's per-moment email
switches belong to the Commerce settings and are not part of this row. A
funnel has no page design of its own, so it has no Besigner entry.

Not screens: `signin`, `signup`, `signout`, `sso`, `reset-password`,
`verify-email`, `account-recovery`, `auth/handoff/*` and `edit-access` are the
sign-in flows the shell already owns.
