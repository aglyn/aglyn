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
// community) lives directly under `/[orgSlug]`. User-level `manage/*`,
// staff `admin/*`, and `auth` routes are NOT org-scoped. Hosts stay keyed
// by doc id here; AGL-622 swaps `[hostId]` for the subdomain slug.
export enum Route {
  ADMIN_ORGS = '/admin/orgs',
  ADMIN_ORG_DETAIL = '/admin/orgs/[orgId]',
  ADMIN_ORG_HOST_DETAIL = '/admin/orgs/[orgId]/host/[hostId]',
  ADMIN_OVERVIEW = '/admin/overview',
  ADMIN_AUDIT = '/admin/audit',
  ADMIN_USERS = '/admin/users',
  ADMIN_USER_DETAIL = '/admin/users/[uid]',
  ADMIN_FLAGS = '/admin/flags',
  ADMIN_PLUGIN_REVIEWS = '/admin/plugin-reviews',
  ORG_HOME = '/[orgSlug]',
  ORG_MEDIA = '/[orgSlug]/media',
  ORG_DATA = '/[orgSlug]/data',
  ORG_PLUGINS = '/[orgSlug]/plugins',
  ORG_SETTINGS = '/[orgSlug]/settings',
  MANAGE_BILLING = '/[orgSlug]/billing',
  MANAGE_USER_SETTINGS = '/manage/user',
  MANAGE_NOTIFICATIONS = '/manage/notifications',
  MANAGE_MY_COMMUNITY = '/manage/community',
  AUTH_SIGN_IN = '/signin',
  AUTH_SIGN_OUT = '/signout',
  AUTH_SIGN_UP = '/signup',
  AUTH_VERIFY_EMAIL = '/verify-email',
  HOST_LIST = '/[orgSlug]/hosts',
  HOST_COMMUNITY = '/[orgSlug]/hosts/[host]/community',
  HOST_COMMUNITY_LISTING = '/[orgSlug]/hosts/[host]/community/[listingId]',
  HOST_COMMUNITY_PUBLISHER = '/[orgSlug]/hosts/[host]/community/publisher/[profileId]',
  HOST_CONTENT = '/[orgSlug]/hosts/[host]/content',
  MANAGE_COMMUNITY_PROFILE = '/[orgSlug]/community',
  MANAGE_TEAM = '/[orgSlug]/team',
  MANAGE_TEAM_MEMBER = '/[orgSlug]/team/[uid]',
  MANAGE_SUPPORT = '/[orgSlug]/support',
  HOST_DASHBOARD = '/[orgSlug]/hosts/[host]',
  // The catch-all console page a plugin's own nav items resolve against
  // (`app/(app)/[orgSlug]/hosts/[host]/[pluginSlug]/page.tsx`). Plugin slugs
  // are open-ended, so this is the one route whose leaf segment is data.
  HOST_PLUGIN = '/[orgSlug]/hosts/[host]/[pluginSlug]',
  HOST_INBOX = '/[orgSlug]/hosts/[host]/inbox',
  HOST_CONTACTS = '/[orgSlug]/hosts/[host]/contacts',
  HOST_MEDIA = '/[orgSlug]/hosts/[host]/media',
  HOST_SETUP = '/[orgSlug]/hosts/[host]/setup',
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
  LAYOUT_LIST = '/[orgSlug]/hosts/[host]/layouts/list',
  // Layout detail (AGL-695), completing the list → detail → besigner shape
  // across screens, components, templates and layouts.
  LAYOUT_DETAILS = '/[orgSlug]/hosts/[host]/layouts/[layoutId]',
  SCREEN_BESIGNER = '/[orgSlug]/hosts/[host]/screens/[screenId]/versions/[versionId]/besigner',
  SCREEN_DETAILS = '/[orgSlug]/hosts/[host]/screens/[screenId]/versions/[versionId]/view',
  SCREEN_PREVIEW = '/[orgSlug]/hosts/[host]/screens/[screenId]/versions/[versionId]/preview',
  SCREEN_LIST = '/[orgSlug]/hosts/[host]/screens/list',
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
  [Route.ADMIN_AUDIT]: undefined
  [Route.ADMIN_USERS]: undefined
  [Route.ADMIN_USER_DETAIL]: { uid: string }
  [Route.ADMIN_FLAGS]: undefined
  [Route.ADMIN_PLUGIN_REVIEWS]: undefined
  [Route.ORG_MEDIA]: { orgSlug: string }
  [Route.ORG_DATA]: { orgSlug: string }
  [Route.ORG_PLUGINS]: { orgSlug: string }
  [Route.MANAGE_USER_SETTINGS]: undefined
  [Route.MANAGE_NOTIFICATIONS]: undefined
  [Route.MANAGE_MY_COMMUNITY]: undefined
  [Route.ORG_SETTINGS]: { orgSlug: string }
  [Route.HOST_LIST]: { orgSlug: string }
  [Route.HOST_COMMUNITY]: { orgSlug: string; host: string }
  [Route.HOST_COMMUNITY_LISTING]: {
    orgSlug: string
    host: string
    listingId: string
  }
  [Route.HOST_COMMUNITY_PUBLISHER]: {
    orgSlug: string
    host: string
    profileId: string
  }
  [Route.HOST_CONTENT]: { orgSlug: string; host: string }
  [Route.MANAGE_COMMUNITY_PROFILE]: { orgSlug: string }
  [Route.MANAGE_TEAM]: { orgSlug: string }
  [Route.MANAGE_TEAM_MEMBER]: { orgSlug: string; uid: string }
  [Route.MANAGE_SUPPORT]: { orgSlug: string }
  [Route.MANAGE_BILLING]: { orgSlug: string }
  [Route.HOST_INBOX]: { orgSlug: string; host: string }
  [Route.HOST_CONTACTS]: { orgSlug: string; host: string }
  [Route.HOST_SETUP]: { orgSlug: string; host: string }
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
  [Route.LAYOUT_LIST]: { orgSlug: string; host: string }
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
  [Route.SCREEN_LIST]: { orgSlug: string; host: string }
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
