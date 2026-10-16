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
| Orders, products, stock, sales | `commerce` | leads | [x] | [x] |
| POS register, readers, kiosk | `commerce` POS, `kiosk/[pluginId]` | leads | [x] | [x] |
| Redirects | `redirects` | leads | [x] | [x] |
| Commerce integrations cards | `accounting`, `shipping`, `post-purchase`, `tax-engines`, `marketing-platforms`, `fulfillment-networks`, `couriers`, `sales-channels` | next lane | [x] | [x] |
| Sites, pages and their versions | `hosts/[host]/screens/*` (opening a page = Besigner) | AGL-3668 | [x] | [x] |
| Components, layouts, templates | `hosts/[host]/components/*`, `layouts/*`, `templates/*` (lists native, editing = Besigner) | AGL-3668 | [x] | [x] |
| Site setup | `hosts/[host]/setup/{details,business,emails,seo,theme,tracking,integrations}`, `theme` (the theme's Advanced overrides are a raw JSON editor: not built, people are not asked to write code) | AGL-3668 | [x] | [x] |
| Content collections | `hosts/[host]/content/*` | AGL-3668 | [x] | [x] |
| Media | `hosts/[host]/media`, `[orgSlug]/media` (`video-delivery` has no console page: it is server-side only) | AGL-3668 | [x] | [x] |
| Forms and submissions | `forms` | AGL-3668 | [x] | [x] |
| Datasets and data | `data`, `[orgSlug]/data` | AGL-3668 | [x] | [x] |
| Fonts, theme presets, logic | `fonts`, `theme-presets`, `logic` | AGL-3668 | [x] | [x] |
| Plugin marketplace | `marketplace` (browse, listings, install, my installs and licenses native) | AGL-3668 | [x] | [x] |
| CRM | `crm` | AGL-3669 | [x] | [x] |
| Inbox | `inbox` | AGL-3669 | [x] | [x] |
| Emails, campaigns, funnels, texts | `email`, `marketing`, `funnels`, `sms` (email design = Besigner) | AGL-3669 | [x] | [x] |
| Sequences (internal only) | `outreach`, where the console shows it | AGL-3669 | [x] | [x] |
| Bookings, events calendar | `bookings`, `events-calendar` | AGL-3670 | [x] | [x] |
| Analytics | `hosts/[host]/analytics` | AGL-3670 | [x] | [x] |
| Automations | `workflows` | AGL-3670 | [x] | [x] |
| Notifications and their settings | `manage/notifications/*` | AGL-3670 | [x] | [x] |
| AI | `ai` (credits, jobs, settings) | AGL-3671 | [x] | [x] |
| Site admin | `hosts/[host]/admin/{activity,backup,danger,domain,error-pages,general,plugins,security}`, `hosts/[host]/users` | AGL-3671 | [x] | [x] |
| Workspace settings | `[orgSlug]/settings/*`, `[orgSlug]/plugins/*` | AGL-3671 | [x] | [x] |
| Team and roles | `[orgSlug]/team/*` | AGL-3671 | [x] | [x] |
| Billing and usage | `billing`, `[orgSlug]/billing/*` (paying = Stripe's hosted pages) | AGL-3671 | [x] | [x] |
| Your account | `manage/user/*`, `manage/report-issue` | AGL-3671 | [x] | [x] |
| Support | `support`, `[orgSlug]/support/*` | AGL-3671 | [x] | [x] |
| Staff | `admin/*` (staff claims only) | AGL-3667 in AGL-3671 | [x] | [x] |

## Sign in, sign up and first run (AGL-3819, AGL-3816)

The apps are a direct alternative to the web app before sign-in too: every
door of the console's `(auth)` pages, through the console's own routes in the
console's order, with the same server checks (`beforeSignupCreate`, the abuse
and fraud checks, the signups lockdown). The Kotlin column covers Android and
the Windows desktop build; a row the desktop answers through the console
hand-off says so.

| door | console routes | Apple | Kotlin |
| -- | -- | -- | -- |
| Sign in with email and password, retrying with the primary address when the typed one is a confirmed secondary | `/signin`, `/api/auth/resolve-identifier` | [x] | [x] |
| Sign up: name, workspace name (`signupOrgNameField`), email, password; the Terms of Service and Privacy Policy agreement and its acceptance record; the product-updates opt-in | `/signup`, `/api/auth/legal-acceptance`, `/api/auth/acquisition`, `/api/auth/marketing-consent` | [x] | [x] |
| The plan and campaign a sign-up link carries (`aglyn://signup?plan=…`, the console's `/signup?plan=…`), kept on the account and landing the new workspace on billing | `/signup`, `users/{uid}.onboardingPlanIntent`, `users/{uid}.signupCampaign` | [x] | [x] |
| The signups-paused notice | `/api/lockdown-status?feature=signups` | [x] | [x] |
| Email verification: sent on arrival, resend, re-checked every few seconds and on return, "I’ve verified — continue", and the emailed link confirming in the app | `/verify-email`, `/api/auth/send-verification` | [x] | [x] |
| First verified session: the workspace the sign-up named created once, the AGL-1523 notice with "Create it now", and "Create an organization" | the `(home)` chooser, `/api/orgs/create` | [x] | [x] |
| Account recovery and choosing a new password from the emailed link | `/account-recovery`, `/reset-password`, `/api/auth/send-password-reset` | [x] | [x] |
| Passkey sign-in (shown once the build has a relying party) | `/api/auth/passkeys/signin/*` | [x] | [x] |
| Continue with Google, sign in and sign up; a new person goes through the agreement and the workspace step (AGL-1415, AGL-1497) | `/signin`, `/signup` | [x] | [x] |
| Sign in with Apple, sign in and sign up (App Store guideline 4.8) | `apple.com` through `accounts:signInWithIdp` | [x] | n/a |
| Single sign-on, through the console in the system auth session and a one-time hand-off back to the app; an address on an SSO domain is routed there from the email field and signs in as its tenant account | `/sso`, `/api/auth/sso-lookup`, `/api/auth/sso-jit`, `/auth/native`, `/api/auth/native-handoff/*` | [x] | [x] |
| Desktop (Windows) sign in and sign up through the console and the same hand-off, with console-minted App Check tokens for the signed-in session | `/signin`, `/signup`, `/auth/native`, `/api/auth/native-app-check` | n/a | [x] |
| The workspace switcher pages past 50 workspaces ("Load more workspaces") | `use-org-scope` `loadMoreOrgs` | [x] | [x] |
| Workspace invites: the invite email opens the app, and pending invites are answered from the empty workspace list (an existing member's arrive as notifications) | `/api/orgs/invites?mine=1`, `/api/orgs/invites` | [x] | [x] |

## Staff gaps (AGL-3667)

The audit of every page under the console `admin/*` route and the plugin staff
pages that render at `/admin/{id}` (`apps/console/app/(app)/admin`,
`constants/admin-nav-tabs.ts`, the `staffPages` of the AI and marketplace
plugins), against `libs/native/screens/staff.screens.json` and the AI plugin's
`ai.signals`. The Staff row above is ticked on both platforms because every
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
| Organization | Sign in as the owner (the console's "Impersonate owner" on the summary card): the same support session as Person, for the workspace's owner, with the same reason | done |
| Organization | Media library card (`/api/admin/media-library`, `/asset`), the activity card and the effective entitlements table (every limit as it resolves beside the plan default, the override and add-on flags and what the workspace holds; a staff route, `/api/admin/org-entitlements`, works it out as the page does in the browser) | done |
| Organization usage table | The list read `storageBytes` (the route sends `storageGb`) and showed only views, with no cost, no metered bands, no change from the older month and none of the recorded-not-priced lines. Now `/api/admin/org-usage?view=prepared` sends each rollup as the table prints it (`staff-org-usage-view.ts`, which the table imports): page views and cost with their signed change, storage, each metered band, and a month's own page with the recorded meters, money, release-gated overages and site size, or the sentence that nothing more was recorded. The AI plugin's three columns (Assist spend, AI credits used, AI overage billed) and its pool line are on the AI card, as "AI by month" | done |
| Site | Suspend and unsuspend had the same reason-code bug (fixed). Rebuilt on the console's cards: the site with its live address (one `liveDomain` on `/api/admin/sites`), status, leaving notice and the subdomain change; the custom domain with the platform's verdict, the record to add and the conflicting records (`/api/domains/status`, texts generated from `domain-status.ts`) and re-attach; ownership with the four workspace actions and the plan proposal; the move on a page of its own (`core.staff.siteMove`): search the destination by name through the workspace list, or give a workspace ID, review the plan (`/api/admin/site-transfer` GET, holds and warnings) and move; usage (counts from the server through a query load's `aggregate: { count }`, the workspace's media after the site is known through `late`); pages, email designs, layouts, components, templates and forms with their draft previews; settings snapshot; activity. Pages, email designs, layouts, components, templates and forms show the first 200 in the order the site stores them, and a full read offers Load more (load `more`), which reads the collection again 200 rows further until a read comes back short. | done |
| Person | Rebuilt: the Workspaces and Devices lists read `user.memberships` and `user.devices`, where the route answers `memberships` and `devices.rows`, so both were empty. Now the identity card (status, email verified, role, name source, last activity, phone and the do-not-contact answer), sign-in methods, the product-email answer with the console's disagreement warnings, how they found us, organizations with the seat each uses (team manager or site collaborator), the role and the sites reached, the password actions (reset email, and set directly with the console's generator; super), sign-in history with sign-out of one device (super), the addresses the account holds and the delivery records erased, email delivery, legal acceptances with the arbitration window and the pinned documents, activity, the audit trail and staff reads, system email (any staff, the route has no role gate), and the super actions. Erase asks for `DELETE` and a reason, and a refusal lists the workspaces that still need an owner and the shared addresses. **Sign in as this customer** (any staff, as the route has no role gate; not for another staff account): asks the reason the route insists on (its minimum is generated from the route's own constant) and signs the app in as the customer with the custom token the route mints, in the identity pool the token names (a support session, below). A banner on every screen names who is impersonated and who opened the session, and **Exit impersonation** returns to the staff member's own session, which was never signed out | done |
| Overview | The anomalies list read fields the route never sends (fixed), people total, top usage (the metered plugin counts stay on each workspace's usage by month), marketplace purchases and refund reversals (`/api/marketplace/admin/overview`) | done |
| Health | The nine probes (the old list read a shape the route never answers), CSP and server config (also read the wrong fields), scope drift (`/api/admin/backfill-scope`), pending erasures (`/api/admin/run-erasures`), idempotency claims | done (paged jobs: action `loop`) |
| Maintenance | `/admin/maintenance`: schedule readings and the three guarded jobs (audit archive, plugin artifact reaper, plugin verdict re-verification), generated from `maintenance-jobs.ts`; the real run stays locked until a preview has been read in this session, exactly as the console's card: the preview arms it (a preview that failed disarms it), running spends it so a second run needs a second look, and the screen says why it is locked (action `arm` and `disarm`, `session.armed`) | done |
| System emails | The page listed only templates that already had a stored document, so an email never designed was missing; now the whole catalog (generated from `system-email-catalog.ts`) with design, edit in the Besigner, send a test with the sample values, back to default; platform suppressions with filters, search and release (`/api/admin/emails/suppressions`); delivery history import; the message viewer from every delivery row (the HTML drawn natively, not in a web view: scripts, styles, frames, forms and images are taken out first, and a link opens in the system handler; plus the plain text); the delivery rows read fields the route does not send (fixed). Designing an email the first time needed the browser to encode its nodes, so a staff route does it (`/api/admin/emails/open-version`). The test asks for each variable the template takes, filled with its sample (the prompt field `each`); the drawer's populate-from picker is carried as a `lookup` field: search workspaces, sites and people by name or email through the staff list routes, and picking one fills the merge tokens the template takes (the token table is the console's own, `system-email-sample-sources.ts`, which the drawer reads too) and sets the recipient for a person with an address | done |
| Abuse reports | Queue with status and category filters, counts and the put-back deadline warning; one report with its DMCA notice, risk notice, held send, held page, payment signal, seller pattern and owner asks, and the status decision with the repeat-infringer note; the counter-notice queue and one counter-notice with the sworn statements, the clock and each step (forward, restore, suit filed, withdrawn, rejected). The risk notice's links to console pages are listed as text. "Changes made in this session" is kept on the report and the counter-notice, in the console's words: the reference and the status, with what happened to the site's clock for a counter-notice step, each verified or NOT CONFIRMED, newest first | done |
| Lockdown | Rebuilt: every native lock was refused for sending free text where the route takes a reason code. Now platform lock with the typed phrase, each lever (the core ones and the AI plugin's), workspace, site, account and domain locks with mode, takedown enforcement, self-lifting hours, billing cancel, owned workspaces, site money and owner email, unlock, check state, "what would this caller be told", resend with send-again, active locks. "Actions taken in this session" is kept: every lock, lift and resend that reaches the server leaves its lines (the act, then the billing, renewals, payouts, plugin and owner-email steps it reported), newest first, each verified or NOT CONFIRMED, at most 25 (`session.log`; the route sends the lines as `logLines`, built by the same `lockdown-log-lines.ts` the page uses) | done |
| Plugin reviews | `/admin/plugin-reviews` queue with search and status, and a submission: status, overview, capabilities, declared elements, verifier checks and findings, publisher attestation, the review checklist (toggles), versions with realm trust grant and revoke (super), stop and allow bytes, approve or reject a version, list, start review, verify, decline verification, delist, unverify, reject, take down and restore. Core staff specs, because the marketplace has no Apple package yet; the checklist, rejection reasons and status texts are generated from the plugin's model files | done |
| Marketplace reports | `/admin/marketplace-reports` (`/api/marketplace/admin/reports`): state filter, mark reviewing, resolve with a note | done |
| Revenue | Read fields its route never sends (`mrrUsd`, `byPlan`, `subscriptions`), so it was empty. Rebuilt on `/api/admin/revenue`: period, the lower-bound and coverage warnings, the two bases, how each org is treated, the gap and its causes, where the money came from, gross versus net, the orgs attribution and the plugin attribution tables (generated texts from `revenue-view.ts`). The bars of the console's charts are lists | done |
| Margin | Rows read the right bands but showed neither cost nor margin; now MRR, net, cost, margin and rating, the utilization of each band, a plan filter, worst margin first over the rows loaded. **Measure the fleet** folds up to a thousand organizations into the median and spread of every band and the fleet margin (`/api/admin/margin-utilization?view=fleet`, the page's own `fleetUtilization`), says how many it covered and whether it reached the end | done |
| Feature flags | Edit sent PATCH to a route that takes PUT, and read `enabled` and `note` where the route nests them under `value`; now label, description, on or staged rollout, plan targeting, note, with the publish confirmation | done |
| Support | The queue read the newest hundred instead of `view=queue`: now open, closed or all, the open count, tier, plan, who is owed a first reply; the thread shows who is staff | done |
| Coupons | Promotion codes live inside each coupon, so Activate and Deactivate never showed; codes are their own list now (flatten), the create form gains the expiry, and the result reports the full-use check | done |
| Alerts | Per-type switches and delivery, the digest hour (it POSTed to a route that takes PUT), the test per type (it sent none), recipients, webhook and health checks | done |
| Platform settings | Mail sent this hour beside the send-rate form. The Sales tax filing card was missing: where the platform files, the registration and filing numbers (masked, never shown back, kept or removed), the earliest filable period, where each value is set, the environment values that are not in force, save and clear with the audited reason (`/api/admin/tax-filing`; super). The country is picked from the platform's own region list in the person's language (a `country` field: `Locale.Region` on Apple, `Locale.getISOCountries` on Android and desktop), the code it stores is the two letters Stripe Tax expects | done |
| Audit log | The log was a Firestore read of the latest 100 with two equality filters. Now `/api/admin/audit-log` plans the page's own filters (action, action group, who, target type, site, scope, a date range) and search onto the query, pages it, words each row as the page does (the reason, a tenant pool, an override recorded before reasons were required), and builds the compliance export (the newest 5,000 the filters reach, before and after as JSON) that is saved or shared through the action `file`. An entry opens with its before and after, then the archive | done |
| Workspaces, Sites and People lists | Filters (plan, billing status, suspended; suspended, own domain, workspace; disabled, staff, role) with the console's newest-first order; the Workspaces list shows last activity, erasure requested, the plan each row reads as with the stored plan and the comp beside it (the route works it out as the page's Plan column does: a lapsed payer reads as free, a comp lifts it), and the Sites list opens each site on its own page. The console's column picker and header sorts are carried on all three (list `columns`): a Columns menu picks which facts each row shows (Workspaces: Plan, Subscription, Site limit with its overrides, Created, Last activity, Owner UID; Sites: Organization, Owner, Custom domain, Published pages, Created, Last updated; People: Staff role, Created, Last sign-in, Last activity), and a Sort menu sorts by every column, on the route over every row where the console's query does (Workspaces: name, Created, Last activity; Sites: name, Created, Last updated; People: user, role, Created, Last sign-in, Last activity) and on the loaded rows where it sorts the page (Plan, Subscription, Site limit, organization, owner, domain, pages), the first tap, the second and a third back to the default, as a header click cycles. The AI plugin's "AI spend (month)" column draws on the Workspaces list through a column zone any plugin can fill (`staffOrgsListColumn`), read once for the rows on the screen and sorted dearest first, the unmeasured last | done |
| Assist signal (AI plugin) | The screen read `spend.totalUsd`, `freeSpend.totalUsd` and a per-workspace `requests` the route never sends, so it showed nothing real. Rebuilt on `/api/ai/admin/signals?view=prepared` (the page's own tables as the lines it prints, money to four places under a dollar): the fleet figures, the free tier's day and whether it is paused, AI spend this month by workspace with the add-on, credits and the refusals broken down, where the money goes by tier and by model, tokens by kind, docs gaps, the questions the docs could not answer, what people actually asked (180-day retention noted) and what Assist costs by workspace | done |
| AI cards on the Organization and Person pages (AI plugin) | `ai.staffOrg` read `addon.active`, `overage.credits`, `refusals.count` and a user shape the route never sends, and its give-back sent no `idempotencyKey` (the route refuses that with a 400); `ai.staffUser` read `usedCredits` and `orgs` where the route answers `rows` and `allowance`. Both rebuilt on `/api/ai/admin/org?view=prepared` and `/api/ai/admin/user?view=prepared`, which send the sentences the cards print (`staff-org-ai-view.ts`, which the cards import): the add-on and what it costs, the pool as its named parts, used and remaining, credits given back, the owner's Free allowance, the month-end projection, the overage and its state, the refusals by reason, the generation jobs by status with the ten newest (each can be given back), tokens by kind, the top users, the usage table's AI columns by month, the margin in its tone, and the links to the override editor and Lockdown; the person's AI use in every workspace with their allowance. Give credits back and Reset this month (super or billing; meter, amount, reason, optional job id) send the `{attempt}` key in the body (action `headers` also takes it there) and report what moved. New: the AI requests card, `ai.staffRequests`, `ai.requests` and `ai.request` on `/api/ai/admin/conversations` (`?view=prepared` for who asked and the lines under each row, `?id=` for the one exchange or job a row opens): what people typed to Aglyn AI and what it answered, Assist chat and AI jobs, newest first, paged, with the brief, the fields filled in, the result and what a job made. Nothing is read until a list is opened, and each page is audited as on the web | done |
| Sales tax | The old screen read a `periods` list the route never sends. Rebuilt on `/api/admin/tax-return?view=prepared`, which runs the page's own derivations (`tx-return-webfile.ts`) over the same payload and sends what the page prints, so the verdict, the registration, the filing lines, the jurisdiction table and the sources' tables are decided in one place (the page now imports its sentences from `tax-return-view.ts`): the period menu, the verdict above the figures (do not file, review, or clean, with what was excluded), the findings with the invoices behind each (paged, searchable, one finding at a time, each invoice opening in Stripe), the return figures with Item 3 entered or not computed (record and clear, super), refunds, bounds, the facilitated sales of each source, and Aglyn's own sales by jurisdiction. The working papers CSV is saved or shared through the new action `file` | done |
| Churn | The card ranked nothing and showed no share: now each reason, flow and plan highest first with its share of the answers (new list `sort` and format `shareOf`), the departures and win-backs line, the empty-state sentences, the retention-records cap and the free-text answers with the verbatim-text warning | done |
| Do not contact | The list read `createdAt` (the rows carry `updatedAt`) and the record form lacked how it arrived, the channels, the erase-the-number switch and the account uid; the count of active numbers is back. Now the console's form (calls and texts, calls, or texts, where the console toggles two chips and refuses none) and "Opted back in" | done |
| Disabled files | The screen sent a quarantine the route refused (no workspace or site, no `by: media`) and read a `records` list. Rebuilt: look a file up by workspace or site and media id, what is set right now (each key, what it reaches, the digest warnings, the trash note, what disabling will and will not do from `media-takedown-reach.ts`), disable (reason, auto-lift hours, customer message, internal note, only this copy, kill the raw link) and release, the whole deny list with its filters and search and a per-key release, the used and clearable counts. "Actions taken in this session" is kept as on Lockdown (`quarantine-log-lines.ts`), and the full-list banners are carried: the lookup and the deny list say the list is FULL (the route sends `full`), and a file not already on a full list cannot be disabled (`takedownBlocked`), as the console's button is disabled | done |

POS register, readers, kiosk: ticked on both platforms. Everything the console
register does is native, verified by tests and builds (no app was launched): the
register, returns, the customer lookup, the last receipt and printing (cloud
printer, then the device's print sheet, as the console prints), offline cash
sales, the customer display, the self-service kiosk and its queue, every tender
(cash, card readers and Tap to Pay, the typed card in Stripe's own card form,
gift cards, store credit, a room charge, the QR payment page), the delivery-app
queue in the register's `posOrders` zone (the delivery-apps plugin's own native
package), and the shift, cashier PIN and drawer operations. The typed card is on
iPhone, iPad and Android phone and tablet, where Stripe has a card SDK; the Mac
and desktop registers take cards on smart readers and the QR payment page.

Orders, products, stock, sales: ticked on both platforms (AGL-3841), driven in
the running apps on iPhone, iPad and Android phone and tablet against the seeded
emulator stack. Everything the console's Orders and Products pages do is
native: the list filters (any clause the grid takes, through the shared filter
bar) and every header sort; Fulfill items with carrier, tracking and shipping
cost, each shipment's Edit tracking, Cancel shipment and Print label; Refund
and Refund line; the dispute and payment-risk notices; Draft order, Export for
shipping and Import tracking; View customer in CRM (the CRM's Contacts list
opens the one person with that address); the packing slip, invoice and product
labels on the device's print sheet (barcodes drawn natively, ZPL for a Zebra);
Duplicate, Archive or Activate, Delete and license keys on a product; Import
(the data hub's import for `commerce.products`); and the Products page's
`productsCreate` and `productsHub` zones.

Open in the AGL-3668 rows, 2026-10-14 (found by re-checking the ticked rows
against the console; each is a console action with no native screen on main
yet, and a row is ticked again when its last one lands). Components,
Site setup and Media were ticked again with the pull requests that carry the
rest of what this list named: start from and save as a template, email block
starters, a component's icon and a theme's "What you have changed" (#1559); the
AI plugin's SEO fixes, the cover-video poster frame, the image editor and
Setup's Integrations section (the cards of the plugins running on the site)
(#1586); and the Disabled notice on a file staff took down. What is left:

- Components, layouts, templates: complete. The lists sort by every column the
  console's tables sort by (a menu of the declaration's orders, with the
  console's notice when a search or filter changes the order) and print the
  per-plan count beside Create (`3/10 layouts on your plan`, the entitlements
  quota against the server's count). Publish to marketplace on a component or
  layout is native: the detail menu offers it wherever the marketplace fills
  the `hostArtifactPublish` slot, as the console's does.
- Site setup, deliberately not built: the theme's Advanced overrides, a raw
  JSON editor. Everything else in the row is native, including the AI plugin's
  widgets in the Business profile and SEO areas.
- Plugin marketplace: ticked again (AGL-3668). Publishing a plugin (its
  bundle and manifest, the listing and every publisher statement), a
  component, layout, site template, theme, dataset schema, email template or
  email starter; the publisher agreement asked for and resumed by every
  publish; the publish hub's take-rate notice for the workspace's plan; the
  seller panel (profile, listings with their preview image, screenshots and
  logo from the media library, payouts, sales); a listing's owner actions; and
  both Licenses tables are native. Reporting a listing was already native.
- Datasets: Import is on the dataset's page and on its records list (an owner
  or an admin, the transfer routes' own rule), and opens the Imports and
  exports hub's import wizard on `data.dataset:<id>`, as the console's
  `openImport` does; export of a dataset is native too.

The media library's "Default sharing for new media" card is in Workspace
settings, where the apps keep the workspace's defaults.

Texts (`sms`): the plugin is infrastructure with no console page of its own.
The console's texts surfaces are the Commerce settings card's "Also send as
texts" switch (native: `sms.texts`, Customer texts) and the order dialog's
"Resend receipt" Text channel. Both platforms' orders have it now: the
Apple order detail sends a receipt by email or, where the store has texts on,
by text (AGL-3652), which was the one thing keeping the Apple box above
open. The card's per-moment email
switches belong to the Commerce settings and are not part of this row. A
funnel has no page design of its own, so it has no Besigner entry.

Workspace settings (AGL-3671): all twelve sections of `[orgSlug]/settings` and the Plugins pages are native, in the
console's words (`native-workspace-settings-match-the-console.spec.ts` holds them to its source). The logo and favicon
are picked from the workspace's media library with the Setup pickers' field, the time zone from the console's list, a
hold's `?notice=` link opens its review request, and a marketplace plugin's page installs, updates, splits and removes
it (the uninstall impact check included) and draws its settings from its manifest. The console's `PluginSiteSet`
hands the uninstall dialog no plugin id, so its impact check never runs from the plugin page and always asks for the
typed word; the apps pass the listing's, so the check runs. The Integrations page is a slot (`orgSettings`) no plugin
fills today; the native screen has the same slot and the console's empty line.

Not screens: `signin`, `signup`, `signout`, `sso`, `reset-password`,
`verify-email`, `account-recovery`, `auth/handoff/*` and `edit-access` are the
sign-in flows the shell already owns.
