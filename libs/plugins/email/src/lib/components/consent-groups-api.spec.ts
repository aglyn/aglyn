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
 * The editor's client of `POST /api/orgs/consent-groups` (AGL-3320): every
 * status the route documents lands in the branch the dialog handles, every
 * validation refusal the route can name has a sentence an admin can act on,
 * and the readers of the org marker and the job document never throw on a
 * field they did not expect.
 */

const mockAuthorizedFetch = jest.fn()
jest.mock('@aglyn/shared-util-http/authorized-token', () => ({
  authorizedFetch: (...args: unknown[]) => mockAuthorizedFetch(...args),
}))

import {
  CONSENT_GROUP_ISSUE_MESSAGES,
  CONSENT_GROUPS_ROUTE,
  classifyConsentGroupsFailure,
  consentGroupIssueMessage,
  postConsentGroups,
  readConsentGroupChangeJob,
  readConsentGroupChangeMarker,
} from './consent-groups-api'

beforeEach(() => mockAuthorizedFetch.mockReset())

describe('every validation refusal says what to fix', () => {
  /*
   * The refusals the route validates, one per rule: a name that is empty,
   * too long or taken; too few or too many sites; a site the org does not
   * have or that two groups claim; a group that no longer exists or whose
   * sites were all replaced; and a change that changes nothing.
   */
  const CODES = [
    'name-empty',
    'name-too-long',
    'name-duplicate',
    'too-few-sites',
    'too-many-sites',
    'unknown-site',
    'site-in-two-groups',
    'unknown-group',
    'group-replaced',
    'no-change',
  ]

  it.each(CODES)('%s has its own sentence', (code) => {
    const message = consentGroupIssueMessage({ code })
    expect(message).toBe(CONSENT_GROUP_ISSUE_MESSAGES[code])
    expect(message.length).toBeGreaterThan(10)
  })

  it('gives every code a different sentence', () => {
    const messages = CODES.map((code) => consentGroupIssueMessage({ code }))
    expect(new Set(messages).size).toBe(CODES.length)
  })

  it('names the site a site refusal points at', () => {
    const siteName = (id: string) => (id === 'h1' ? 'Shop' : id)
    expect(consentGroupIssueMessage({ code: 'unknown-site', hostId: 'h1' }, siteName)).toBe(
      'Shop is no longer part of your organization.',
    )
    expect(
      consentGroupIssueMessage({ code: 'site-in-two-groups', hostId: 'h1' }, siteName),
    ).toBe('Shop can be in only one consent group.')
  })

  it('has a sentence for the refusals only a hand-built request can earn', () => {
    expect(consentGroupIssueMessage({ code: 'malformed' })).toBe(
      CONSENT_GROUP_ISSUE_MESSAGES.malformed,
    )
    expect(consentGroupIssueMessage({ code: 'duplicate-group' })).toBe(
      CONSENT_GROUP_ISSUE_MESSAGES['duplicate-group'],
    )
  })

  it('says something useful for a code it does not know, rather than nothing', () => {
    expect(consentGroupIssueMessage({ code: 'something-new' })).toMatch(
      /can’t be made as it stands/,
    )
  })
})

describe('what each refusal becomes', () => {
  it('400 is invalid, with the issues kept', () => {
    const failure = classifyConsentGroupsFailure(
      400,
      {
        error: 'Invalid',
        errors: [
          { code: 'name-duplicate', groupIndex: 1 },
          { code: 'unknown-site', hostId: 'h9' },
          { nonsense: true },
        ],
      },
      'preview',
    )
    expect(failure).toEqual({
      kind: 'invalid',
      message: CONSENT_GROUP_ISSUE_MESSAGES['name-duplicate'],
      errors: [
        { code: 'name-duplicate', groupIndex: 1 },
        { code: 'unknown-site', hostId: 'h9' },
      ],
    })
  })

  it('409 carrying `current` is stale, with the declaration as it now stands', () => {
    const current = { g1: { name: 'Acme', hostIds: ['a', 'b'] } }
    expect(
      classifyConsentGroupsFailure(409, { error: 'Stale', current }, 'apply'),
    ).toEqual({
      kind: 'stale',
      message: 'Someone else changed consent groups while you were editing.',
      current,
    })
  })

  it('409 on a declaration that is now empty is stale too', () => {
    expect(
      classifyConsentGroupsFailure(409, { error: 'Stale', current: null }, 'preview'),
    ).toMatchObject({ kind: 'stale', current: null })
  })

  it('409 carrying a change id is a change still running', () => {
    expect(
      classifyConsentGroupsFailure(
        409,
        { error: 'Busy', changeId: 'chg_1', phase: 'sweep' },
        'apply',
      ),
    ).toEqual({
      kind: 'in-flight',
      message: 'Finishing the last change. You can make another once it’s done.',
      changeId: 'chg_1',
    })
  })

  it('409 on a cancel means the change already took effect', () => {
    expect(classifyConsentGroupsFailure(409, { error: 'Too late' }, 'cancel')).toMatchObject({
      kind: 'took-effect',
    })
  })

  it('423 is a lockdown, in the lockdown’s own words', () => {
    const failure = classifyConsentGroupsFailure(
      423,
      { error: 'locked', title: 'Changes are paused', message: 'We are fixing something.' },
      'apply',
    )
    expect(failure.kind).toBe('locked')
    expect(failure.message).toMatch(/We are fixing something/)
  })

  it.each([
    [401, {}, /session has ended/],
    [403, { reason: 'email-unverified' }, /Verify your email/],
    [403, { error: 'data.manage required' }, /data\.manage required/],
    [403, {}, /don’t have permission/],
    [404, {}, /could not be found/],
    [500, {}, /Something went wrong/],
  ])('%s is refused with a sentence', (status, body, message) => {
    const failure = classifyConsentGroupsFailure(status, body, 'preview')
    expect(failure.kind).toBe('refused')
    expect(failure.message).toMatch(message)
  })
})

describe('posting', () => {
  it('posts JSON to the route with the signed-in user', async () => {
    mockAuthorizedFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, changeId: 'chg_1', phase: 'carry', done: false }),
    })
    const user = { uid: 'u1' }
    const result = await postConsentGroups(user as never, {
      orgId: 'org1',
      action: 'continue',
      changeId: 'chg_1',
    })
    expect(result).toEqual({
      ok: true,
      body: { ok: true, changeId: 'chg_1', phase: 'carry', done: false },
    })
    const [caller, url, init] = mockAuthorizedFetch.mock.calls[0]
    expect(caller).toBe(user)
    expect(url).toBe(CONSENT_GROUPS_ROUTE)
    expect(url).toBe('/api/orgs/consent-groups')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({
      orgId: 'org1',
      action: 'continue',
      changeId: 'chg_1',
    })
  })

  it('never throws: an unreachable server is a refusal with a sentence', async () => {
    mockAuthorizedFetch.mockRejectedValue(new TypeError('Failed to fetch'))
    const result = await postConsentGroups({ uid: 'u1' } as never, {
      orgId: 'org1',
      action: 'status',
      changeId: 'chg_1',
    })
    expect(result.ok).toBe(false)
    expect(result.failure?.message).toMatch(/couldn’t be reached/)
  })

  it('reads an OK status without `ok: true` as a failure, not a success', async () => {
    mockAuthorizedFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ something: 'else' }),
    })
    const result = await postConsentGroups({ uid: 'u1' } as never, {
      orgId: 'org1',
      action: 'status',
      changeId: 'chg_1',
    })
    expect(result.ok).toBe(false)
  })
})

describe('the org marker', () => {
  it('is null for an org with no change running', () => {
    expect(readConsentGroupChangeMarker({})).toBeNull()
    expect(readConsentGroupChangeMarker(null)).toBeNull()
    expect(readConsentGroupChangeMarker({ consentGroupsChange: 'yes' })).toBeNull()
    expect(
      readConsentGroupChangeMarker({ consentGroupsChange: { phase: 'carry' } }),
    ).toBeNull()
  })

  it('reads a running change', () => {
    expect(
      readConsentGroupChangeMarker({
        consentGroupsChange: {
          changeId: 'chg_1',
          phase: 'rehome',
          hostIds: ['a', 7, 'b', ''],
          startedAtMs: 10,
          declaredAtMs: 20,
        },
      }),
    ).toEqual({
      changeId: 'chg_1',
      phase: 'rehome',
      hostIds: ['a', 'b'],
      startedAtMs: 10,
      declaredAtMs: 20,
    })
  })

  it('reads an unknown phase as the one in which nothing has taken effect', () => {
    expect(
      readConsentGroupChangeMarker({
        consentGroupsChange: { changeId: 'chg_1', phase: 'mystery' },
      })?.phase,
    ).toBe('carry')
  })
})

describe('the job document', () => {
  it('reads a fresh or unreadable job as unclaimed and running', () => {
    expect(readConsentGroupChangeJob(undefined)).toEqual({
      phase: null,
      leaseUntilMs: null,
      stalled: false,
      lastError: null,
      failures: 0,
      finished: false,
    })
  })

  it('reads the lease, a stall and its reason', () => {
    expect(
      readConsentGroupChangeJob({
        phase: 'carry',
        lease: { owner: 'cron', untilMs: 5_000 },
        stalled: true,
        failures: 5,
        lastError: { message: 'Deadline exceeded' },
      }),
    ).toMatchObject({
      phase: 'carry',
      leaseUntilMs: 5_000,
      stalled: true,
      failures: 5,
      lastError: 'Deadline exceeded',
      finished: false,
    })
  })

  it.each([
    [{ done: true }],
    [{ finishedAtMs: 1 }],
    [{ canceledAtMs: 1 }],
    [{ phase: 'done' }],
    [{ phase: 'canceled' }],
  ])('reads %j as finished', (job) => {
    expect(readConsentGroupChangeJob(job).finished).toBe(true)
  })
})
