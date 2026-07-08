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

export enum Route {
  MANAGE_ACCOUNT_SETTINGS = '/manage/account',
  ADMIN_TENANTS = '/admin/tenants',
  ADMIN_OVERVIEW = '/admin/overview',
  MANAGE_BILLING = '/manage/billing',
  MANAGE_USER_SETTINGS = '/manage/user',
  AUTH_SIGN_IN = '/signin',
  AUTH_SIGN_OUT = '/signout',
  AUTH_SIGN_UP = '/signup',
  AUTH_VERIFY_EMAIL = '/verify-email',
  HOST_LIST = '/hosts',
  HOST_COMMUNITY = '/[hostId]/community',
  HOST_COMMUNITY_LISTING = '/[hostId]/community/[listingId]',
  HOST_COMMUNITY_PUBLISHER = '/[hostId]/community/publisher/[profileId]',
  HOST_CONTENT = '/[hostId]/content',
  MANAGE_COMMUNITY_PROFILE = '/manage/community',
  MANAGE_TEAM = '/manage/team',
  MANAGE_SUPPORT = '/manage/support',
  HOST_DASHBOARD = '/[hostId]',
  HOST_INBOX = '/[hostId]/inbox',
  HOST_CONTACTS = '/[hostId]/contacts',
  HOST_MEDIA = '/[hostId]/media',
  HOST_SETUP = '/[hostId]/setup',
  HOST_THEME = '/[hostId]/theme',
  HOST_WORKFLOWS = '/[hostId]/workflows',
  HOST_DATA = '/[hostId]/data',
  HOST_BOOKINGS = '/[hostId]/bookings',
  HOST_EVENTS = '/[hostId]/events',
  HOST_REDIRECTS = '/[hostId]/redirects',
  LAYOUT_BESIGNER = '/[hostId]/layouts/[layoutId]/versions/[versionId]/besigner',
  LAYOUT_LIST = '/[hostId]/layouts/list',
  SCREEN_BESIGNER = '/[hostId]/screens/[screenId]/versions/[versionId]/besigner',
  SCREEN_DETAILS = '/[hostId]/screens/[screenId]/versions/[versionId]/view',
  SCREEN_PREVIEW = '/[hostId]/screens/[screenId]/versions/[versionId]/preview',
  SCREEN_LIST = '/[hostId]/screens/list',
}

export interface RoutePayload extends Record<keyof any, any> {
  [Route.AUTH_SIGN_UP]: undefined
  [Route.AUTH_SIGN_IN]: undefined
  [Route.AUTH_SIGN_OUT]: undefined
  [Route.AUTH_VERIFY_EMAIL]: undefined
  [Route.SCREEN_BESIGNER]: {
    hostId: string
    screenId: string
    versionId: string
  }
  [Route.HOST_DASHBOARD]: { hostId: string }
  [Route.ADMIN_TENANTS]: undefined
  [Route.ADMIN_OVERVIEW]: undefined
  [Route.HOST_COMMUNITY]: { hostId: string }
  [Route.HOST_COMMUNITY_LISTING]: { hostId: string; listingId: string }
  [Route.HOST_COMMUNITY_PUBLISHER]: { hostId: string; profileId: string }
  [Route.HOST_CONTENT]: { hostId: string }
  [Route.MANAGE_COMMUNITY_PROFILE]: undefined
  [Route.MANAGE_TEAM]: undefined
  [Route.MANAGE_SUPPORT]: undefined
  [Route.HOST_INBOX]: { hostId: string }
  [Route.HOST_MEDIA]: { hostId: string }
  [Route.HOST_THEME]: { hostId: string }
  [Route.HOST_WORKFLOWS]: { hostId: string }
  [Route.HOST_DATA]: { hostId: string }
  [Route.HOST_BOOKINGS]: { hostId: string }
  [Route.HOST_EVENTS]: { hostId: string }
  [Route.HOST_REDIRECTS]: { hostId: string }
  [Route.LAYOUT_BESIGNER]: {
    hostId: string
    layoutId: string
    versionId: string
  }
  [Route.LAYOUT_LIST]: { hostId: string }
  [Route.SCREEN_DETAILS]: {
    hostId: string
    screenId: string
    versionId: string
  }
  [Route.SCREEN_PREVIEW]: {
    hostId: string
    screenId: string
    versionId: string
  }
  [Route.SCREEN_LIST]: { hostId: string }
}

export const routeReplacePattern = /\[([^\]]+)\]/g

export function buildRoute<Tmpl extends Route>(
  template: Tmpl,
  payload?: RoutePayload[Tmpl],
) {
  return template.replace(routeReplacePattern, (match, key) => {
    const value = payload?.[key]
    return value != null ? String(value) : `<${key}?>`
  })
}
