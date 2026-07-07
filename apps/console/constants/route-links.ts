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
  MANAGE_BILLING = '/manage/billing',
  MANAGE_USER_SETTINGS = '/manage/user',
  AUTH_SIGN_IN = '/signin',
  AUTH_SIGN_OUT = '/signout',
  AUTH_SIGN_UP = '/signup',
  AUTH_VERIFY_EMAIL = '/verify-email',
  HOST_LIST = '/hosts',
  HOST_CONTENT = '/[hostId]/content',
  HOST_DASHBOARD = '/[hostId]',
  HOST_INBOX = '/[hostId]/inbox',
  HOST_MEDIA = '/[hostId]/media',
  HOST_SETUP = '/[hostId]/setup',
  HOST_THEME = '/[hostId]/theme',
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
  [Route.HOST_CONTENT]: { hostId: string }
  [Route.HOST_INBOX]: { hostId: string }
  [Route.HOST_MEDIA]: { hostId: string }
  [Route.HOST_THEME]: { hostId: string }
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
