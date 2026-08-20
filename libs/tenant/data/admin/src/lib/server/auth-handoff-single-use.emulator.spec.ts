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
 * AGL-1902 §7.1 — a redeemed handoff cannot be redeemed twice, under
 * CONCURRENCY.
 *
 * The design says this in as many words: "two concurrent redemptions,
 * asserting exactly one custom token and one clean failure. Run against the
 * Firestore emulator; **a serial test does not exercise the property**." The
 * serial half lives in `auth-handoff.spec.ts` against an in-memory double.
 * This is the half a double cannot prove, because the guarantee does not come
 * from our code at all — it comes from Firestore transactions being
 * serializable with optimistic concurrency, which a hand-written fake would
 * simply assert into existence.
 *
 * It also proves the shape of the transaction rather than only its outcome:
 * `consumeOnce` always WRITES to the document it read, so contention is
 * detected. A read-only check followed by a write outside the transaction
 * would pass every serial test and let both callers through here.
 *
 * Skipped unless FIRESTORE_EMULATOR_HOST is set. Start the emulator, then:
 *
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8082 \
 *     npx jest -c libs/tenant/data/admin/jest.config.ts \
 *       --testPathPatterns auth-handoff-single-use.emulator
 */

import { getApps, initializeApp } from 'firebase-admin/app'

const EMULATED = Boolean(process.env.FIRESTORE_EMULATOR_HOST)

// Before any module reads them: no fixture may reach a real integration.
delete process.env.STRIPE_SECRET_KEY
delete process.env.VERCEL_TOKEN
delete process.env.VERCEL_CONSOLE_PROJECT_ID

if (EMULATED && !getApps().length) {
  initializeApp({ projectId: 'aglyn-main' })
}

const mockResolve = jest.fn()
jest.mock('./console-domains', () => ({
  ...jest.requireActual('./console-domains'),
  resolveConsoleDomain: (host: string) => mockResolve(host),
}))

import {
  authorizeConsoleHandoff,
  AUTH_HANDOFFS_COLLECTION,
  redeemConsoleHandoff,
  startConsoleHandoff,
} from './auth-handoff'
import firebaseAdmin from './firebase-admin'

const HOST = 'console.acme-agency.com'
const describeOrSkip = EMULATED ? describe : describe.skip

describeOrSkip('§7.1 concurrent redemption (emulator)', () => {
  beforeEach(() => {
    mockResolve.mockResolvedValue({
      known: true,
      servable: true,
      orgSlug: 'acme',
      reason: 'active',
      degraded: false,
    })
  })

  it('lets exactly ONE of two simultaneous redemptions through', async () => {
    const started = await startConsoleHandoff({
      targetHost: HOST,
      orgSlug: 'acme',
      continuePath: '/acme/sites',
    })
    const auth = await authorizeConsoleHandoff({
      requestId: started!.requestId,
      uid: 'u1',
      isMember: async () => true,
    })
    if (auth.ok === false) throw new Error(`authorize refused: ${auth.reason}`)

    const attempt = () =>
      redeemConsoleHandoff({
        requestId: started!.requestId,
        secret: auth.secret,
        verifiers: [started!.verifier],
        requestHost: HOST,
      })

    // Fired without awaiting between them, so both transactions are open on
    // the same document at once. One commits; the loser retries, re-reads
    // `redeemed`, and refuses cleanly rather than throwing.
    const results = await Promise.all([attempt(), attempt()])
    const winners = results.filter((r) => r.ok)
    const losers = results.filter((r) => !r.ok)

    expect(winners).toHaveLength(1)
    expect(losers).toHaveLength(1)
    expect(winners[0]).toMatchObject({ ok: true, uid: 'u1' })
    expect(losers[0]).toMatchObject({ ok: false, reason: 'already-redeemed' })

    const doc = await firebaseAdmin
      .app()
      .firestore()
      .collection(AUTH_HANDOFFS_COLLECTION)
      .doc(started!.requestId)
      .get()
    expect(doc.get('status')).toBe('redeemed')
    // Nothing that could authorize another redemption survives.
    expect(doc.get('secretHash')).toBeNull()
    expect(doc.get('verifierHash')).toBeNull()
  })

  it('lets exactly ONE of eight simultaneous redemptions through', async () => {
    // Two can pass by luck if the write is racy in one direction; eight makes
    // that a much harder coincidence.
    const started = await startConsoleHandoff({ targetHost: HOST, orgSlug: 'acme' })
    const auth = await authorizeConsoleHandoff({
      requestId: started!.requestId,
      uid: 'u1',
      isMember: async () => true,
    })
    if (!auth.ok) throw new Error('authorize refused')

    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        redeemConsoleHandoff({
          requestId: started!.requestId,
          secret: auth.secret,
          verifiers: [started!.verifier],
          requestHost: HOST,
        }),
      ),
    )

    expect(results.filter((r) => r.ok)).toHaveLength(1)
    expect(
      results.filter((r) => r.ok === false && r.reason === 'already-redeemed'),
    ).toHaveLength(7)
  })

  it('lets exactly ONE of two simultaneous AUTHORIZE calls through', async () => {
    // The same property on the other leg: a request id that could be
    // authorized twice would mint a fresh secret each time.
    const started = await startConsoleHandoff({ targetHost: HOST, orgSlug: 'acme' })
    const attempt = () =>
      authorizeConsoleHandoff({
        requestId: started!.requestId,
        uid: 'u1',
        isMember: async () => true,
      })

    const results = await Promise.all([attempt(), attempt()])

    expect(results.filter((r) => r.ok)).toHaveLength(1)
    expect(results.filter((r) => !r.ok)).toHaveLength(1)
  })
})
