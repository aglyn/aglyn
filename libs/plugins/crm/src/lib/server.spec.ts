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

/**
 * The Contacts plugin's server half is WIRED, not merely written (AGL-2595).
 *
 * Three things have to agree for `/api/crm/<route>` to reach a handler
 * in this plugin, and each is a file nothing else reads back:
 *
 *  1. `plugins.config.json` names the register function under `consoleApi`
 *     and lists `contacts` under `apiPrefixes` — the loader activates a
 *     plugin's server bundle for a request only when the first path segment
 *     is one of its prefixes.
 *  2. The generated console server manifest carries the same entry — it is
 *     the ONLY code outside `libs/plugins` that may import this bundle, and
 *     a stale one loads nothing with no error.
 *  3. The register function actually registers a route the dispatcher can
 *     resolve, and that route answers.
 *
 * The first two are read off disk rather than imported: the manifest is a
 * dynamic-import table into every plugin's server bundle, and importing it
 * from a plugin spec would pull the whole estate into one jest worker.
 */

/*
 * The task routes (AGL-2599) and the import route (AGL-2602) pull the Admin
 * SDK, the workflow runner and the admin barrel into this module's import
 * graph. None loads under jsdom — `next/cache` extends a `Request` the
 * environment does not define — and none is what this suite is about, so
 * each is stubbed to the shape the routes import. Every assertion here is
 * about the WIRING: a route resolves and refuses the wrong method before it
 * reads a token, a body or a document, so nothing ever calls into a stub.
 * The routes' own behavior is `server/task-routes.spec.ts` and
 * `server/contacts-import.spec.ts`, each with a double shaped for it.
 */
jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: { serverTimestamp: () => '__serverTimestamp', delete: () => '__delete' },
}))
jest.mock('@aglyn/tenant-runtime', () => ({
  __esModule: true,
  emitHostEvent: jest.fn(),
}))
jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: { app: () => ({}) },
  getOrgForHost: jest.fn(),
  resolveOrgMembership: jest.fn(),
  memberHasOrgPermission: jest.fn(),
  notifyUsers: jest.fn(),
}))

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { resolvePluginApiRoute } from '@aglyn/aglyn/server'

// The deal-stage route pulls the Admin SDK and the tenant runtime into the
// server entry (AGL-2598); this spec proves the WIRING of the entry, and
// that route has its own spec with those modules doubled. Stubbed here so
// the wiring test loads what it tests and nothing heavier.
jest.mock('./server-deal-stage', () => ({
  crmDealStageHandler: jest.fn(),
}))
// The one-to-one email route (AGL-2615) reaches the mail provider seam and
// the Admin SDK; its behavior is `server/email-send.spec.ts`. Stubbed here
// for the same reason the deal-stage route is.
jest.mock('./server/email-send', () => ({
  crmEmailSendHandler: jest.fn(),
}))
import { CRM_API_ROUTES } from './constants/api-routes'
import { BUNDLE_ID } from './constants/bundle-common'
import { CRM_TASK_ROUTES } from './model/task-routes'
import { registerCrmConsoleApi } from './server'

/*
 * The admin SDK barrel is a dependency of the create route (AGL-2596), not
 * of the ping, and loading it for real drags Next's server runtime into a
 * jsdom worker. An inert double keeps this file about the WIRING; the route
 * has its own spec with a faithful one.
 */
jest.mock('@aglyn/tenant-data-admin', () => ({}))
jest.mock('firebase-admin/firestore', () => ({ FieldValue: {} }))

const REPO_ROOT = join(__dirname, '../../../../..')

/*
 * The lead-convert route (AGL-2608) reaches the Admin SDK and the org
 * permission resolver, and the real `@aglyn/tenant-data-admin` barrel pulls
 * `next/server` into a jsdom worker, where its request class has nothing to
 * extend. This file proves the WIRING — that a registered path resolves and
 * answers — so those boundaries are stubs; the route's own behavior is
 * proved in `server/lead-convert.spec.ts` against an in-memory Firestore.
 */
jest.mock('@aglyn/tenant-data-admin', () => ({
  firebaseAdmin: { app: () => ({}) },
  getOrgForHost: async () => null,
  consentGroupForSite: async () => null,
  orgDataCollectionForHost: async () => null,
  upsertHostContact: async () => undefined,
}))
jest.mock('@aglyn/tenant-runtime/org-permissions', () => ({
  resolveOrgPermissions: async () => null,
}))
jest.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => null, arrayUnion: () => null },
  FieldPath: { documentId: () => '__name__' },
}))

/** Drives one registered handler and returns what it answered. */
async function call(path: string, method: string, requestBody?: unknown) {
  const handler = resolvePluginApiRoute(path)
  expect(handler).toBeDefined()
  let status = 0
  let body: unknown
  const headers: Record<string, unknown> = {}
  const res: any = {
    status: (code: number) => {
      status = code
      return res
    },
    json: (value: unknown) => {
      body = value
    },
    send: (value: unknown) => {
      body = value
    },
    setHeader: (name: string, value: unknown) => {
      headers[name] = value
    },
    redirect: () => undefined,
    end: () => undefined,
  }
  await handler?.(
    { method, query: {}, body: requestBody, headers: {}, cookies: {}, socket: {} },
    res,
  )
  return { status, body, headers }
}

describe('the CRM server entry', () => {
  it('is named in plugins.config.json with the contacts API prefix', () => {
    const config = JSON.parse(
      readFileSync(join(REPO_ROOT, 'plugins.config.json'), 'utf8'),
    ) as { plugins: Array<{ id: string; register: Record<string, string>; apiPrefixes?: string[] }> }
    const entry = config.plugins.find((plugin) => plugin.id === BUNDLE_ID)
    expect(entry?.register['consoleApi']).toBe('registerCrmConsoleApi')
    expect(entry?.apiPrefixes).toEqual(['crm'])
  })

  it('is carried by the generated console server manifest', () => {
    const manifest = readFileSync(
      join(REPO_ROOT, 'apps/console/constants/plugins.server.generated.ts'),
      'utf8',
    )
    expect(manifest).toContain("id: 'crm'")
    expect(manifest).toContain('apiPrefixes: ["crm"]')
    expect(manifest).toContain('registerCrmConsoleApi')
    expect(manifest).toContain("import('@aglyn/plugins-crm/server')")
  })

  it('registers crm/ping, which answers a GET', async () => {
    registerCrmConsoleApi()
    const { status, body } = await call('crm/ping', 'GET')
    expect(status).toBe(200)
    expect(body).toEqual({ ok: true, plugin: 'crm' })
  })

  it('refuses any other method on the ping', async () => {
    registerCrmConsoleApi()
    const { status, headers } = await call('crm/ping', 'POST')
    expect(status).toBe(405)
    expect(headers['Allow']).toBe('GET')
  })

  /**
   * The task routes (AGL-2599) are registered under the addresses the
   * browser module calls, and each is a POST. A route the drawer calls that
   * the register function forgot resolves to nothing, which the dispatcher
   * answers as a 404 indistinguishable from a typo in the URL.
   */
  it.each([CRM_TASK_ROUTES.save, CRM_TASK_ROUTES.complete])(
    'registers %s, which accepts only POST',
    async (route) => {
      registerCrmConsoleApi()
      const { status, headers } = await call(route, 'GET')
      expect(status).toBe(405)
      expect(headers['Allow']).toBe('POST')
    },
  )

  it('refuses an unauthenticated POST to a task route before reading any document', async () => {
    registerCrmConsoleApi()
    const { status } = await call(CRM_TASK_ROUTES.complete, 'POST', {
      hostId: 'site-1',
      taskId: 't-1',
    })
    expect(status).toBe(401)
  })

  /**
   * The import route is REACHABLE through the same registration (AGL-2602).
   *
   * A GET is the cheapest request that proves the handler answered: it is
   * refused before the route reads a body or a token, so the assertion is
   * about the wiring and not about the import.
   */
  it('registers crm/contacts-import, which answers POST only', async () => {
    registerCrmConsoleApi()
    const { status, headers } = await call('crm/contacts-import', 'GET')
    expect(status).toBe(405)
    expect(headers['Allow']).toBe('POST')
  })

  it('registers crm/email-send under the client-safe constant (AGL-2615)', () => {
    registerCrmConsoleApi()
    expect(CRM_API_ROUTES.emailSend).toBe('crm/email-send')
    expect(resolvePluginApiRoute(CRM_API_ROUTES.emailSend)).toBeDefined()
  })
})
