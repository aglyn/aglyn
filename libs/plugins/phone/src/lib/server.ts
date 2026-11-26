/**
 * @license
 * Copyright 2026 Aglyn LLC
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

import {
  registerPluginApiRoute,
  registerPluginPermissions,
  type PluginApiRequestSubject,
} from '@aglyn/aglyn/server'
import { PHONE_API_ROUTES } from './constants/api-routes'
import { PHONE_PERMISSIONS } from './constants/bundle-common'

/**
 * Phone's SERVER half (AGL-4251), `@aglyn/plugins-phone/server`, named in
 * `plugins.config.json` as `consoleApi`.
 *
 * Every write to a `phone*` collection is made by a handler below; the
 * Firestore rules match none of them, so no client reads or writes them.
 * Member routes name their organization so the dispatcher's release gate asks
 * about it (`release_phone` is off by default). Twilio's webhooks are
 * `machine` routes: no session, each checks Twilio's signature itself.
 */

const ORG_ID = /^[A-Za-z0-9_-]{1,128}$/

/** The organization a member route names, in the query or the JSON body. */
export async function phoneOrgSubject(request: Request): Promise<PluginApiRequestSubject | null> {
  const fromQuery = new URL(request.url).searchParams.get('orgId')
  if (fromQuery && ORG_ID.test(fromQuery)) return { orgId: fromQuery }
  if (request.method === 'GET' || request.method === 'HEAD') return null
  const body = (await request.json().catch(() => null)) as { orgId?: unknown } | null
  return typeof body?.orgId === 'string' && ORG_ID.test(body.orgId) ? { orgId: body.orgId } : null
}

type RouteKey = keyof typeof PHONE_API_ROUTES

/** Member routes, by their key in `PHONE_API_ROUTES`. */
const MEMBER_ROUTES: readonly RouteKey[] = [
  'status',
  'numbersSearch',
  'numbersBuy',
  'numbersUpdate',
  'numbersRelease',
  'threads',
  'thread',
  'threadArchive',
  'send',
  'settings',
  'compliance',
  'complianceRefresh',
  'ports',
  'calls',
  'callsPlace',
]

/** Twilio's signed webhooks. */
const HOOK_ROUTES: readonly RouteKey[] = [
  'hookSms',
  'hookSmsStatus',
  'hookVoice',
  'hookVoiceStatus',
  'hookVoiceDial',
  'hookVoicemail',
  'hookTranscription',
  'hookOutbound',
]

/** The handler for one route, from the platform wiring loaded on the first request. */
function lazy(key: RouteKey) {
  return async (request: Request) => {
    const handler = (await import('./server/platform')).platformPhoneRoutes()[key]
    return handler ? handler(request) : new Response('Not found', { status: 404 })
  }
}

export function registerPhoneConsoleApi(): void {
  registerPluginPermissions(PHONE_PERMISSIONS)
  for (const key of MEMBER_ROUTES) {
    registerPluginApiRoute(PHONE_API_ROUTES[key], { web: lazy(key) }, { subject: phoneOrgSubject })
  }
  for (const key of HOOK_ROUTES) {
    registerPluginApiRoute(PHONE_API_ROUTES[key], { web: lazy(key) }, { machine: true })
  }
}

export { MEMBER_ROUTES as PHONE_MEMBER_ROUTE_KEYS, HOOK_ROUTES as PHONE_HOOK_ROUTE_KEYS }
