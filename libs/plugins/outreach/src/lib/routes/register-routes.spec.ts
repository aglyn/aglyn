/**
 * @jest-environment node
 *
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
  resolvePluginApiMatch,
  resolvePluginApiRequestSubject,
} from '@aglyn/aglyn/server'
import { OUTREACH_API_ROUTES } from '../constants/api-routes'
import type { OutreachEnrollRouteDeps } from './enroll-routes'
import { registerOutreachRoutes } from './register-routes'

/**
 * The settings, sequence and enrollment routes name their organization to
 * the release gate (AGL-2980).
 *
 * None of these requests names a site, so the dispatcher learns the
 * organization only from the subject a route declares. Undeclared, the gate
 * reads the request as anonymous and passes it only for a fully enabled
 * `release_outreach` or a staff session: an override releasing Outreach to
 * one organization would reach its Mailboxes page and 404 everything else.
 *
 * The registry here is the real one, and each request is shaped as the
 * console's `useOutreachApi` sends it. The dispatcher's use of a subject —
 * the gate asked about that org, and a subject never a bypass — is held by
 * `apps/console/specs/plugin-release-gate-route-subject.spec.ts`.
 */

const ORG = 'org-1'
const ORIGIN = 'https://console.example.com/api/'

/** Every route this module registers, with the method the console sends it. */
const ROUTES: ReadonlyArray<readonly [string, 'GET' | 'POST']> = [
  [OUTREACH_API_ROUTES.settings, 'GET'],
  [OUTREACH_API_ROUTES.settings, 'POST'],
  [OUTREACH_API_ROUTES.sequencesSave, 'POST'],
  [OUTREACH_API_ROUTES.sequencesStatus, 'POST'],
  [OUTREACH_API_ROUTES.sequencesDelete, 'POST'],
  [OUTREACH_API_ROUTES.enrollPreview, 'POST'],
  [OUTREACH_API_ROUTES.enroll, 'POST'],
  [OUTREACH_API_ROUTES.enrollmentsAction, 'POST'],
  [OUTREACH_API_ROUTES.preview, 'POST'],
  [OUTREACH_API_ROUTES.doNotContactDomains, 'GET'],
  [OUTREACH_API_ROUTES.doNotContactDomains, 'POST'],
]

/** The request the console sends: the org in the query for a read, in the body otherwise. */
function consoleRequest(route: string, method: 'GET' | 'POST', orgId: string = ORG): Request {
  const headers = { authorization: 'Bearer member-token' }
  if (method === 'GET') {
    return new Request(`${ORIGIN}${route}?orgId=${encodeURIComponent(orgId)}`, { headers })
  }
  return new Request(`${ORIGIN}${route}`, {
    method,
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ orgId, sequenceId: 'seq-1' }),
  })
}

let askedAbout: string[]

/**
 * Dependencies that let a request through to the membership question and no
 * further: the org the gate was asked about is the org the handler read.
 */
function deps(): OutreachEnrollRouteDeps {
  const unused = () => {
    throw new Error('not reached: the gate refuses first')
  }
  return {
    firestore: unused,
    now: () => 0,
    random: () => 0,
    logOrgActivity: unused,
    crmViewEmails: unused,
    stampRecordEmailState: unused,
    gate: {
      verifyIdToken: async () =>
        ({ uid: 'member-1', email: 'casey.morgan@example.com', email_verified: true }) as never,
      resolveOrgPermissions: async (_uid, context) => {
        askedAbout.push(context.orgId)
        return { orgId: context.orgId, role: null, isOwner: false, orgWide: false, permissions: {} }
      },
      holdsOrgCatalogPermission: unused,
      readOrg: unused,
      lockdownRefusal: unused,
    },
  }
}

beforeAll(() => {
  registerOutreachRoutes(deps())
})

beforeEach(() => {
  askedAbout = []
})

describe('the Outreach routes name their organization to the release gate (AGL-2980)', () => {
  it.each(ROUTES)('%s (%s) names the org the console sent', async (route, method) => {
    expect(resolvePluginApiMatch(route)).toBeDefined()
    expect(await resolvePluginApiRequestSubject(route, consoleRequest(route, method))).toEqual({ orgId: ORG })
  })

  it('names none for an org id that is not a plain path segment, which the gate reads as anonymous', async () => {
    for (const [route, method] of ROUTES) {
      expect([route, method, await resolvePluginApiRequestSubject(route, consoleRequest(route, method, 'orgs/x'))])
        .toEqual([route, method, null])
    }
  })

  it.each(ROUTES)('%s (%s) still hands its handler the whole request after the gate read it', async (route, method) => {
    const request = consoleRequest(route, method)
    await resolvePluginApiRequestSubject(route, request)
    const match = resolvePluginApiMatch(route)
    const handler = match?.route
    if (!handler || typeof handler === 'function') throw new Error(`${route} is not a web route`)
    const response = await handler.web(request, { params: match.params })
    // Read after the subject: a body the reader had consumed would leave the
    // handler no org, and the route would answer 400 `org-required`.
    expect(askedAbout).toEqual([ORG])
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ reason: 'not-a-member' })
  })
})
