/**
 * @license
 * Copyright 2022 Aglyn LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// URL scheme (AGL-621): the org is a first-class path segment `[orgSlug]`
// so the URL — not client-side precedence — is the source of truth for the
// active workspace. Host routes nest under `/[orgSlug]/hosts/[host]`; the
// org area (settings, team, billing, media, data, plugins, support,
// marketplace) lives directly under `/[orgSlug]`. User-level `manage/*`,
// staff `admin/*`, and `auth` routes are NOT org-scoped. Hosts stay keyed
// by doc id here; AGL-622 swaps `[hostId]` for the subdomain slug.
export enum Route {
  ADMIN_ORGS = '/admin/orgs',
  ADMIN_ORG_DETAIL = '/admin/orgs/[orgId]',
  ADMIN_ORG_HOST_DETAIL = '/admin/orgs/[orgId]/host/[hostId]',
  ADMIN_OVERVIEW = '/admin/overview',
  // Staff coupon management (AGL-1105): create discount coupons + promotion
  // codes and read the live net-margin rating before committing to one.
  ADMIN_COUPONS = '/admin/coupons',
  // The panic button (AGL-1501): platform/org/host/user lockdown controls.
  ADMIN_LOCKDOWN = '/admin/lockdown',
  // The narrow lever beside it (AGL-1687): disable or release ONE uploaded
  // file. Its own page rather than a panel on Lockdown because the input is
  // an asset, not a scope — the two forms share no field but the reason.
  ADMIN_MEDIA_QUARANTINE = '/admin/media-quarantine',
  // The INPUT to the two levers above (AGL-1964). Lockdown and quarantine are
  // both things an operator does after learning there is a problem; until
  // this page there was no way for anyone outside the company to say there
  // was one. Reports arrive from the unauthenticated form the tenant runtime
  // serves at /api/report-abuse on every origin.
  ADMIN_ABUSE_REPORTS = '/admin/abuse-reports',
  // The same input, one collection over (AGL-2310). The marketplace's own
  // report button wrote `marketplaceReports` from the day it shipped and
  // nothing read it — every report filed, acknowledged, and unreachable. This
  // is that queue, deliberately shaped like the abuse one rather than as a
  // second vocabulary for the same act.
  ADMIN_MARKETPLACE_REPORTS = '/admin/marketplace-reports',
  // The probes, on a screen (AGL-1900). /api/health/{backups,rate-limits,
  // signups} and /api/admin/email-health each answered a bad-day question to
  // a curl and to nothing else; this is where an operator reads them.
  ADMIN_HEALTH = '/admin/health',
  // The maintenance jobs, on a screen (AGL-1949). audit-archive,
  // reap-plugin-artifacts and reverify-plugin-versions accepted the shared
  // cron secret and nothing else, so the only way to preview or run one was a
  // shell holding the production secret. Separate from Health because Health
  // reads and this acts.
  ADMIN_MAINTENANCE = '/admin/maintenance',
  // The Texas sales tax return (AGL-1900). The figures AGL-1811 computes had
  // only a curl to reach them; filing happens on a fixed quarterly calendar
  // from 2026-09-01, so the return needs a URL a person can bookmark.
  ADMIN_ASSIST_SIGNALS = '/admin/assist-signals',
  ADMIN_REVENUE = '/admin/revenue',
  ADMIN_TAX_RETURN = '/admin/tax-return',
  ADMIN_AUDIT = '/admin/audit',
  ADMIN_USERS = '/admin/users',
  ADMIN_USER_DETAIL = '/admin/users/[uid]',
  ADMIN_FLAGS = '/admin/flags',
  // Platform-wide settings that are not a release flag (AGL-2486). The
  // free-workspace ceiling was the first of them and it opened the
  // Organizations LIST, above the table — a global lever wedged into the
  // screen for browsing individual orgs. Settings that describe the platform
  // rather than one org belong on their own tab, beside the flags.
  ADMIN_SETTINGS = '/admin/settings',
  ADMIN_PLUGIN_REVIEWS = '/admin/plugin-reviews',
  // One submission or listed plugin in full (AGL-959): the queue index is
  // for scanning, this is where a reviewer reads the manifest, weighs the
  // verifier findings and acts.
  ADMIN_PLUGIN_REVIEW = '/admin/plugin-reviews/[listingId]',
  // Staff support-ticket queue (AGL-849): the operator side of the
  // subscriber `MANAGE_SUPPORT_TICKETS` page — every org's tickets in one place.
  ADMIN_SUPPORT = '/admin/support',
  // Do-not-contact list (AGL-1592): the intake and the queue for Privacy
  // Policy v4 §11's marketing call/text opt-out, and for "delete the phone
  // number you hold for me".
  ADMIN_CONTACT_SUPPRESSIONS = '/admin/contact-suppressions',
  ADMIN_EMAILS = '/admin/emails',
  // The one besigner route with no host and no org in it (AGL-749). A system
  // email belongs to the platform, not to a workspace, so it is staff-scoped
  // like the rest of `/admin/*` rather than nested under `[orgSlug]`.
  ADMIN_EMAIL_BESIGNER = '/admin/emails/[templateKey]/versions/[versionId]/besigner',
  ORG_HOME = '/[orgSlug]',
  ORG_MEDIA = '/[orgSlug]/media',
  ORG_DATA = '/[orgSlug]/data',
  ORG_PLUGINS = '/[orgSlug]/plugins',
  // One plugin, as installed in this workspace (AGL-1007): scope, settings
  // and permissions in one place. The segment takes EITHER identifier
  // (AGL-1010) — a listing id for a marketplace install, a registry id for a
  // first-party plugin — hence `pluginRef` rather than `listingId`.
  ORG_PLUGIN_INSTALLATION = '/[orgSlug]/plugins/[pluginRef]',
  // Org-scope marketplace (AGL-772): the single place to browse, view and
  // install marketplace items. The per-site tab it replaced, and the retired
  // `/[orgSlug]/marketplace` seller area, were removed with the rest of the
  // `marketplace` naming in AGL-975 — the word is being freed for a public
  // forum, and a redirect stub sitting on `/marketplace` would have taken the
  // one path that feature wants.
  ORG_MARKETPLACE = '/[orgSlug]/marketplace',
  /*
   * Marketplace SECTIONS are routes (AGL-693), for the reason the settings
   * and account sections are: a panel that is not open should cost nothing,
   * and the seller half of this hub reads the organization's REVENUE.
   *
   * The four seller sections are the reason the layout gates rather than the
   * rail. As tabs they were simply not rendered for a member without
   * `publishToMarketplace`; as routes each one is reachable by typing its URL,
   * so the refusal has to sit above them all rather than in the list that
   * draws them.
   *
   * Every segment here is shorter than the ten characters `createResourceUid`
   * emits, so none of them can ever shadow a real `[listingId]` sitting at the
   * same level. `upload` rather than `publish` because `publish/plugin` is
   * already a route beneath this one, and two directories contributing the
   * same segment is a tree Next cannot resolve a layout for.
   */
  ORG_MARKETPLACE_BROWSE = '/[orgSlug]/marketplace/browse',
  ORG_MARKETPLACE_INSTALLED = '/[orgSlug]/marketplace/installed',
  ORG_MARKETPLACE_LICENCES = '/[orgSlug]/marketplace/licences',
  ORG_MARKETPLACE_UPLOAD = '/[orgSlug]/marketplace/upload',
  ORG_MARKETPLACE_SELLER_PROFILE = '/[orgSlug]/marketplace/profile',
  ORG_MARKETPLACE_SELLER_LISTINGS = '/[orgSlug]/marketplace/listings',
  ORG_MARKETPLACE_SELLER_PAYOUTS = '/[orgSlug]/marketplace/payouts',
  ORG_MARKETPLACE_SELLER_SALES = '/[orgSlug]/marketplace/sales',
  ORG_MARKETPLACE_LISTING = '/[orgSlug]/marketplace/[listingId]',
  ORG_MARKETPLACE_PUBLISHER = '/[orgSlug]/marketplace/publisher/[handle]',
  // Publishing a plugin is a page, not a modal (AGL-1078): the most
  // consequential thing a publisher does now has a URL, so it can be linked,
  // reloaded, and reached from a listing to ship an update.
  ORG_MARKETPLACE_PUBLISH_PLUGIN = '/[orgSlug]/marketplace/publish/plugin',
  ORG_SETTINGS = '/[orgSlug]/settings',
  /*
   * Settings SECTIONS are routes (AGL-693). `HubTabs` mounted every panel —
   * `keepMounted`, with `lazy` off by default and passed by nobody — so
   * opening General also mounted the API-keys, SSO and data-export cards and
   * ran every read in them. Routes mount one page and code-split per route.
   * `ORG_SETTINGS` itself redirects to General.
   */
  ORG_SETTINGS_GENERAL = '/[orgSlug]/settings/general',
  ORG_SETTINGS_PROFILE = '/[orgSlug]/settings/profile',
  ORG_SETTINGS_PLUGINS = '/[orgSlug]/settings/plugins',
  ORG_SETTINGS_API_KEYS = '/[orgSlug]/settings/api-keys',
  ORG_SETTINGS_BRANDING = '/[orgSlug]/settings/branding',
  ORG_SETTINGS_SSO = '/[orgSlug]/settings/sso',
  ORG_SETTINGS_OWNERSHIP = '/[orgSlug]/settings/ownership',
  ORG_SETTINGS_DELETE = '/[orgSlug]/settings/delete',
  /**
   * Billing, section by section (AGL-693).
   *
   * `MANAGE_BILLING` is unchanged and is the PLAN section — it resolves to a
   * page inside a route group, which adds no path segment. That is what makes
   * this split free: every link in the console, every hash anchor
   * (`#addons`, `#collaborator-seats`) and Stripe's own dunning mail all point
   * here already and none of them moves. No redirect, and no `?tab=` shim to
   * carry forever.
   */
  MANAGE_BILLING = '/[orgSlug]/billing',
  MANAGE_BILLING_USAGE = '/[orgSlug]/billing/usage',
  MANAGE_BILLING_INVOICES = '/[orgSlug]/billing/invoices',
  MANAGE_BILLING_SETTINGS = '/[orgSlug]/billing/settings',
  // The ONE billing URL that carries no org (AGL-2430).
  //
  // Everything else on this table is org-scoped, which is correct for a
  // console and wrong for the only caller that cannot template a URL:
  // Stripe's dunning emails. "Payment method updates" takes a single static
  // link for every customer in the account — there is no `{{org}}` to
  // interpolate — so a table with no org-agnostic billing entry means those
  // emails can only ever point at a page that is not billing. Today all four
  // of them point at the marketing homepage, which is how a failed card
  // becomes a cancelled subscription with no reachable way to fix it.
  //
  // This resolves the org from the SESSION instead of from the URL: one
  // workspace goes straight through, several offer a choice, none says so.
  // `billing` is a reserved subdomain (`RESERVED_SUBDOMAINS`), so no org can
  // hold this slug and the literal segment can never shadow a real
  // `/[orgSlug]`.
  BILLING_ENTRY = '/billing',
  MANAGE_USER_SETTINGS = '/manage/user',
  /*
   * Account SECTIONS are routes (AGL-693). `HubTabs` mounted every panel —
   * `keepMounted`, with `lazy` off by default and passed by nobody — so
   * opening Account also mounted the email-addresses, passkeys, recent
   * sign-ins, data-export and close-account cards and ran every read in them.
   * Routes mount one page and code-split per route.
   *
   * The segments are the ids the panels carried, because a transactional
   * email already in people's inboxes links `/manage/user?tab=security`:
   * `MANAGE_USER_SETTINGS` forwards each of those ids to the section that
   * holds it, and the segment matching the id is what keeps that map a
   * one-liner rather than a second naming scheme.
   */
  MANAGE_USER_ACCOUNT = '/manage/user/account',
  MANAGE_USER_EMAILS = '/manage/user/emails',
  MANAGE_USER_PROFILE = '/manage/user/profile',
  MANAGE_USER_BASIC = '/manage/user/basic',
  MANAGE_USER_SECURITY = '/manage/user/security',
  MANAGE_USER_CLOSE = '/manage/user/close',
  MANAGE_NOTIFICATIONS = '/manage/notifications',
  AUTH_SIGN_IN = '/signin',
  AUTH_SIGN_OUT = '/signout',
  AUTH_SIGN_UP = '/signup',
  AUTH_VERIFY_EMAIL = '/verify-email',
  HOST_LIST = '/[orgSlug]/hosts',
  HOST_CONTENT = '/[orgSlug]/hosts/[host]/content',
  // The collection is a PATH SEGMENT, not `?collection=` (AGL-2498).
  //
  // It was a query parameter because the manager began as one page with a
  // Select on it, and the Select was the only thing that knew which
  // collection you were looking at. That is the wrong owner: which collection
  // is open is the page's IDENTITY, not a filter applied to it. As a
  // parameter it could be dropped by any link that rebuilt the query, it
  // sorted below `?tab=` in a URL nobody could read, and — the reason this
  // moved — it left the entry beneath it with nowhere to hang: an entry is
  // addressed `collection + entry`, and half of that address cannot live in
  // the path while the other half lives in the query.
  //
  // The segment is the collection's SLUG, not its document id, and that is a
  // correction rather than a preference. Collection document ids are not
  // uniform — the seeded ones were given readable ids (`blog`, `changelog`)
  // and everything created since gets a `createResourceUid`, so routing by id
  // produced `/content/changelog` beside `/content/QgXv7lU_rG` on ONE site.
  //
  // A slug is the right key on the merits too: it is unique per host and kind
  // (claimed in a transaction by /api/hosts/collections), it is the
  // collection's own public address, and it is the thing an author recognises.
  // A document id is still ACCEPTED and rewritten to the slug form, so no
  // existing link breaks.
  //
  // `?collection=` still resolves the same way (AGL-845's DAM deep links are
  // in the wild).
  HOST_CONTENT_COLLECTION = '/[orgSlug]/hosts/[host]/content/[collectionSlug]',
  // One entry's detail page (AGL-2498). `entries` is a LITERAL segment rather
  // than `content/[collectionId]/[entryId]`, and it is load-bearing twice
  // over: it mirrors the Firestore path the entry actually lives at
  // (`collections/{c}/entries/{e}`), and it keeps the id space clear so a
  // later sibling — a collection's own settings page, say — cannot be
  // shadowed by an entry that happens to be called the same thing.
  //
  // `[entryId]` also carries the sentinel `new`, which is a draft that has no
  // document yet. Entry ids come from `createResourceUid`, so nothing real
  // can collide with it.
  CONTENT_ENTRY_DETAILS = '/[orgSlug]/hosts/[host]/content/[collectionSlug]/entries/[entryId]',
  MANAGE_TEAM = '/[orgSlug]/team',
  /*
   * Team SECTIONS are routes, not tabs (AGL-693). A section's bundle then
   * arrives when a reader opens it and never before, the section is linkable,
   * and the active state is a fact about the URL rather than state that has to
   * be kept in sync with it. `MANAGE_TEAM` itself redirects to members.
   */
  MANAGE_TEAM_MEMBERS = '/[orgSlug]/team/members',
  MANAGE_TEAM_ROLES = '/[orgSlug]/team/roles',
  MANAGE_TEAM_ACTIVITY = '/[orgSlug]/team/activity',
  MANAGE_TEAM_MEMBER = '/[orgSlug]/team/[uid]',
  // Support is an UMBRELLA, not a page (AGL-1158). The two channels beneath
  // it are separate features that were only ever one screen: they are gated
  // differently (tickets need a first-response commitment, from Pro; the
  // forum is open to every tier including Free) and they fail independently.
  // Sharing one route made them share a blast radius — AGL-1157 was one bad
  // line in the common loader that emptied BOTH lists at once.
  //
  // `MANAGE_SUPPORT` itself stays, and stays the nav tab's href: it now
  // forwards to whichever channel the org's tier makes primary, so a
  // forum-only workspace lands on a whole forum instead of a half-empty page
  // beside a ticket card it may not use.
  MANAGE_SUPPORT = '/[orgSlug]/support',
  MANAGE_SUPPORT_TICKETS = '/[orgSlug]/support/tickets',
  MANAGE_SUPPORT_FORUM = '/[orgSlug]/support/forum',
  HOST_DASHBOARD = '/[orgSlug]/hosts/[host]',
  // The catch-all console page a plugin's own nav items resolve against
  // (`app/(app)/[orgSlug]/hosts/[host]/[pluginSlug]/page.tsx`). Plugin slugs
  // are open-ended, so this is the one route whose leaf segment is data.
  HOST_PLUGIN = '/[orgSlug]/hosts/[host]/[pluginSlug]',
  HOST_INBOX = '/[orgSlug]/hosts/[host]/inbox',
  HOST_CONTACTS = '/[orgSlug]/hosts/[host]/contacts',
  HOST_MEDIA = '/[orgSlug]/hosts/[host]/media',
  HOST_SETUP = '/[orgSlug]/hosts/[host]/setup',
  /*
   * Setup SECTIONS are routes (AGL-693), so an unopened one costs neither a
   * read nor a byte. `HOST_SETUP` stays the nav tab's href and redirects to
   * Basic details, honouring the `?tab=` ids these sections were deep-linked
   * by — unlike the settings and marketplace hubs, links holding those ids are
   * demonstrably in the wild and two are built in this repo.
   */
  HOST_SETUP_DETAILS = '/[orgSlug]/hosts/[host]/setup/details',
  HOST_SETUP_SEO = '/[orgSlug]/hosts/[host]/setup/seo',
  HOST_SETUP_TRACKING = '/[orgSlug]/hosts/[host]/setup/tracking',
  HOST_SETUP_THEME = '/[orgSlug]/hosts/[host]/setup/theme',
  HOST_SETUP_EMAILS = '/[orgSlug]/hosts/[host]/setup/emails',
  // Host Admin area (AGL-1014): owner/admin-only controls — per-site plugin
  // enablement and the Danger zone — out of the Setup page collaborators
  // legitimately visit.
  HOST_ADMIN = '/[orgSlug]/hosts/[host]/admin',
  /*
   * Site-admin SECTIONS are routes (AGL-693), so an unopened one costs neither
   * a read nor a byte. `HOST_ADMIN` redirects to Plugins and still honours the
   * `?tab=` ids these sections were deep-linked by.
   */
  HOST_ADMIN_PLUGINS = '/[orgSlug]/hosts/[host]/admin/plugins',
  /*
   * One plugin, as installed on ONE site (AGL-428, AGL-1014) — the
   * site-scoped twin of `ORG_PLUGIN_INSTALLATION`, reached by clicking a row
   * on the site's plugin
   * list exactly as the workspace list opens its own detail page. The segment
   * is `[pluginRef]` and accepts either identifier for the same reason the
   * workspace route does (AGL-1010): a marketplace install is keyed by listing
   * id, a first-party plugin by its registry id, and an admin does not think
   * of the two as different things.
   */
  HOST_ADMIN_PLUGIN = '/[orgSlug]/hosts/[host]/admin/plugins/[pluginRef]',
  HOST_ADMIN_DOMAIN = '/[orgSlug]/hosts/[host]/admin/domain',
  HOST_ADMIN_SECURITY = '/[orgSlug]/hosts/[host]/admin/security',
  HOST_ADMIN_ACTIVITY = '/[orgSlug]/hosts/[host]/admin/activity',
  HOST_ADMIN_DANGER = '/[orgSlug]/hosts/[host]/admin/danger',
  HOST_THEME = '/[orgSlug]/hosts/[host]/theme',
  HOST_WORKFLOWS = '/[orgSlug]/hosts/[host]/workflows',
  HOST_DATA = '/[orgSlug]/hosts/[host]/data',
  HOST_LOGIC = '/[orgSlug]/hosts/[host]/logic',
  HOST_PRODUCTS = '/[orgSlug]/hosts/[host]/products',
  HOST_COMPONENTS = '/[orgSlug]/hosts/[host]/components',
  // Component detail (AGL-693): the listing links here, and the besigner is
  // reached from here — matching SCREEN_DETAILS rather than jumping a row
  // straight into the editor.
  COMPONENT_DETAILS = '/[orgSlug]/hosts/[host]/components/[componentId]',
  HOST_TEMPLATES = '/[orgSlug]/hosts/[host]/templates',
  // Template detail (AGL-694), the counterpart to COMPONENT_DETAILS. Note
  // TEMPLATE_BESIGNER carries no versionId — templates version but never
  // publish, so there is no "current" pointer to route through.
  TEMPLATE_DETAILS = '/[orgSlug]/hosts/[host]/templates/[templateId]',
  HOST_MARKETING = '/[orgSlug]/hosts/[host]/marketing',
  HOST_BOOKINGS = '/[orgSlug]/hosts/[host]/bookings',
  // Events now come from the events-calendar plugin, served by the generic
  // `[orgSlug]/hosts/[host]/[pluginSlug]` route (AGL-394).
  HOST_REDIRECTS = '/[orgSlug]/hosts/[host]/redirects',
  HOST_USERS = '/[orgSlug]/hosts/[host]/users',
  HOST_ANALYTICS = '/[orgSlug]/hosts/[host]/analytics',
  COMPONENT_BESIGNER = '/[orgSlug]/hosts/[host]/components/[componentId]/versions/[versionId]/besigner',
  TEMPLATE_BESIGNER = '/[orgSlug]/hosts/[host]/templates/[templateId]/besigner',
  LAYOUT_BESIGNER = '/[orgSlug]/hosts/[host]/layouts/[layoutId]/versions/[versionId]/besigner',
  // Draft preview for every besigner document kind (AGL-1203). Screens had
  // the only preview route; components, layouts and templates showed a
  // Preview button that did nothing. Each renders the same localStorage
  // snapshot through the site renderer, so they work on localhost with no
  // deployment. TEMPLATE_PREVIEW carries no versionId, matching
  // TEMPLATE_BESIGNER.
  COMPONENT_PREVIEW = '/[orgSlug]/hosts/[host]/components/[componentId]/versions/[versionId]/preview',
  TEMPLATE_PREVIEW = '/[orgSlug]/hosts/[host]/templates/[templateId]/preview',
  LAYOUT_PREVIEW = '/[orgSlug]/hosts/[host]/layouts/[layoutId]/versions/[versionId]/preview',
  // The list sits at the bare path, like HOST_COMPONENTS. It used to be
  // `/layouts/list`: the pages router had a `layouts/index.tsx` that
  // redirected to `layouts/list.tsx`, and the App Router migration carried
  // the pair over verbatim. Components, added later, had no such legacy and
  // put its list at the bare path — which is the shape we want everywhere.
  // `/layouts/list` still serves the same page so old links survive — an
  // alias, not a redirect, because the bare path used to answer a cached 308
  // pointing at `/list` and redirecting back would loop. See the comment in
  // `app/(app)/[orgSlug]/hosts/[host]/screens/list/page.tsx`.
  HOST_LAYOUTS = '/[orgSlug]/hosts/[host]/layouts',
  // Layout detail (AGL-695), completing the list → detail → besigner shape
  // across screens, components, templates and layouts.
  LAYOUT_DETAILS = '/[orgSlug]/hosts/[host]/layouts/[layoutId]',
  SCREEN_BESIGNER = '/[orgSlug]/hosts/[host]/screens/[screenId]/versions/[versionId]/besigner',
  // Per-site email besigner (AGL-770): a site owner designs a transactional
  // email their site sends. The host-scoped sibling of the staff system-email
  // editor (ADMIN_EMAIL_BESIGNER).
  HOST_EMAIL_BESIGNER = '/[orgSlug]/hosts/[host]/emails/[templateKey]/versions/[versionId]/besigner',
  SCREEN_DETAILS = '/[orgSlug]/hosts/[host]/screens/[screenId]/versions/[versionId]/view',
  SCREEN_PREVIEW = '/[orgSlug]/hosts/[host]/screens/[screenId]/versions/[versionId]/preview',
  // Bare path, matching HOST_LAYOUTS and HOST_COMPONENTS — see the note on
  // HOST_LAYOUTS. `/screens/list` still serves the same page as an alias.
  HOST_SCREENS = '/[orgSlug]/hosts/[host]/screens',
}

/**
 * Params required to build each {@link Route}.
 *
 * Deliberately NOT extended from an index signature (AGL-685). It used to be
 * `extends Record<keyof any, any>`, which meant any `Route` missing an entry
 * here silently typed its payload as `any` — `Route.HOST_SETUP` was one of
 * them, and `buildRoute(Route.HOST_SETUP, { hostId })` compiled cleanly while
 * emitting `/<orgSlug?>/hosts/<host?>/setup`. Without the index signature a
 * new `Route` with no entry is a compile error, which is the whole point of
 * the payload being required in the first place.
 */
export interface RoutePayload {
  [Route.AUTH_SIGN_UP]: undefined
  [Route.AUTH_SIGN_IN]: undefined
  [Route.AUTH_SIGN_OUT]: undefined
  [Route.AUTH_VERIFY_EMAIL]: undefined
  [Route.SCREEN_BESIGNER]: {
    orgSlug: string
    host: string
    screenId: string
    versionId: string
  }
  [Route.ORG_HOME]: { orgSlug: string }
  [Route.HOST_DASHBOARD]: { orgSlug: string; host: string }
  [Route.ADMIN_ORGS]: undefined
  [Route.ADMIN_ORG_DETAIL]: { orgId: string }
  [Route.ADMIN_ORG_HOST_DETAIL]: { orgId: string; hostId: string }
  [Route.ADMIN_OVERVIEW]: undefined
  [Route.ADMIN_COUPONS]: undefined
  [Route.ADMIN_LOCKDOWN]: undefined
  [Route.ADMIN_MEDIA_QUARANTINE]: undefined
  [Route.ADMIN_ABUSE_REPORTS]: undefined
  [Route.ADMIN_MARKETPLACE_REPORTS]: undefined
  [Route.ADMIN_HEALTH]: undefined
  [Route.ADMIN_MAINTENANCE]: undefined
  [Route.ADMIN_ASSIST_SIGNALS]: undefined
  [Route.ADMIN_REVENUE]: undefined
  [Route.ADMIN_TAX_RETURN]: undefined
  [Route.ADMIN_AUDIT]: undefined
  [Route.ADMIN_USERS]: undefined
  [Route.ADMIN_USER_DETAIL]: { uid: string }
  [Route.ADMIN_FLAGS]: undefined
  [Route.ADMIN_SETTINGS]: undefined
  [Route.ADMIN_PLUGIN_REVIEWS]: undefined
  [Route.ADMIN_PLUGIN_REVIEW]: { listingId: string }
  [Route.ADMIN_SUPPORT]: undefined
  [Route.ADMIN_CONTACT_SUPPRESSIONS]: undefined
  [Route.ADMIN_EMAILS]: undefined
  [Route.ADMIN_EMAIL_BESIGNER]: { templateKey: string; versionId: string }
  [Route.HOST_EMAIL_BESIGNER]: {
    orgSlug: string
    host: string
    templateKey: string
    versionId: string
  }
  [Route.ORG_MEDIA]: { orgSlug: string }
  [Route.ORG_DATA]: { orgSlug: string }
  [Route.ORG_PLUGINS]: { orgSlug: string }
  [Route.ORG_PLUGIN_INSTALLATION]: { orgSlug: string; pluginRef: string }
  [Route.ORG_MARKETPLACE]: { orgSlug: string }
  [Route.ORG_MARKETPLACE_BROWSE]: { orgSlug: string }
  [Route.ORG_MARKETPLACE_INSTALLED]: { orgSlug: string }
  [Route.ORG_MARKETPLACE_LICENCES]: { orgSlug: string }
  [Route.ORG_MARKETPLACE_UPLOAD]: { orgSlug: string }
  [Route.ORG_MARKETPLACE_SELLER_PROFILE]: { orgSlug: string }
  [Route.ORG_MARKETPLACE_SELLER_LISTINGS]: { orgSlug: string }
  [Route.ORG_MARKETPLACE_SELLER_PAYOUTS]: { orgSlug: string }
  [Route.ORG_MARKETPLACE_SELLER_SALES]: { orgSlug: string }
  [Route.ORG_MARKETPLACE_LISTING]: { orgSlug: string; listingId: string }
  [Route.ORG_MARKETPLACE_PUBLISHER]: { orgSlug: string; handle: string }
  [Route.ORG_MARKETPLACE_PUBLISH_PLUGIN]: { orgSlug: string }
  [Route.MANAGE_USER_SETTINGS]: undefined
  [Route.MANAGE_USER_ACCOUNT]: undefined
  [Route.MANAGE_USER_EMAILS]: undefined
  [Route.MANAGE_USER_PROFILE]: undefined
  [Route.MANAGE_USER_BASIC]: undefined
  [Route.MANAGE_USER_SECURITY]: undefined
  [Route.MANAGE_USER_CLOSE]: undefined
  [Route.MANAGE_NOTIFICATIONS]: undefined
  [Route.ORG_SETTINGS]: { orgSlug: string }
  [Route.ORG_SETTINGS_GENERAL]: { orgSlug: string }
  [Route.ORG_SETTINGS_PROFILE]: { orgSlug: string }
  [Route.ORG_SETTINGS_PLUGINS]: { orgSlug: string }
  [Route.ORG_SETTINGS_API_KEYS]: { orgSlug: string }
  [Route.ORG_SETTINGS_BRANDING]: { orgSlug: string }
  [Route.ORG_SETTINGS_SSO]: { orgSlug: string }
  [Route.ORG_SETTINGS_OWNERSHIP]: { orgSlug: string }
  [Route.ORG_SETTINGS_DELETE]: { orgSlug: string }
  [Route.HOST_LIST]: { orgSlug: string }
  [Route.HOST_CONTENT]: { orgSlug: string; host: string }
  [Route.HOST_CONTENT_COLLECTION]: {
    orgSlug: string
    host: string
    /** The collection's slug — see the route. A document id also resolves. */
    collectionSlug: string
  }
  [Route.CONTENT_ENTRY_DETAILS]: {
    orgSlug: string
    host: string
    collectionSlug: string
    /**
     * An entry id, or the literal `new` for a draft with no document yet.
     *
     * An ID here while the collection above is a SLUG, deliberately. An entry
     * slug is unique only WITHIN its collection and it is editable on the
     * detail page — so routing by it would move the console address out from
     * under someone in the middle of typing in the slug field, and a draft has
     * no slug at all to route by. The entry id is also what every activity
     * record and the DAM's "Used on" list already carry.
     */
    entryId: string
  }
  [Route.MANAGE_TEAM]: { orgSlug: string }
  [Route.MANAGE_TEAM_MEMBERS]: { orgSlug: string }
  [Route.MANAGE_TEAM_ROLES]: { orgSlug: string }
  [Route.MANAGE_TEAM_ACTIVITY]: { orgSlug: string }
  [Route.MANAGE_TEAM_MEMBER]: { orgSlug: string; uid: string }
  [Route.MANAGE_SUPPORT]: { orgSlug: string }
  [Route.MANAGE_SUPPORT_TICKETS]: { orgSlug: string }
  [Route.MANAGE_SUPPORT_FORUM]: { orgSlug: string }
  [Route.MANAGE_BILLING]: { orgSlug: string }
  [Route.MANAGE_BILLING_USAGE]: { orgSlug: string }
  [Route.MANAGE_BILLING_INVOICES]: { orgSlug: string }
  [Route.MANAGE_BILLING_SETTINGS]: { orgSlug: string }
  [Route.BILLING_ENTRY]: undefined
  [Route.HOST_INBOX]: { orgSlug: string; host: string }
  [Route.HOST_CONTACTS]: { orgSlug: string; host: string }
  [Route.HOST_SETUP]: { orgSlug: string; host: string }
  [Route.HOST_SETUP_DETAILS]: { orgSlug: string; host: string }
  [Route.HOST_SETUP_SEO]: { orgSlug: string; host: string }
  [Route.HOST_SETUP_TRACKING]: { orgSlug: string; host: string }
  [Route.HOST_SETUP_THEME]: { orgSlug: string; host: string }
  [Route.HOST_SETUP_EMAILS]: { orgSlug: string; host: string }
  [Route.HOST_ADMIN]: { orgSlug: string; host: string }
  [Route.HOST_ADMIN_PLUGINS]: { orgSlug: string; host: string }
  [Route.HOST_ADMIN_PLUGIN]: { orgSlug: string; host: string; pluginRef: string }
  [Route.HOST_ADMIN_DOMAIN]: { orgSlug: string; host: string }
  [Route.HOST_ADMIN_SECURITY]: { orgSlug: string; host: string }
  [Route.HOST_ADMIN_ACTIVITY]: { orgSlug: string; host: string }
  [Route.HOST_ADMIN_DANGER]: { orgSlug: string; host: string }
  [Route.HOST_PLUGIN]: { orgSlug: string; host: string; pluginSlug: string }
  [Route.HOST_MEDIA]: { orgSlug: string; host: string }
  [Route.HOST_THEME]: { orgSlug: string; host: string }
  [Route.HOST_WORKFLOWS]: { orgSlug: string; host: string }
  [Route.HOST_DATA]: { orgSlug: string; host: string }
  [Route.HOST_LOGIC]: { orgSlug: string; host: string }
  [Route.HOST_PRODUCTS]: { orgSlug: string; host: string }
  [Route.HOST_COMPONENTS]: { orgSlug: string; host: string }
  [Route.COMPONENT_DETAILS]: {
    orgSlug: string
    host: string
    componentId: string
  }
  [Route.HOST_TEMPLATES]: { orgSlug: string; host: string }
  [Route.TEMPLATE_DETAILS]: {
    orgSlug: string
    host: string
    templateId: string
  }
  [Route.HOST_MARKETING]: { orgSlug: string; host: string }
  [Route.HOST_BOOKINGS]: { orgSlug: string; host: string }
  [Route.HOST_REDIRECTS]: { orgSlug: string; host: string }
  [Route.HOST_USERS]: { orgSlug: string; host: string }
  [Route.HOST_ANALYTICS]: { orgSlug: string; host: string }
  [Route.COMPONENT_BESIGNER]: {
    orgSlug: string
    host: string
    componentId: string
    versionId: string
  }
  [Route.TEMPLATE_BESIGNER]: {
    orgSlug: string
    host: string
    templateId: string
  }
  [Route.LAYOUT_BESIGNER]: {
    orgSlug: string
    host: string
    layoutId: string
    versionId: string
  }
  [Route.COMPONENT_PREVIEW]: {
    orgSlug: string
    host: string
    componentId: string
    versionId: string
  }
  [Route.TEMPLATE_PREVIEW]: {
    orgSlug: string
    host: string
    templateId: string
  }
  [Route.LAYOUT_PREVIEW]: {
    orgSlug: string
    host: string
    layoutId: string
    versionId: string
  }
  [Route.HOST_LAYOUTS]: { orgSlug: string; host: string }
  [Route.LAYOUT_DETAILS]: { orgSlug: string; host: string; layoutId: string }
  [Route.SCREEN_DETAILS]: {
    orgSlug: string
    host: string
    screenId: string
    versionId: string
  }
  [Route.SCREEN_PREVIEW]: {
    orgSlug: string
    host: string
    screenId: string
    versionId: string
  }
  [Route.HOST_SCREENS]: { orgSlug: string; host: string }
}

export const routeReplacePattern = /\[([^\]]+)\]/g

/**
 * Builds a concrete path from a {@link Route} template. The payload is
 * REQUIRED whenever the route declares params (e.g. `orgSlug`, `hostId`) and
 * omitted only for param-less routes — so a forgotten `orgSlug` is a compile
 * error, not a `/<orgSlug?>/…` link that breaks at runtime (AGL-621).
 */
export function buildRoute<Tmpl extends Route>(
  template: Tmpl,
  ...[payload]: RoutePayload[Tmpl] extends undefined
    ? [payload?: undefined]
    : [payload: RoutePayload[Tmpl]]
) {
  return template.replace(routeReplacePattern, (match, key) => {
    const value = (payload as Record<string, unknown> | undefined)?.[key]
    return value != null ? String(value) : `<${key}?>`
  })
}
