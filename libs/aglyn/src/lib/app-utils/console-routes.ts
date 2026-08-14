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
  ADMIN_AUDIT = '/admin/audit',
  ADMIN_USERS = '/admin/users',
  ADMIN_USER_DETAIL = '/admin/users/[uid]',
  ADMIN_FLAGS = '/admin/flags',
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
  ORG_MARKETPLACE_LISTING = '/[orgSlug]/marketplace/[listingId]',
  ORG_MARKETPLACE_PUBLISHER = '/[orgSlug]/marketplace/publisher/[handle]',
  // Publishing a plugin is a page, not a modal (AGL-1078): the most
  // consequential thing a publisher does now has a URL, so it can be linked,
  // reloaded, and reached from a listing to ship an update.
  ORG_MARKETPLACE_PUBLISH_PLUGIN = '/[orgSlug]/marketplace/publish/plugin',
  ORG_SETTINGS = '/[orgSlug]/settings',
  MANAGE_BILLING = '/[orgSlug]/billing',
  MANAGE_USER_SETTINGS = '/manage/user',
  MANAGE_NOTIFICATIONS = '/manage/notifications',
  AUTH_SIGN_IN = '/signin',
  AUTH_SIGN_OUT = '/signout',
  AUTH_SIGN_UP = '/signup',
  AUTH_VERIFY_EMAIL = '/verify-email',
  HOST_LIST = '/[orgSlug]/hosts',
  HOST_CONTENT = '/[orgSlug]/hosts/[host]/content',
  MANAGE_TEAM = '/[orgSlug]/team',
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
  // Host Admin area (AGL-1014): owner/admin-only controls — per-site plugin
  // enablement and the Danger zone — out of the Setup page collaborators
  // legitimately visit.
  HOST_ADMIN = '/[orgSlug]/hosts/[host]/admin',
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
  [Route.ADMIN_AUDIT]: undefined
  [Route.ADMIN_USERS]: undefined
  [Route.ADMIN_USER_DETAIL]: { uid: string }
  [Route.ADMIN_FLAGS]: undefined
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
  [Route.ORG_MARKETPLACE_LISTING]: { orgSlug: string; listingId: string }
  [Route.ORG_MARKETPLACE_PUBLISHER]: { orgSlug: string; handle: string }
  [Route.ORG_MARKETPLACE_PUBLISH_PLUGIN]: { orgSlug: string }
  [Route.MANAGE_USER_SETTINGS]: undefined
  [Route.MANAGE_NOTIFICATIONS]: undefined
  [Route.ORG_SETTINGS]: { orgSlug: string }
  [Route.HOST_LIST]: { orgSlug: string }
  [Route.HOST_CONTENT]: { orgSlug: string; host: string }
  [Route.MANAGE_TEAM]: { orgSlug: string }
  [Route.MANAGE_TEAM_MEMBER]: { orgSlug: string; uid: string }
  [Route.MANAGE_SUPPORT]: { orgSlug: string }
  [Route.MANAGE_SUPPORT_TICKETS]: { orgSlug: string }
  [Route.MANAGE_SUPPORT_FORUM]: { orgSlug: string }
  [Route.MANAGE_BILLING]: { orgSlug: string }
  [Route.HOST_INBOX]: { orgSlug: string; host: string }
  [Route.HOST_CONTACTS]: { orgSlug: string; host: string }
  [Route.HOST_SETUP]: { orgSlug: string; host: string }
  [Route.HOST_ADMIN]: { orgSlug: string; host: string }
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
