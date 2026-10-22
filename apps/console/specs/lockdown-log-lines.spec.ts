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

import { lockLogLines, resendLogLines } from '../utils/lockdown-log-lines'
import { quarantineLogLines } from '../utils/quarantine-log-lines'

/**
 * The lines under "Actions taken in this session" (AGL-1571), which the lockdown and disabled-files pages and the
 * staff apps keep alike (AGL-3667): one for the act, then one for each step the route reported beside it, each
 * verified or NOT CONFIRMED.
 */
describe('a lock or lift leaves the act and then each step it reported', () => {
  it('names the act, and reads a read-back that disagrees as not confirmed', () => {
    expect(lockLogLines({ action: 'lock', scope: 'org', targetId: 'o1' }, {})).toEqual([
      { text: 'Locked org o1', confirmed: true },
    ])
    expect(lockLogLines({ action: 'unlock', scope: 'platform' }, { confirmed: false })).toEqual([
      { text: 'Unlocked platform', confirmed: false },
    ])
  })

  it('keeps a lock that landed and a billing cancel that did not as two facts', () => {
    const lines = lockLogLines(
      { action: 'lock', scope: 'org', targetId: 'o1' },
      {
        confirmed: true,
        subscriptionCancel: {
          orgId: 'o1',
          confirmed: false,
          lookupErrors: ['Stripe timed out'],
          subscriptions: [{ id: 'sub_1', confirmed: false, error: 'rate limited' }],
        },
      },
    )
    expect(lines).toEqual([
      { text: 'Locked org o1', confirmed: true },
      { text: 'Billing cancel for workspace o1 NOT confirmed — the lock stands. Stripe timed out; sub_1: rate limited', confirmed: false },
    ])
  })

  it('reports renewals, payouts, plugin holds and the owner email, one line each', () => {
    const lines = lockLogLines(
      { action: 'lock', scope: 'host', targetId: 'h1' },
      {
        renewalsPause: { confirmed: true, subscriptions: [{ outcome: 'paused' }, { outcome: 'paused' }, { outcome: 'held' }] },
        payoutsPause: { accountId: 'acct_1', confirmed: true, outcome: 'paused', schedule: { interval: 'daily' } },
        payoutsPauseOthers: [{ accountId: 'acct_2', label: 'Marketplace', outcome: 'not-controllable' }],
        orgLockParticipants: [{ pluginId: 'marketplace', summary: '3 listings hidden', confirmed: true }],
        ownerNotice: { scope: 'host', targetId: 'h1', kind: 'site-locked', emailed: 2, recipients: 2, confirmed: true },
      },
    )
    expect(lines.map((line) => line.text)).toEqual([
      'Locked host h1',
      'Paused 2 membership renewal(s) — nothing canceled or refunded, customers not told; 1 already held by another lock',
      'Payouts for acct_1 set to manual (was daily; saved for the lift)',
      'Payouts for acct_2 (Marketplace): not controllable (Standard account) — pause them in the Stripe Dashboard',
      'marketplace: 3 listings hidden',
      "Emailed host h1's owners the site-locked notice — 2 of 2",
    ])
    expect(lines.map((line) => line.confirmed)).toEqual([true, true, true, false, true, true])
  })

  it('names the workspaces an account owned, and says when it owned none', () => {
    const none = lockLogLines({ action: 'lock', scope: 'user', targetId: 'u1' }, { ownedWorkspaces: { workspaces: [] } })
    expect(none[1]).toEqual({ text: 'This account owns no workspaces — nothing else to lock or cancel', confirmed: true })
    const some = lockLogLines(
      { action: 'lock', scope: 'user', targetId: 'u1' },
      { ownedWorkspaces: { workspaces: [{ slug: 'acme', orgId: 'o1', confirmed: true }, { orgId: 'o2', alreadyLocked: true }], truncated: true } },
    )
    expect(some.map((line) => line.text)).toEqual([
      'Locked user u1',
      'Locked owned workspace acme',
      'owned workspace o2 was already locked — left as it was',
      'This account owns more workspaces than one lock handles — lock the rest by org id',
    ])
  })
})

describe('a resend of owner notices leaves a line for each refusal and each recipient', () => {
  it('words sent, already sent and failed, and a target the resend refused', () => {
    const lines = resendLogLines(
      {
        targets: [{ scope: 'org', targetId: 'o9', error: 'Not locked' }, { scope: 'org', targetId: 'o1' }],
        recipients: [
          { email: 'a@x.co', outcome: 'sent', sentLockKeys: ['k1', 'k2'] },
          { email: 'b@x.co', outcome: 'already-sent', alreadySentAtMs: 1_790_000_000_000 },
          { email: 'c@x.co', outcome: 'failed', error: 'bounced' },
        ],
      },
      (ms) => `at ${ms}`,
    )
    expect(lines).toEqual([
      { text: 'Resend for org o9: Not locked', confirmed: false },
      { text: 'Owner notice sent to a@x.co for 2 lock(s)', confirmed: true },
      { text: 'Owner notice for b@x.co already sent at at 1790000000000 — tick "Send again" to resend', confirmed: true },
      { text: 'Owner notice to c@x.co FAILED — bounced', confirmed: false },
    ])
  })
})

describe('a disable or release of a file leaves one line', () => {
  it('counts the keys, and reads a read-back that still shows the entry as not confirmed', () => {
    expect(quarantineLogLines({ action: 'quarantine', by: 'media', mediaId: ' m1 ' }, { keys: ['a'] })).toEqual([
      { text: 'Disabled m1 (1 key)', confirmed: true },
    ])
    expect(quarantineLogLines({ action: 'release', by: 'media', mediaId: 'm1' }, { keys: ['a', 'b'], confirmed: false })).toEqual([
      { text: 'Released m1 (2 keys)', confirmed: false },
    ])
    expect(quarantineLogLines({ action: 'release', by: 'key', key: 'hash--abc' }, {})).toEqual([
      { text: 'Released hash--abc', confirmed: true },
    ])
  })
})
