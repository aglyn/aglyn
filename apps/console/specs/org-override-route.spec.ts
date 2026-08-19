/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored and this runs on jsdom, where the route's `Response`
 * helpers are unavailable.
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
 * /api/admin/org-override driven in-process (AGL-1786): the staff org
 * override as a BOUNDARY rather than a dialog.
 *
 * AGL-1652 made the reason mandatory in the console and said so honestly:
 * `adminAudit` validates no shape at all (`allow create: if isStaff()`), so
 * a staff session driving Firestore directly could still change a fee
 * percentage and write a reasonless row — or no row at all. AGL-1784 then
 * made the two writes one client batch, which closed the split write but not
 * that. A batch that is never issued is still atomic.
 *
 * So the cases here are about what the SERVER refuses and what it commits,
 * and the requests are built as real `Request`s with a JSON body — the
 * transport is part of what is under test.
 *
 * THREE DOUBLES DO REAL WORK HERE.
 *
 * 1. `mockBatch` models COMMIT ATOMICITY: writes are staged and reach
 *    `mockStore`/`mockAuditRows` only when `commit()` resolves, and a
 *    refused commit applies NONE of them. A double that applied each
 *    `set()` as it was staged would pass against the split write AGL-1784
 *    replaced, which is the thing these cases exist to keep out.
 * 2. `firestore.collection().doc().set()` OUTSIDE a batch is recorded
 *    separately as a tripwire. The migrated route must never write either
 *    document on its own.
 * 3. `FieldValue.delete()` is a distinguishable sentinel, because the
 *    AGL-1109 "inherit deletes the key" contract is the one thing a route
 *    could quietly lose: `deleteField()` has no JSON form, so a console that
 *    posted a built payload would send `{}` and the merge would keep the
 *    stored value. Every inherit case below asserts the sentinel is present
 *    in what reaches Firestore AND absent from the audit row, which records
 *    state.
 *
 * A COMMITTED WRITE IS ALSO APPLIED to `mockStore` with real
 * `set(…, { merge: true })` semantics — nested maps merged key by key, a
 * `DELETE` sentinel REMOVING the key — so the quota cases (AGL-1789) can
 * assert the RESULTING DOCUMENT rather than only the payload. That matters
 * because the bug they cover is precisely a payload that looks like a
 * removal (`after.entitlements` without the key) over a document that still
 * holds the override: an omitted key under a merge changes nothing.
 */

import {
  PLAN_ENTITLEMENTS,
  RELEASE_FLAGS,
  resolveOrgEntitlements,
} from '@aglyn/aglyn/server'

/** Distinguishable sentinels — a real merge acts on these, JSON cannot. */
const DELETE = { __sentinel: 'delete' }
const SERVER_TIMESTAMP = { __sentinel: 'serverTimestamp' }

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: {
    delete: () => DELETE,
    serverTimestamp: () => SERVER_TIMESTAMP,
  },
}))

/** Docs seeded as already present, keyed `collection/doc`. */
let mockStore: Record<string, Record<string, unknown>> = {}
/** `adminAudit` rows that a COMMITTED batch applied. */
let mockAuditRows: Record<string, unknown>[] = []
/** Org writes a COMMITTED batch applied, in order. */
let mockOrgWrites: Array<{
  batch: number
  path: string
  data: Record<string, unknown>
  options: unknown
}> = []
/** Batch ids whose `commit()` was attempted, refused or not. */
let mockCommits: number[] = []
/** Writes made OUTSIDE a batch. The tripwire — must stay empty. */
let mockDirectWrites: string[] = []
/**
 * THE FAULT: the `adminAudit` write is refused — a rules denial, App Check,
 * a dropped connection. Stated as a property of the COLLECTION rather than
 * of the batch, deliberately, so the same fault reaches every shape this
 * could regress into. Against a route that committed the org document in one
 * batch and the row in another, it lets the first through and refuses the
 * second — leaving `mockOrgWrites` holding the applied override with no row,
 * which is AGL-1784's defect by name rather than "no batch to break".
 */
let mockAuditRefused = false
let mockBatchSeq = 0
let mockAutoId = 0

const mockDecodedToken: Record<string, unknown> = {}
let mockVerifyIdToken: (token: string) => Promise<Record<string, unknown>> =
  async () => mockDecodedToken

/**
 * `set(…, { merge: true })`, modelled rather than approximated: a merge
 * writes nested maps KEY BY KEY (an omitted key keeps whatever was stored)
 * and a delete sentinel removes the key it names. A double that replaced the
 * document instead would make "only the cleared key is gone" vacuously true,
 * and one that ignored the sentinel would make it unreachable.
 */
function applyMerge(
  target: Record<string, unknown>,
  data: Record<string, unknown>,
): void {
  for (const [key, value] of Object.entries(data)) {
    if (value === DELETE) {
      delete target[key]
    } else if (
      value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      value !== SERVER_TIMESTAMP
    ) {
      // A merge does not replace a map — it merges INTO it, and the result is
      // a new map rather than a mutation of the seeded one.
      const merged = { ...((target[key] as Record<string, unknown>) ?? {}) }
      applyMerge(merged, value as Record<string, unknown>)
      target[key] = merged
    } else {
      target[key] = value
    }
  }
}

const mockDocHandle = (path: string) => ({
  path,
  get: async () => {
    const data = mockStore[path] ? { ...mockStore[path] } : undefined
    return { exists: data !== undefined, data: () => data }
  },
  set: async () => {
    mockDirectWrites.push(`set ${path}`)
  },
})

const mockFirestore = {
  collection: (collection: string) => ({
    doc: (id?: string) =>
      mockDocHandle(`${collection}/${id ?? `auto-${++mockAutoId}`}`),
    add: async () => {
      mockDirectWrites.push(`add ${collection}`)
      return { id: 'direct' }
    },
  }),
  batch: () => {
    const batch = ++mockBatchSeq
    const staged: Array<{
      path: string
      data: Record<string, unknown>
      options: unknown
    }> = []
    return {
      set: (
        ref: { path: string },
        data: Record<string, unknown>,
        options?: unknown,
      ) => {
        staged.push({ path: ref.path, data, options })
      },
      commit: async () => {
        mockCommits.push(batch)
        // ATOMIC: a batch carrying a refused document applies NOTHING — not
        // "the writes staged before the bad one", which is exactly the
        // behaviour under test.
        if (
          mockAuditRefused &&
          staged.some((write) => write.path.startsWith('adminAudit/'))
        ) {
          throw new Error('permission-denied: adminAudit')
        }
        for (const write of staged) {
          if (write.path.startsWith('adminAudit/')) {
            mockAuditRows.push(write.data)
          } else {
            mockOrgWrites.push({ batch, ...write })
            const merge = Boolean((write.options as any)?.merge)
            const target = merge ? { ...(mockStore[write.path] ?? {}) } : {}
            applyMerge(target, write.data)
            mockStore[write.path] = target
          }
        }
      },
    }
  },
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({ verifyIdToken: (token: string) => mockVerifyIdToken(token) }),
      firestore: () => mockFirestore,
    }),
  },
  isImpersonationSession: () => false,
  emailUnverifiedResponse: () =>
    Response.json({ error: 'Verify your email to continue' }, { status: 403 }),
}))

// eslint-disable-next-line @typescript-eslint/no-var-requires
const route = require('../app/api/admin/org-override/route') as {
  POST: (request: Request) => Promise<Response>
}

const FEATURE_KEYS = Object.keys(PLAN_ENTITLEMENTS.free.features)
const RELEASE_KEYS = RELEASE_FLAGS.map((definition) => definition.key)

/**
 * A well-formed override request. Note the body goes through
 * `JSON.stringify` and is parsed back by the route's own adapter — a
 * sentinel could not survive that trip, which is the point.
 */
async function post(
  body: Record<string, unknown>,
  options: { token?: string | null } = {},
): Promise<Response> {
  const token = options.token === undefined ? 'staff-token' : options.token
  return route.POST(
    new Request('https://app.aglyn.com/api/admin/org-override', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    }),
  )
}

/** The default valid body: a plan change with a reason and nothing else. */
const validBody = (over: Record<string, unknown> = {}) => ({
  orgId: 'org-1',
  plan: 'business',
  quotas: {},
  features: {},
  releaseFlags: {},
  reason: 'enterprise',
  note: null,
  ...over,
})

const onlyOrgWrite = () => {
  expect(mockOrgWrites).toHaveLength(1)
  return mockOrgWrites[0]
}
const onlyAuditRow = () => {
  expect(mockAuditRows).toHaveLength(1)
  return mockAuditRows[0]
}
/** The org document AFTER the committed merge — what a reader would load. */
const storedOrg = () => mockStore['orgs/org-1'] as Record<string, any>
const storedQuotas = () => {
  const { features: _features, ...quotas } = (storedOrg()['entitlements'] ??
    {}) as Record<string, unknown>
  return quotas
}

beforeEach(() => {
  mockStore = {
    'orgs/org-1': { plan: 'pro', entitlements: { hostLimit: 5 } },
  }
  mockAuditRows = []
  mockOrgWrites = []
  mockCommits = []
  mockDirectWrites = []
  mockAuditRefused = false
  mockBatchSeq = 0
  mockAutoId = 0
  mockVerifyIdToken = async () => mockDecodedToken
  for (const key of Object.keys(mockDecodedToken)) delete mockDecodedToken[key]
  Object.assign(mockDecodedToken, {
    uid: 'staff-1',
    email: 'ops@aglyn.com',
    email_verified: true,
    staff: true,
    staffRole: 'super',
  })
})

describe('the reason gate is the ROUTE, not the dialog (AGL-1786)', () => {
  it('refuses an override with no reason at all, and writes NOTHING', async () => {
    // The whole point of the move. Before this, `normalizeOrgOverrideReason`
    // ran only in the component, so this request — which no dialog would
    // ever send — landed a fee change with a reasonless row.
    const response = await post(validBody({ reason: undefined, note: null }))

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ written: false })
    // Not "no audit row": the ORG DOCUMENT is the half that matters.
    expect(mockOrgWrites).toEqual([])
    expect(mockAuditRows).toEqual([])
    expect(mockCommits).toEqual([])
  })

  it('refuses a reason code outside the fixed set', async () => {
    // A free-text box would accept "x". The vocabulary is closed on purpose,
    // and the server has to be the one holding it closed.
    const response = await post(validBody({ reason: 'because' }))
    expect(response.status).toBe(400)
    expect(mockOrgWrites).toEqual([])
  })

  it('refuses "other" until a note explains it, then accepts', async () => {
    // `other` is the one code that says nothing by itself, so it must not be
    // the cheap way past the gate.
    const refused = await post(validBody({ reason: 'other', note: '   ' }))
    expect(refused.status).toBe(400)
    expect(mockOrgWrites).toEqual([])

    const accepted = await post(
      validBody({ reason: 'other', note: '  legacy 2024 contract terms ' }),
    )
    expect(accepted.status).toBe(200)
    expect(onlyAuditRow()).toMatchObject({
      reason: 'other',
      note: 'legacy 2024 contract terms',
    })
  })

  it('states the same refusal the button does — append-only, not fixable later', async () => {
    const response = await post(validBody({ reason: undefined }))
    const payload = await response.json()
    expect(String(payload.error)).toMatch(/append-only/i)
  })
})

describe('atomicity survives the move to a route (AGL-1784)', () => {
  it('commits the org document and its audit row in ONE batch', async () => {
    const response = await post(validBody())

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ ok: true, written: true })
    expect(mockCommits).toHaveLength(1)
    const org = onlyOrgWrite()
    expect(org.path).toBe('orgs/org-1')
    expect(org.options).toEqual({ merge: true })
    expect(onlyAuditRow()).toMatchObject({
      action: 'org.override',
      actorUid: 'staff-1',
      target: 'orgs/org-1',
      reason: 'enterprise',
      note: null,
    })
    // Nothing went around the batch. Two batches committed back to back
    // would be the same split write wearing the Admin SDK.
    expect(mockDirectWrites).toEqual([])
    expect(mockCommits).toEqual([org.batch])
  })

  it('a refused commit applies NEITHER document, and the route says so', async () => {
    // The defect exactly: the audit row is the write that is refused, and
    // under any split shape the override has already landed by then.
    mockAuditRefused = true
    const response = await post(validBody())

    expect(response.status).toBe(500)
    // THE fact the console's "unchanged" copy rests on.
    expect(await response.json()).toMatchObject({ written: false })
    expect(mockOrgWrites).toEqual([])
    expect(mockAuditRows).toEqual([])
    expect(mockCommits).toHaveLength(1)
    expect(mockDirectWrites).toEqual([])
  })

  it('EVERY refusal carries an explicit written:false', async () => {
    // The console reports "the organization is unchanged" only on this
    // field, and treats its absence as unknown. A refusal that forgot it
    // would be reported as an unknown outcome — safe, but useless.
    mockVerifyIdToken = async () => {
      throw new Error('bad token')
    }
    const bad = await post(validBody())
    expect(bad.status).toBe(500)
    expect(await bad.json()).toMatchObject({ written: false })

    mockVerifyIdToken = async () => mockDecodedToken
    for (const [body, status] of [
      [validBody({ orgId: '' }), 400],
      [validBody({ plan: 'unobtainium' }), 400],
      [validBody({ quotas: { hostLimit: -1 } }), 400],
      [validBody({ quotas: { notAQuota: 3 } }), 400],
      [validBody({ features: { notAFeature: true } }), 400],
      [validBody({ releaseFlags: { notAFlag: true } }), 400],
      [validBody({ orgId: 'org-missing' }), 404],
    ] as Array<[Record<string, unknown>, number]>) {
      const response = await post(body)
      expect(response.status).toBe(status)
      expect(await response.json()).toMatchObject({ written: false })
    }
    expect(mockOrgWrites).toEqual([])
    expect(mockAuditRows).toEqual([])
  })

  it('never conjures an org — set(merge) on a mistyped id would', async () => {
    // A phantom org carrying a plan and a fee schedule, audited as a real
    // change. `update()` would have thrown NOT_FOUND; `set(merge)` invents.
    const response = await post(validBody({ orgId: 'org-typo' }))
    expect(response.status).toBe(404)
    expect(mockOrgWrites).toEqual([])
    expect(mockStore['orgs/org-typo']).toBeUndefined()
  })
})

describe('"inherit" still DELETES the key across the wire (AGL-1109)', () => {
  it('mints a delete sentinel for every feature the caller did not force', async () => {
    // The sharpest trap in the migration: `deleteField()` has no JSON form,
    // so the console cannot send one. It sends only what is forced, and the
    // route expands the ABSENCE against the plan registry.
    const response = await post(
      validBody({ features: { pos: true }, quotas: { hostLimit: 9 } }),
    )
    expect(response.status).toBe(200)

    const features = onlyOrgWrite().data['entitlements'] as Record<string, any>
    expect(features['hostLimit']).toBe(9)
    expect(features['features']['pos']).toBe(true)
    // Every other feature key is a DELETE, not an omission. An omitted key
    // under `{ merge: true }` keeps whatever was stored — the AGL-1109 bug.
    for (const key of FEATURE_KEYS) {
      if (key === 'pos') continue
      expect(features['features'][key]).toBe(DELETE)
    }
    // No key silently dropped: the route derives the set from the registry,
    // so a feature shipped after the caller's bundle is still handled.
    expect(Object.keys(features['features']).sort()).toEqual(
      [...FEATURE_KEYS].sort(),
    )
  })

  it('writes a forced-OFF feature as false — not as an inherit', async () => {
    // The same key-presence question the quota `0` raises (AGL-1789), on the
    // boolean family: "force off" is an override that has to be STORED, and
    // it was the only workaround while inherit could not clear one (AGL-1109).
    // An expansion that read the VALUE rather than the key would delete it and
    // hand the org its plan default instead.
    const response = await post(validBody({ features: { pos: false } }))
    expect(response.status).toBe(200)
    const entitlements = onlyOrgWrite().data['entitlements'] as Record<
      string,
      any
    >
    expect(entitlements['features']['pos']).toBe(false)
    expect(storedOrg()['entitlements']['features']).toEqual({ pos: false })
    expect(onlyAuditRow()['after']).toMatchObject({
      entitlements: { features: { pos: false } },
    })
  })

  it('mints one for every release flag the caller did not force', async () => {
    const forced = RELEASE_KEYS[0]
    await post(validBody({ releaseFlags: { [forced]: true } }))

    const flags = onlyOrgWrite().data['releaseFlags'] as Record<string, any>
    expect(flags[forced]).toBe(true)
    for (const key of RELEASE_KEYS) {
      if (key === forced) continue
      expect(flags[key]).toBe(DELETE)
    }
  })

  it('removes the whole map when the LAST override is cleared', async () => {
    // Not an empty map left behind: `overrideCount` reads key presence, so
    // an empty `releaseFlags` would keep showing a chip forever.
    mockStore['orgs/org-1'] = {
      plan: 'pro',
      releaseFlags: { [RELEASE_KEYS[0]]: true },
    }
    await post(validBody({ releaseFlags: {} }))

    const write = onlyOrgWrite().data
    expect(write['releaseFlags']).toBe(DELETE)
    expect(write['entitlements']).toBe(DELETE)
    // And the row records the resulting STATE, so the reader sees a removal.
    expect(onlyAuditRow()['after']).toMatchObject({ releaseFlags: null })
    expect(onlyAuditRow()['before']).toMatchObject({
      releaseFlags: { [RELEASE_KEYS[0]]: true },
    })
  })

  it('clears the plan when none is chosen — a delete, not an empty string', async () => {
    await post(validBody({ plan: null }))
    expect(onlyOrgWrite().data['plan']).toBe(DELETE)
    expect(onlyAuditRow()['after']).toMatchObject({ plan: null })
  })

  it('keeps every sentinel OUT of the audit row', async () => {
    // The row is read by three staff surfaces. A sentinel there is a value
    // nobody can act on, and `after` is meant to be the resulting state.
    await post(validBody({ features: { pos: true } }))
    const after = onlyAuditRow()['after'] as Record<string, any>
    expect(JSON.stringify(after)).not.toContain('sentinel')
    expect(after['entitlements']['features']).toEqual({ pos: true })
  })
})

describe('clearing ONE numeric quota removes it (AGL-1789)', () => {
  /**
   * The half of AGL-1109 that was never fixed, and was preserved verbatim by
   * the AGL-1786 migration so that move changed no behaviour.
   *
   * The quotas map used to be written as-sent — only the keys the operator
   * had filled in. Under `{ merge: true }` an omitted key is NOT a change, so
   * emptying one field of several left the stored override exactly where it
   * was, while `after` (built from the same explicit map) recorded it as
   * gone. Clearing them ALL happened to work, because `hasOverrides` went
   * false and the whole `entitlements` map was deleted — which is why this
   * survived: the common case, clearing one of several, is the broken one.
   */
  it('deletes the cleared quota and leaves the others exactly as stored', async () => {
    mockStore['orgs/org-1'] = {
      plan: 'business',
      // A raised site cap and a negotiated marketplace rate. Removing the
      // rate must not touch the cap.
      entitlements: { hostLimit: 25, marketplaceFeePct: 12 },
    }
    const response = await post(
      validBody({ quotas: { hostLimit: 25 } }),
    )
    expect(response.status).toBe(200)

    const entitlements = onlyOrgWrite().data['entitlements'] as Record<
      string,
      any
    >
    expect(entitlements['hostLimit']).toBe(25)
    // A sentinel, not an omission — an omitted key under a merge is a no-op.
    expect(entitlements['marketplaceFeePct']).toBe(DELETE)
    // And the DOCUMENT, after the merge: the override is actually gone.
    expect(storedQuotas()).toEqual({ hostLimit: 25 })
    expect('marketplaceFeePct' in storedQuotas()).toBe(false)
  })

  it('hands the org back to the plan default it was overriding', async () => {
    // The point of clearing one. `resolveMarketplaceFeePct` reads the stored
    // override first, so as long as the key survives the org keeps being
    // charged the negotiated rate the operator just removed.
    mockStore['orgs/org-1'] = {
      plan: 'business',
      entitlements: { hostLimit: 25, marketplaceFeePct: 12 },
    }
    await post(validBody({ quotas: { hostLimit: 25 } }))

    const resolved = resolveOrgEntitlements(storedOrg())
    expect(resolved.marketplaceFeePct).toBe(
      PLAN_ENTITLEMENTS.business.marketplaceFeePct,
    )
    // …and the override that was NOT cleared still wins over the plan.
    expect(resolved.hostLimit).toBe(25)
    expect(PLAN_ENTITLEMENTS.business.hostLimit).not.toBe(25)
  })

  it('keeps a deliberate ZERO — a cap of none is not an inherit', async () => {
    // The sharpest trap in the fix. "Cleared" is an ABSENT key; `0` is a
    // present one and a real override — a comped marketplace at 0%, an org
    // capped to no POS registers. A fix that read emptiness off the VALUE
    // rather than off key presence would delete both, and this org would
    // silently start being charged the plan's take rate.
    mockStore['orgs/org-1'] = {
      plan: 'business',
      entitlements: { marketplaceFeePct: 0, posRegisters: 0 },
    }
    const response = await post(
      validBody({ quotas: { marketplaceFeePct: 0, posRegisters: 0 } }),
    )
    expect(response.status).toBe(200)

    const write = onlyOrgWrite().data
    // The MAP survives too: `hasOverrides` counts keys, not truthy values.
    expect(write['entitlements']).not.toBe(DELETE)
    expect((write['entitlements'] as Record<string, any>)['marketplaceFeePct'])
      .toBe(0)
    expect(storedQuotas()).toEqual({ marketplaceFeePct: 0, posRegisters: 0 })
    expect(resolveOrgEntitlements(storedOrg()).marketplaceFeePct).toBe(0)
    expect(onlyAuditRow()['after']).toMatchObject({
      entitlements: { marketplaceFeePct: 0, posRegisters: 0, features: {} },
    })
  })

  it('expands from the REGISTRY, so every quota key is decided', async () => {
    // The same property the features expansion has: the key set comes from
    // `PLAN_ENTITLEMENTS`, not from what the caller happened to send, so a
    // quota shipped after the caller's bundle is still cleared rather than
    // left stored.
    await post(validBody({ quotas: { hostLimit: 9 } }))
    const entitlements = onlyOrgWrite().data['entitlements'] as Record<
      string,
      any
    >
    const quotaKeys = Object.entries(PLAN_ENTITLEMENTS.free)
      .filter(([, value]) => typeof value === 'number')
      .map(([key]) => key)
    expect(Object.keys(entitlements).sort()).toEqual(
      [...quotaKeys, 'features'].sort(),
    )
    for (const key of quotaKeys) {
      if (key === 'hostLimit') continue
      expect(entitlements[key]).toBe(DELETE)
    }
  })

  it('records an `after` the organization is actually in', async () => {
    // The second half of the defect: `after` was built from the same
    // omitting loop, so the row said the override was gone while the
    // document still held it. The row is the only account of what a staff
    // member did, and it was describing a state nobody was in.
    mockStore['orgs/org-1'] = {
      plan: 'business',
      entitlements: { hostLimit: 25, marketplaceFeePct: 12 },
    }
    await post(validBody({ quotas: { hostLimit: 25 } }))

    const after = onlyAuditRow()['after'] as Record<string, any>
    expect(after['entitlements']).toEqual(storedOrg()['entitlements'])
    expect(JSON.stringify(after)).not.toContain('sentinel')
    // `before` still describes what it was changed FROM.
    expect(onlyAuditRow()['before']).toMatchObject({
      entitlements: { hostLimit: 25, marketplaceFeePct: 12 },
    })
  })

  it('still removes the whole map when the LAST quota is cleared', async () => {
    // Already true before AGL-1789 — `hasOverrides` went false and the field
    // was deleted — and the reason the bug read as intermittent. Pinned so
    // the fix does not leave an empty map behind instead: `overrideCount`
    // reads key presence, so the row chip would never clear.
    mockStore['orgs/org-1'] = { plan: 'business', entitlements: { hostLimit: 25 } }
    await post(validBody({ quotas: {} }))

    expect(onlyOrgWrite().data['entitlements']).toBe(DELETE)
    expect(storedOrg()['entitlements']).toBeUndefined()
  })

  it('leaves a stored key the dialog does not offer alone', async () => {
    // `datasetsPerHost` is the pre-AGL-240 host-keyed override the resolver
    // still honours. It is not in the registry, so it is not rendered and
    // the operator cannot have meant to clear it — deleting it here would
    // remove an override nobody saw. Clearing every offered quota still
    // drops the whole map, which is the one way it goes.
    mockStore['orgs/org-1'] = {
      plan: 'business',
      entitlements: { hostLimit: 25, datasetsPerHost: 7 },
    }
    await post(validBody({ quotas: { hostLimit: 25 } }))
    expect(storedQuotas()).toEqual({ hostLimit: 25, datasetsPerHost: 7 })
  })
})

describe('the audit row', () => {
  it('reads `before` from the LIVE document, not from the caller', async () => {
    // AGL-1784's failure mode is a `before` that no longer describes the
    // state the change was made against. A snapshot taken when the dialog
    // opened is exactly that; the route reads at write time. A caller that
    // sends its own `before` must not be believed.
    mockStore['orgs/org-1'] = {
      plan: 'scale',
      entitlements: { hostLimit: 42 },
      releaseFlags: { [RELEASE_KEYS[0]]: false },
    }
    await post(validBody({ before: { plan: 'free', entitlements: null } }))

    expect(onlyAuditRow()['before']).toEqual({
      plan: 'scale',
      entitlements: { hostLimit: 42 },
      releaseFlags: { [RELEASE_KEYS[0]]: false },
    })
  })

  it('writes explicit nulls, never undefined — Firestore rejects those', async () => {
    mockStore['orgs/org-1'] = {}
    await post(validBody({ plan: null }))
    const row = onlyAuditRow()
    expect(Object.values(row)).not.toContain(undefined)
    expect(row['note']).toBeNull()
    expect(row['before']).toEqual({
      plan: null,
      entitlements: null,
      releaseFlags: null,
    })
    const write = onlyOrgWrite().data
    expect(Object.values(write)).not.toContain(undefined)
  })

  it('timestamps from the SERVER, not from the caller', async () => {
    await post(validBody())
    expect(onlyAuditRow()['at']).toBe(SERVER_TIMESTAMP)
    expect(onlyOrgWrite().data['updatedAt']).toBe(SERVER_TIMESTAMP)
  })
})

describe('the staff gate and the rules’ role split (AGL-206/1635)', () => {
  it('401s with no bearer token, before any read', async () => {
    const response = await post(validBody(), { token: null })
    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ written: false })
  })

  it('403s a signed-in non-staff caller', async () => {
    delete mockDecodedToken['staff']
    const response = await post(validBody())
    expect(response.status).toBe(403)
    expect(mockOrgWrites).toEqual([])
  })

  it('403s the SUPPORT role — read-only staff cannot change entitlements', async () => {
    mockDecodedToken['staffRole'] = 'support'
    const response = await post(validBody())
    expect(response.status).toBe(403)
    expect(mockOrgWrites).toEqual([])
  })

  it('403s a staff token with NO staffRole claim at all (AGL-2131)', async () => {
    // This route read `decoded['staffRole'] ?? 'super'` while every other
    // /api/admin/* route read `?? 'support'`, so one claim-less token was
    // super HERE and support everywhere else. The delete is the whole case:
    // an absent claim, not an explicit role.
    delete mockDecodedToken['staffRole']
    const response = await post(validBody())
    expect(response.status).toBe(403)
    expect(String((await response.json()).error)).toMatch(/billing or super/i)
    // The refusal is BEFORE any read or write — a fail-open that then failed
    // at Firestore would still have leaked the org's stored state.
    expect(mockOrgWrites).toEqual([])
    expect(mockAuditRows).toEqual([])
  })

  it('still ADMITS an explicit super role — the negative control', async () => {
    // Without this the case above is satisfied by a route that refuses
    // everyone, which is not the fix.
    mockDecodedToken['staffRole'] = 'super'
    const response = await post(validBody())
    expect(response.status).toBe(200)
  })

  it('lets BILLING staff override plan and quotas, as the rules do', async () => {
    // The Admin SDK bypasses the rules entirely, so their split has to be
    // restated here — including the half that GRANTS. Denying billing staff
    // would be a different bug from the one being fixed.
    mockDecodedToken['staffRole'] = 'billing'
    const response = await post(validBody({ quotas: { hostLimit: 9 } }))
    expect(response.status).toBe(200)
    expect(onlyOrgWrite().data['entitlements']).toMatchObject({ hostLimit: 9 })
  })

  it('403s BILLING staff who would CHANGE a release flag', async () => {
    // `releaseFlags` is super-only in the rules — the per-org override of a
    // release flag is the same class of act as the platform-wide editor
    // (/api/admin/flags, super-only), not a commercial one. Moving the write
    // server-side must not hand it to billing staff.
    mockDecodedToken['staffRole'] = 'billing'
    const response = await post(
      validBody({ releaseFlags: { [RELEASE_KEYS[0]]: true } }),
    )
    expect(response.status).toBe(403)
    expect(String((await response.json()).error)).toMatch(/super/i)
    expect(mockOrgWrites).toEqual([])
  })

  it('lets BILLING staff save an org whose release flags are UNCHANGED', async () => {
    // Every override write names `releaseFlags`, and the rules gate on a
    // DIFF. Refusing billing staff for naming an unchanged map would take
    // away quota overrides they can make today.
    mockStore['orgs/org-1'] = {
      plan: 'pro',
      releaseFlags: { [RELEASE_KEYS[0]]: true },
    }
    mockDecodedToken['staffRole'] = 'billing'
    const response = await post(
      validBody({ releaseFlags: { [RELEASE_KEYS[0]]: true } }),
    )
    expect(response.status).toBe(200)
  })

  it('refuses a MISSING staffRole its super-only act too (AGL-2131)', async () => {
    // This case used to assert the OPPOSITE — that a claim-less token was
    // super here "exactly as the rules do", on AGL-206's migration-path
    // reasoning. Both halves of that premise were stale: AGL-495 had already
    // made every other /api/admin/* route resolve a missing claim to
    // `support`, so those accounts had been refused everywhere else for
    // ages, and the rules' own `get('staffRole', 'super')` is fixed
    // alongside this. What the migration path actually needs is
    // tools/scripts/audit-staff-claims.mjs plus an explicit role, not a
    // default that disagrees with the rest of the system.
    delete mockDecodedToken['staffRole']
    const response = await post(
      validBody({ releaseFlags: { [RELEASE_KEYS[0]]: true } }),
    )
    expect(response.status).toBe(403)
    expect(mockOrgWrites).toEqual([])
  })
})
