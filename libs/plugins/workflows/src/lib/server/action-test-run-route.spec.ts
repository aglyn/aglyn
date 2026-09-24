/**
 * @jest-environment node
 *
 * Must stay the FIRST block comment in the file — Jest reads the pragma only
 * from there, and behind the license header the suite would run on jsdom.
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

/**
 * The console's test run of one site action (AGL-3309), and who may start one.
 *
 * A test run is a LIVE run — its emails go out and its webhooks fire — so the
 * door admits a site's admins and editors and staff, and refuses a viewer and
 * an author as it refuses a stranger. Each refusal sits beside the case it must
 * not refuse, so a door that refused everybody fails here as loudly as one that
 * admitted everybody. What it hands the engine is pinned too: the stored
 * trigger, never the caller's, and a payload the caller cannot unmark.
 */

import type { PluginApiResponse } from '@aglyn/aglyn/server'
import { planLabelGrantingFeature } from '@aglyn/aglyn/server'
import type { SingleActionOutcome } from '../engine/run-event-actions'
import {
  ACTION_TEST_RUNS_PER_MINUTE,
  type ActionTestRunDeps,
  createActionTestRunHandler,
} from './action-test-run-route'

const SITE = 'site-a'
const NOW = Date.parse('2026-09-23T21:00:00.000Z')

/** Who each bearer token is. */
const TOKENS: Record<string, { uid: string; staff?: boolean }> = {
  admin: { uid: 'uid-admin' },
  editor: { uid: 'uid-editor' },
  author: { uid: 'uid-author' },
  viewer: { uid: 'uid-viewer' },
  outsider: { uid: 'uid-outsider' },
  // Staff, and no member of the site.
  staff: { uid: 'uid-staff', staff: true },
}

/** Every document, by full path. */
let store: Map<string, Record<string, any>>

function snapshotOf(path: string) {
  const data = store.get(path)
  return {
    id: path.split('/').pop() ?? '',
    exists: data !== undefined,
    data: () => (data ? { ...data } : undefined),
    get: (field: string) => data?.[field],
  }
}

function docRef(path: string): any {
  return {
    path,
    get: async () => snapshotOf(path),
    collection: (child: string) => ({
      doc: (id: string) => docRef(`${path}/${child}/${id}`),
    }),
  }
}

const firestore: any = {
  collection: (name: string) => ({ doc: (id: string) => docRef(`${name}/${id}`) }),
}

let runAction: jest.Mock<Promise<SingleActionOutcome>, Parameters<ActionTestRunDeps['runAction']>>
let consumeRateLimit: jest.Mock<
  ReturnType<ActionTestRunDeps['consumeRateLimit']>,
  Parameters<ActionTestRunDeps['consumeRateLimit']>
>

function handler() {
  return createActionTestRunHandler({
    firestore: () => firestore,
    verifyIdToken: async (token) => {
      if (token === 'expired') {
        throw Object.assign(new Error('Firebase ID token has expired.'), {
          code: 'auth/id-token-expired',
        })
      }
      if (token === 'outage') throw new Error('socket hang up')
      const caller = TOKENS[token]
      if (!caller) {
        throw Object.assign(new Error('Decoding failed'), { code: 'auth/argument-error' })
      }
      return caller
    },
    consumeRateLimit,
    runAction,
    now: () => NOW,
  })
}

async function call(
  body: Record<string, unknown>,
  token: string | null = 'editor',
  method = 'POST',
) {
  const result = {
    status: 0,
    body: undefined as any,
    headers: {} as Record<string, string>,
  }
  const res: PluginApiResponse = {
    status(code) {
      result.status = code
      return res
    },
    json(value) {
      result.body = value
    },
    send(value) {
      result.body = value
    },
    setHeader(name, value) {
      result.headers[name] = String(value)
    },
    redirect() {
      /* unused */
    },
    end() {
      /* unused */
    },
  }
  await handler()(
    {
      method,
      query: {},
      body,
      headers: token ? { authorization: `Bearer ${token}` } : {},
      cookies: {},
      socket: {},
    },
    res,
  )
  return result
}

const testRun = (overrides: Record<string, unknown> = {}) =>
  call({ hostId: SITE, actionId: 'act-scroll', ...overrides })

beforeEach(() => {
  store = new Map()
  store.set(`hosts/${SITE}`, {
    memberRoles: {
      'uid-admin': 'admin',
      'uid-editor': 'editor',
      'uid-author': 'author',
      'uid-viewer': 'viewer',
    },
  })
  store.set(`hosts/${SITE}/actions/act-scroll`, {
    name: 'Offer at half way',
    trigger: { event: 'scrollDepth', threshold: 50 },
    steps: [{ type: 'siteAlert', message: 'Half way there' }],
    enabled: true,
  })
  store.set(`hosts/${SITE}/actions/act-form`, {
    name: 'Welcome a lead',
    trigger: { event: 'formSubmission' },
    steps: [{ type: 'sendEmail', subject: 'Welcome', body: 'Thanks' }],
    enabled: true,
  })
  store.set(`hosts/${SITE}/actions/act-gone`, {
    name: 'Retired',
    trigger: { event: 'exitIntent' },
    steps: [{ type: 'siteAlert', message: 'Wait' }],
    enabled: true,
    deletedAt: 'ts',
  })
  runAction = jest.fn<Promise<SingleActionOutcome>, Parameters<ActionTestRunDeps['runAction']>>(
    async () => ({
      ran: true,
      skipped: null,
      alerts: [{ message: 'Half way there', severity: 'info' }],
    }),
  )
  consumeRateLimit = jest.fn<
    ReturnType<ActionTestRunDeps['consumeRateLimit']>,
    Parameters<ActionTestRunDeps['consumeRateLimit']>
  >(async () => ({ allowed: true, resetMs: NOW + 60_000 }))
})

describe('who may test an action', () => {
  it('refuses a request with no token, and reads, spends and runs nothing', async () => {
    expect(await call({ hostId: SITE, actionId: 'act-scroll' }, null)).toMatchObject({
      status: 401,
      body: { error: 'Unauthenticated' },
    })
    expect(consumeRateLimit).not.toHaveBeenCalled()
    expect(runAction).not.toHaveBeenCalled()
  })

  it('answers a refused credential with 401, and a failure to check one with 500', async () => {
    const logged = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    expect((await call({ hostId: SITE, actionId: 'act-scroll' }, 'expired')).status).toBe(401)
    expect((await call({ hostId: SITE, actionId: 'act-scroll' }, 'forged')).status).toBe(401)
    expect((await call({ hostId: SITE, actionId: 'act-scroll' }, 'outage')).status).toBe(500)
    // Only the outage is ours to log; a refused credential is the caller's.
    expect(logged).toHaveBeenCalledTimes(1)
    logged.mockRestore()
    expect(runAction).not.toHaveBeenCalled()
  })

  it.each(['outsider', 'viewer', 'author'])(
    'refuses a %s with 403 before spending the rate limit or running anything',
    async (token) => {
      expect(await call({ hostId: SITE, actionId: 'act-scroll' }, token)).toMatchObject({
        status: 403,
        body: { error: 'Only a site admin or editor can test an action' },
      })
      expect(consumeRateLimit).not.toHaveBeenCalled()
      expect(runAction).not.toHaveBeenCalled()
    },
  )

  it.each(['admin', 'editor'])('runs it for a site %s', async (token) => {
    expect((await call({ hostId: SITE, actionId: 'act-scroll' }, token)).status).toBe(200)
    expect(runAction).toHaveBeenCalledTimes(1)
  })

  it('runs it for staff, who are no member of the site', async () => {
    expect((await call({ hostId: SITE, actionId: 'act-scroll' }, 'staff')).status).toBe(200)
    expect(runAction).toHaveBeenCalledTimes(1)
  })

  it('does not take a role on one site as a role on another', async () => {
    store.set('hosts/site-b', { memberRoles: { 'uid-admin': 'admin' } })
    store.set('hosts/site-b/actions/act-scroll', store.get(`hosts/${SITE}/actions/act-scroll`)!)
    expect(
      (await call({ hostId: 'site-b', actionId: 'act-scroll' }, 'editor')).status,
    ).toBe(403)
  })

  it('answers 404 for a site that does not exist', async () => {
    expect(await call({ hostId: 'site-nowhere', actionId: 'act-scroll' })).toMatchObject({
      status: 404,
      body: { error: 'Unknown site' },
    })
  })

  it('refuses anything but a POST, and ids that are not document ids', async () => {
    expect((await call({ hostId: SITE, actionId: 'act-scroll' }, 'editor', 'GET')).status).toBe(405)
    expect((await call({ hostId: 'hosts/site-a', actionId: 'act-scroll' })).status).toBe(400)
    expect((await call({ hostId: SITE, actionId: '' })).status).toBe(400)
    expect(runAction).not.toHaveBeenCalled()
  })
})

describe('what it runs', () => {
  it('hands the engine the STORED trigger and a marked payload, whatever the body names', async () => {
    await testRun({ event: 'formSubmission' })
    expect(runAction).toHaveBeenCalledWith(SITE, 'act-scroll', 'scrollDepth', {
      path: '/console-test',
      test: 'true',
    })
  })

  it('passes the caller’s sample fields through bounded, and never unmarked', async () => {
    await testRun({
      payload: { path: '/pricing', plan: 'pro', 'not a key': 'x', test: 'false' },
    })
    expect(runAction).toHaveBeenCalledWith(SITE, 'act-scroll', 'scrollDepth', {
      path: '/pricing',
      plan: 'pro',
      test: 'true',
    })
  })

  it('answers with the alerts the steps produced', async () => {
    expect(await testRun()).toMatchObject({
      status: 200,
      body: { ok: true, alerts: [{ message: 'Half way there', severity: 'info' }] },
    })
  })

  it('refuses an action that does not exist, or was deleted, and runs nothing', async () => {
    expect(await testRun({ actionId: 'act-never' })).toMatchObject({
      status: 404,
      body: { error: 'That action no longer exists' },
    })
    expect((await testRun({ actionId: 'act-gone' })).status).toBe(404)
    expect(runAction).not.toHaveBeenCalled()
  })

  it('refuses an action whose trigger is a server event, and runs nothing', async () => {
    expect(await testRun({ actionId: 'act-form' })).toMatchObject({
      status: 400,
      body: { error: 'Only an action with an in-page trigger can be tested here' },
    })
    expect(runAction).not.toHaveBeenCalled()
  })
})

describe('what stopped it, in words', () => {
  const skipped = (outcome: Partial<SingleActionOutcome>): SingleActionOutcome => ({
    ran: false,
    skipped: 'failed',
    alerts: [],
    ...outcome,
  })

  it.each([
    [skipped({ skipped: 'disabled' }), 409, 'Switch the action on to test it'],
    [
      skipped({ skipped: 'conditions' }),
      422,
      'Nothing ran: a test run on /console-test does not meet this action’s conditions',
    ],
    [
      skipped({ skipped: 'plan' }),
      403,
      `Actions need the ${planLabelGrantingFeature('actions') ?? 'Pro'} plan — see Billing to upgrade`,
    ],
    [
      skipped({ skipped: 'allowance', limit: 250 }),
      402,
      'This site has used its 250 action runs for the month',
    ],
    [skipped({ skipped: 'missing' }), 404, 'That action no longer exists'],
    [
      skipped({ skipped: 'event' }),
      409,
      'The action changed while it was being tested — try again',
    ],
    [skipped({ skipped: 'failed' }), 500, 'The test run could not be completed. Try again.'],
  ])('answers %o with %i', async (outcome, status, error) => {
    runAction.mockResolvedValueOnce(outcome)
    expect(await testRun()).toMatchObject({ status, body: { error } })
  })

  it('names the page the caller tested on when conditions refuse it', async () => {
    runAction.mockResolvedValueOnce(skipped({ skipped: 'conditions' }))
    expect((await testRun({ payload: { path: '/pricing' } })).body.error).toBe(
      'Nothing ran: a test run on /pricing does not meet this action’s conditions',
    )
  })
})

describe('the rate limit', () => {
  it('counts every test in a bucket of its own for one person on one site', async () => {
    await testRun()
    await call({ hostId: SITE, actionId: 'act-scroll' }, 'admin')
    expect(consumeRateLimit.mock.calls).toEqual([
      [
        `workflows-test-run:${SITE}:uid-editor`,
        { limit: ACTION_TEST_RUNS_PER_MINUTE, windowMs: 60_000 },
      ],
      [
        `workflows-test-run:${SITE}:uid-admin`,
        { limit: ACTION_TEST_RUNS_PER_MINUTE, windowMs: 60_000 },
      ],
    ])
  })

  it('answers 429 with Retry-After once the bucket is spent, and runs nothing', async () => {
    consumeRateLimit.mockResolvedValueOnce({ allowed: false, resetMs: NOW + 42_500 })
    expect(await testRun()).toMatchObject({
      status: 429,
      body: { error: 'Too many test runs — wait a minute and try again' },
      headers: { 'Retry-After': '43' },
    })
    expect(runAction).not.toHaveBeenCalled()
  })
})
