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
 * notifyRiskEvent (AGL-3368): who hears, on which channel, how often — and
 * the review request that is an owner's only lever. The catalog and the
 * seam are real; the store, the sender and the notifiers are doubles, and
 * no email is really sent.
 */

type Doc = Record<string, unknown>

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: {
    increment: (by: number) => ({ __increment: by }),
    serverTimestamp: () => 'server-timestamp',
    delete: () => ({ __delete: true }),
  },
}))
jest.mock('./firebase-admin', () => ({
  __esModule: true,
  default: {
    app: () => {
      throw new Error('the spec passes its own firestore')
    },
  },
}))
jest.mock('./notifications', () => ({
  __esModule: true,
  notifyUsers: async () => undefined,
  notifyStaff: async () => undefined,
}))
jest.mock('./organizations', () => ({ __esModule: true, listOrgMembers: async () => [] }))
jest.mock('./auth-pools', () => ({ __esModule: true, findUserByUidAcrossPools: async () => null }))
// The System emails seam renders the fallback here: what is under test is
// who is sent what, not the chrome around it.
jest.mock('./render-system-email', () => ({
  __esModule: true,
  systemEmailBrand: () => ({ merge: {}, options: {} }),
  orgSystemEmailBrand: async () => ({ merge: {}, options: {}, fromName: 'Harbor View' }),
  renderSystemEmailContent: async (
    _key: string,
    _merge: Record<string, string>,
    _brand: unknown,
    fallback: { subject: string; text: string },
  ) => fallback,
}))

import {
  closeRiskNotice,
  listOwnerRiskNotices,
  notifyRiskEvent,
  RISK_NOTICE_BURST,
  requestRiskReview,
  type RiskNoticeDeps,
  riskNoticeId,
} from './risk-notice'

function fakeFirestore() {
  const docs = new Map<string, Doc>()
  const apply = (path: string, value: Doc, merge: boolean) => {
    const next: Doc = merge ? { ...(docs.get(path) ?? {}) } : {}
    for (const [key, entry] of Object.entries(value)) {
      const increment = (entry as { __increment?: number } | null)?.__increment
      if ((entry as { __delete?: boolean } | null)?.__delete) delete next[key]
      else if (typeof increment === 'number') next[key] = Number(next[key] ?? 0) + increment
      else if (entry === 'server-timestamp') next[key] = 1
      else next[key] = entry
    }
    docs.set(path, next)
  }
  const snapshot = (path: string) => {
    const data = docs.get(path)
    return {
      id: path.split('/').pop() as string,
      exists: data !== undefined,
      data: () => data,
      get: (field: string) => data?.[field],
    }
  }
  const ref = (path: string) => ({
    path,
    id: path.split('/').pop() as string,
    get: async () => snapshot(path),
    set: async (value: Doc, options?: { merge?: boolean }) => apply(path, value, Boolean(options?.merge)),
    create: async (value: Doc) => {
      if (docs.has(path)) throw Object.assign(new Error('exists'), { code: 6 })
      apply(path, value, false)
    },
  })
  const query = (name: string, filters: Array<[string, string, unknown]>) => ({
    where: (field: string, op: string, value: unknown) => query(name, [...filters, [field, op, value]]),
    orderBy: () => query(name, filters),
    limit: () => query(name, filters),
    get: async () => {
      const rows = [...docs.keys()]
        .filter((path) => path.startsWith(`${name}/`) && path.split('/').length === 2)
        .filter((path) =>
          filters.every(([field, op, value]) => {
            const actual = docs.get(path)?.[field] as number
            return op === '==' ? actual === value : op === '<=' ? actual <= (value as number) : actual > (value as number)
          }),
        )
        .map((path) => ({ ...snapshot(path), ref: ref(path) }))
      return { docs: rows, size: rows.length, empty: rows.length === 0 }
    },
  })
  const firestore = {
    docs,
    collection: (name: string) => ({ doc: (id: string) => ref(`${name}/${id}`), ...query(name, []) }),
    getAll: async (...refs: Array<{ path: string }>) => refs.map((entry) => snapshot(entry.path)),
    runTransaction: async (work: (transaction: unknown) => Promise<unknown>) =>
      work({
        get: async (entry: { path: string }) => snapshot(entry.path),
        set: (entry: { path: string }, value: Doc, options?: { merge?: boolean }) =>
          apply(entry.path, value, Boolean(options?.merge)),
      }),
  }
  return firestore
}

const NOW = Date.UTC(2026, 8, 28, 16, 0)

function harness(overrides: { owners?: Array<{ uid: string; email: string | null }> } = {}) {
  const firestore = fakeFirestore()
  firestore.docs.set('orgs/org-1', { name: 'Harbor View', slug: 'harbor-view' })
  firestore.docs.set('hosts/host-1', {
    orgId: 'org-1',
    subdomain: 'harborview',
    memberRoles: { 'manager-1': 'editor' },
  })
  let clock = NOW
  const sent: Array<Record<string, unknown>> = []
  const inApp: Array<{ uids: string[]; payload: Record<string, unknown> }> = []
  const staff: Array<Record<string, unknown>> = []
  const deps: Partial<RiskNoticeDeps> = {
    firestore: firestore as unknown as FirebaseFirestore.Firestore,
    sendEmail: async (options) => {
      sent.push(options as unknown as Record<string, unknown>)
      return { sent: true, id: `email-${sent.length}` } as never
    },
    notifyUsers: async (uids, payload) => {
      inApp.push({ uids: [...uids], payload: payload as unknown as Record<string, unknown> })
    },
    notifyStaff: async (payload) => {
      staff.push(payload as unknown as Record<string, unknown>)
    },
    listOwners: async () =>
      overrides.owners ?? [
        { uid: 'owner-1', email: 'avery@example.com' },
        { uid: 'admin-1', email: 'sam@example.org' },
      ],
    lookupEmail: async (uid) => `${uid}@example.com`,
    nowMs: () => clock,
  }
  return {
    firestore,
    deps,
    sent,
    inApp,
    staff,
    advance: (ms: number) => {
      clock += ms
    },
  }
}

const held = (n: number) => ({
  kind: 'email-held' as const,
  orgId: 'org-1',
  reviewId: `${'a'.repeat(39)}${n.toString(16)}`.slice(-40),
  reference: `HS-${n}`,
  item: { label: `the campaign "Offer ${n}"`, path: `/org/emails/messages/send-${n}` },
  staffEvidence: 'Lookalike link to paypal-secure.example.',
})

describe('notifyRiskEvent', () => {
  it('tells the owners in-app and by email, and staff with a link to the row', async () => {
    const h = harness()
    h.firestore.docs.set(`abuseReports/${held(1).reviewId}`, { orgId: 'org-1', status: 'open' })
    const result = await notifyRiskEvent(held(1), h.deps)
    expect(result).toMatchObject({ duplicate: false, error: null })
    expect(result.owners).toMatchObject({ recipients: 2, inApp: 2, emailed: 2, emailFailed: 0 })
    expect(h.inApp[0]).toMatchObject({
      uids: ['owner-1', 'admin-1'],
      payload: { type: 'system.riskNotice', orgId: 'org-1', title: 'An email is on hold for review' },
    })
    // One email per person, never a shared `to:`.
    expect(h.sent.map((email) => email['to'])).toEqual(['avery@example.com', 'sam@example.org'])
    expect(h.staff).toEqual([
      expect.objectContaining({
        type: 'system.abuseReportUrgent',
        link: `/admin/abuse-reports?report=${held(1).reviewId}`,
      }),
    ])
    // The staff alert carries the evidence; the owners' mail never does.
    expect(String(h.staff[0]['body'])).toContain('paypal-secure')
    expect(JSON.stringify(h.sent)).not.toMatch(/paypal|lookalike/i)
    // The row is stamped, so the staff queue renders the catalog's words.
    expect(h.firestore.docs.get(`abuseReports/${held(1).reviewId}`)?.['riskNotice']).toMatchObject({
      kind: 'email-held',
      noticeId: result.noticeId,
    })
  })

  it('sends the owners’ email as account mail from the platform, past every gate a tenant send meets', async () => {
    const h = harness()
    await notifyRiskEvent(held(2), h.deps)
    for (const email of h.sent) {
      expect(email).toMatchObject({ owedFor: 'account', context: 'risk-notice' })
      // No workspace identity and no tenant audience: the platform's sender,
      // which the phishing screen and a suspended workspace never touch.
      expect(email).not.toHaveProperty('sendingIdentity')
      expect(email).not.toHaveProperty('audience')
      expect(email).not.toHaveProperty('marketing')
    }
  })

  it('tells nobody twice about the same row', async () => {
    const h = harness()
    await notifyRiskEvent(held(3), h.deps)
    const again = await notifyRiskEvent(held(3), h.deps)
    expect(again.duplicate).toBe(true)
    expect(h.sent).toHaveLength(2)
    expect(h.staff).toHaveLength(1)
  })

  it('folds a burst into one digest, and sends it when the hour closes', async () => {
    const h = harness({ owners: [{ uid: 'owner-1', email: 'avery@example.com' }] })
    const burst = 40
    for (let n = 1; n <= burst; n += 1) await notifyRiskEvent(held(100 + n), h.deps)
    // The allowance one by one, then nothing more by email.
    expect(h.sent).toHaveLength(RISK_NOTICE_BURST.owners)
    // One in-app "more are arriving" note when the allowance runs out.
    expect(h.inApp.filter((entry) => entry.payload['title'] === 'More account notices are arriving')).toHaveLength(1)
    expect(h.inApp).toHaveLength(RISK_NOTICE_BURST.owners + 1)
    // Staff are held to their own allowance.
    expect(h.staff).toHaveLength(RISK_NOTICE_BURST.staff)

    // The hour closes: the next notice sends the digest first.
    h.advance(RISK_NOTICE_BURST.windowMs + 1)
    await notifyRiskEvent(held(999), h.deps)
    const digest = h.sent[RISK_NOTICE_BURST.owners]
    expect(String(digest['subject'])).toMatch(/^Summary: more items on Harbor View/)
    expect(String(digest['text'])).toContain(`(${burst - RISK_NOTICE_BURST.owners})`)
    // …then the notice itself, in a fresh hour.
    expect(h.sent).toHaveLength(RISK_NOTICE_BURST.owners + 2)
    expect(h.staff.some((alert) => String(alert['title']).startsWith('Digest:'))).toBe(true)
  })

  it('never folds a lock: every lock notice goes out on its own', async () => {
    const h = harness({ owners: [{ uid: 'owner-1', email: 'avery@example.com' }] })
    for (let n = 1; n <= RISK_NOTICE_BURST.owners + 3; n += 1) await notifyRiskEvent(held(200 + n), h.deps)
    const before = h.sent.length
    await notifyRiskEvent(
      {
        kind: 'workspace-locked',
        orgId: 'org-1',
        lock: { message: 'Access is disabled while we investigate.', affected: 'Your sites show a notice.' },
      },
      h.deps,
    )
    expect(h.sent.length).toBe(before + 1)
  })

  it('reaches a LOCKED workspace’s owners with the lock’s own message', async () => {
    const h = harness()
    h.firestore.docs.set('orgs/org-1', {
      name: 'Harbor View',
      slug: 'harbor-view',
      suspendedAt: 1,
      suspendedMode: 'full',
      suspendedMessage: 'Access is temporarily disabled while we investigate a security concern.',
    })
    const result = await notifyRiskEvent(
      {
        kind: 'workspace-locked',
        orgId: 'org-1',
        lock: {
          message: 'Access is temporarily disabled while we investigate a security concern.',
          affected: 'Your sites show a notice instead of their pages.',
        },
      },
      h.deps,
    )
    expect(result.owners).toMatchObject({ recipients: 2, emailed: 2, emailFailed: 0 })
    expect(h.sent[0]).toMatchObject({ owedFor: 'account' })
    expect(h.sent[0]).not.toHaveProperty('sendingIdentity')
    expect(String(h.sent[0]['text'])).toContain(
      'Access is temporarily disabled while we investigate a security concern.',
    )
    expect(String(h.sent[0]['subject'])).toBe('Harbor View has been locked')
    // Staff placed the lock; they are not alerted about their own act.
    expect(h.staff).toEqual([])
  })

  it('reaches an account lock’s own person, not a workspace', async () => {
    const h = harness()
    await notifyRiskEvent(
      { kind: 'account-locked', orgId: null, userUid: 'user-9', lock: { message: 'Locked.' } },
      h.deps,
    )
    expect(h.sent.map((email) => email['to'])).toEqual(['user-9@example.com'])
  })

  it('reports an unticked "Email the owners" as a skip, and still writes the in-app notice', async () => {
    const h = harness()
    const result = await notifyRiskEvent(
      { kind: 'site-locked', orgId: null, hostId: 'host-1', lock: { message: 'Held.' }, emailOwners: false },
      h.deps,
    )
    expect(h.sent).toEqual([])
    expect(result.owners.emailSkipped).toMatch(/chose not to email/)
    // The site's managers are told alongside the workspace's owners.
    expect(h.inApp[0].uids).toEqual(expect.arrayContaining(['owner-1', 'admin-1', 'manager-1']))
  })

  it('sends a routine notice about the workspace’s own customers in the workspace’s brand', async () => {
    const h = harness()
    await notifyRiskEvent(
      { kind: 'sale-fraud-warning', orgId: null, hostId: 'host-1', item: { label: 'order 1042' } },
      h.deps,
    )
    expect(h.sent[0]).toMatchObject({ fromName: 'Harbor View' })
    await notifyRiskEvent({ kind: 'workspace-locked', orgId: 'org-1' }, h.deps)
    expect(h.sent[h.sent.length - 1]).not.toHaveProperty('fromName')
  })
})

describe('closeRiskNotice', () => {
  it('tells the owners how a row ended, in the closing kind the catalog names', async () => {
    const h = harness()
    const input = held(7)
    h.firestore.docs.set(`abuseReports/${input.reviewId}`, { orgId: 'org-1', reference: 'HS-7', status: 'dismissed' })
    await notifyRiskEvent(input, h.deps)
    const closed = await closeRiskNotice({ reviewId: input.reviewId, decision: 'released' }, h.deps)
    expect(closed?.duplicate).toBe(false)
    expect(h.inApp[h.inApp.length - 1].payload['title']).toBe('Your held email was released')
    // Once per decision.
    expect((await closeRiskNotice({ reviewId: input.reviewId, decision: 'released' }, h.deps))?.duplicate).toBe(true)
  })
})

describe('requestRiskReview', () => {
  async function heldRow(h: ReturnType<typeof harness>) {
    const input = held(8)
    h.firestore.docs.set(`abuseReports/${input.reviewId}`, {
      orgId: 'org-1',
      reference: 'HS-8',
      status: 'open',
      heldSend: { state: 'held', kind: 'campaign' },
    })
    const { noticeId } = await notifyRiskEvent(input, h.deps)
    return { reviewId: input.reviewId, noticeId: String(noticeId) }
  }

  it('appends to the SAME abuse-queue row and tells staff, without deciding anything', async () => {
    const h = harness()
    const { reviewId, noticeId } = await heldRow(h)
    const rowsBefore = [...h.firestore.docs.keys()].filter((key) => key.startsWith('abuseReports/'))
    h.staff.length = 0
    const outcome = await requestRiskReview(
      { orgId: 'org-1', noticeId, uid: 'owner-1', email: 'avery@example.com', note: 'This is our own resale shop, really.' },
      h.deps,
    )
    expect(outcome).toMatchObject({ ok: true, reference: 'HS-8' })
    const rowsAfter = [...h.firestore.docs.keys()].filter((key) => key.startsWith('abuseReports/'))
    expect(rowsAfter).toEqual(rowsBefore)
    const row = h.firestore.docs.get(`abuseReports/${reviewId}`) ?? {}
    expect(row['ownerReviewRequests']).toEqual([
      expect.objectContaining({ uid: 'owner-1', note: 'This is our own resale shop, really.', noticeId }),
    ])
    // Owners can never release: the status and the held send are untouched.
    expect(row['status']).toBe('open')
    expect(row['heldSend']).toEqual({ state: 'held', kind: 'campaign' })
    expect(h.staff).toEqual([
      expect.objectContaining({ link: `/admin/abuse-reports?report=${reviewId}` }),
    ])
    // The person who asked is told it arrived.
    expect(h.sent[h.sent.length - 1]).toMatchObject({ to: 'avery@example.com', subject: 'We received your review request' })
  })

  it('refuses another workspace’s notice, a notice with nothing to review, and a flood', async () => {
    const h = harness()
    const { noticeId } = await heldRow(h)
    const note = 'Please take another look at this one.'
    expect(await requestRiskReview({ orgId: 'org-2', noticeId, uid: 'x', email: null, note }, h.deps)).toMatchObject({
      ok: false,
      status: 404,
    })
    expect(
      await requestRiskReview({ orgId: 'org-1', noticeId, uid: 'owner-1', email: null, note: 'short' }, h.deps),
    ).toMatchObject({ ok: false, status: 400 })
    await requestRiskReview({ orgId: 'org-1', noticeId, uid: 'owner-1', email: null, note }, h.deps)
    expect(await requestRiskReview({ orgId: 'org-1', noticeId, uid: 'owner-1', email: null, note }, h.deps)).toMatchObject({
      ok: false,
      status: 429,
    })
    const lock = await notifyRiskEvent({ kind: 'workspace-locked', orgId: 'org-1' }, h.deps)
    expect(
      await requestRiskReview({ orgId: 'org-1', noticeId: String(lock.noticeId), uid: 'owner-1', email: null, note }, h.deps),
    ).toMatchObject({ ok: false, status: 409 })
  })

  it('names its notice ids the way the owner surface addresses them', () => {
    expect(riskNoticeId('email-held:abc')).toMatch(/^[a-f0-9]{40}$/)
  })
})

describe('listOwnerRiskNotices', () => {
  it('shows the owners the catalog’s words, the row’s state and their own console links — never the evidence', async () => {
    const h = harness()
    const input = { ...held(9), hostId: 'host-1' }
    h.firestore.docs.set(`abuseReports/${input.reviewId}`, {
      orgId: 'org-1',
      status: 'open',
      heldSend: { state: 'held' },
      details: 'Lookalike link to paypal-secure.example.',
    })
    await notifyRiskEvent(input, h.deps)
    const [view] = await listOwnerRiskNotices({ orgId: 'org-1', viewerUid: 'owner-1' }, h.deps)
    expect(view).toMatchObject({
      kind: 'email-held',
      title: 'An email is on hold for review',
      status: 'held',
      reviewable: true,
    })
    const hrefs = Object.fromEntries(view.actions.map((action) => [action.id, action.href]))
    expect(hrefs['request-review']).toBe(`/harbor-view/settings/holds?notice=${view.noticeId}`)
    expect(hrefs['view-details']).toBe('/harbor-view/emails/messages/send-9')
    expect(JSON.stringify(view)).not.toMatch(/paypal|lookalike/i)

    // A staff release shows as released.
    h.firestore.docs.set(`abuseReports/${input.reviewId}`, {
      ...h.firestore.docs.get(`abuseReports/${input.reviewId}`),
      heldSend: { state: 'released' },
      status: 'dismissed',
    })
    const [after] = await listOwnerRiskNotices({ orgId: 'org-1', viewerUid: 'owner-1' }, h.deps)
    expect(after.status).toBe('released')
  })
})
