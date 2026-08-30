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

import type { EmailDeliveryEvent } from '@aglyn/shared-util-email'
import { FieldValue } from 'firebase-admin/firestore'
import {
  eraseEmailDeliveries,
  eraseEmailDeliveriesForAddresses,
  importEmailDeliveryHistory,
  readEmailDeliveries,
  readEmailDeliveryErasure,
  readEmailDeliveryHistory,
  readPersonEngagement,
  readPersonEngagementByKeys,
  recordEmailDeliveryEvent,
  recordEmailCampaignTouch,
  recordEmailDeliverySnapshot,
  recordPersonEngagement,
  readEmailCampaignTouch,
  EMAIL_TOUCH_FIELD,
} from './email-delivery-log'
import { emailSuppressionKey } from './email-suppression'

/*==========================================
 * A LOCAL DOUBLE, not `test-firestore`.
 *
 * That fake is deliberately thin — its own header says ordering and limits are
 * not what its specs are about — and this module depends on three things it
 * does not model: subcollections, `runTransaction` and `FieldValue.increment`.
 * All three are load-bearing here, so a double that ignored them would turn
 * this file into a green test over behaviour nothing checked.
 *
 * Widening the shared fake instead would change the ground under every other
 * spec that uses it, which is not a trade worth making for one module.
 *
 * ## A DOUBLE THAT WAS WRONG THE SAME WAY THE CODE WAS
 *
 * This fake originally treated a dotted key in a merge-set as a field PATH,
 * because the code under test wrote one. Real Firestore does not: `set()`
 * with `merge` treats `'timestamps.sent'` as a field whose NAME contains a
 * dot, and only `update()` reads it as a path. So the write landed in a
 * top-level field nothing reads, `timestamps` stayed empty, and the staff
 * card showed messages with no send date — while every assertion here passed,
 * because the double reproduced the bug faithfully.
 *
 * It was caught by running the real import against the real database. The
 * double now models what Firestore actually does — dots are literal, nested
 * maps deep-merge — so the same mistake fails here first.
 *=========================================*/

interface FakeDoc {
  path: string
  data: Record<string, any>
}

function applyWrite(
  target: Record<string, any>,
  update: Record<string, any>,
): Record<string, any> {
  const next = { ...target }
  for (const [key, value] of Object.entries(update)) {
    // `FieldValue.increment(n)` — matched structurally rather than by import,
    // because the sentinel's shape is what the emulator actually receives.
    if (value && typeof value === 'object' && 'operand' in (value as any)) {
      next[key] = Number(next[key] ?? 0) + Number((value as any).operand)
      continue
    }
    // `FieldValue.delete()` — asked before the timestamp branch below, which
    // matches every sentinel and would otherwise turn a deletion into a
    // written field. Compared through the sentinel's own `isEqual` rather
    // than by class name, so it stays right across SDK versions.
    if (
      value &&
      typeof value === 'object' &&
      typeof (value as any).isEqual === 'function' &&
      FieldValue.delete().isEqual(value as any)
    ) {
      delete next[key]
      continue
    }
    // A server timestamp sentinel: frozen so a spec can see it landed.
    if (
      value &&
      typeof value === 'object' &&
      typeof (value as any).isEqual === 'function' &&
      !('operand' in (value as any))
    ) {
      next[key] = { serverTimestamp: true }
      continue
    }
    // Real `set({merge:true})` merges nested MAPS at depth, keeping the
    // siblings the write did not mention.
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      next[key] &&
      typeof next[key] === 'object' &&
      !Array.isArray(next[key])
    ) {
      next[key] = { ...next[key], ...value }
      continue
    }
    // A dot in a key is part of the NAME here, exactly as Firestore treats it
    // in a merge-set. Reproducing that is the whole point: it is what makes a
    // dotted write visible as the mistake it is rather than silently working.
    next[key] = value
  }
  return next
}

function fakeDeliveryFirestore() {
  const store = new Map<string, Record<string, any>>()

  const docRef = (path: string) => ({
    path,
    id: path.split('/').pop() as string,
    get: async () => ({
      exists: store.has(path),
      id: path.split('/').pop(),
      data: () => store.get(path),
      // Real snapshots carry `get(field)` alongside `data()`, and the
      // tombstone reader uses it. A double offering only `data()` would throw
      // on the one read that proves an erasure was recorded — which reads as
      // a broken spec rather than the missing behaviour it is.
      get: (field: string) => store.get(path)?.[field],
    }),
    set: async (update: Record<string, any>) => {
      store.set(path, applyWrite(store.get(path) ?? {}, update))
    },
    delete: async () => void store.delete(path),
    collection: (name: string) => collectionRef(`${path}/${name}`),
  })

  const collectionRef = (prefix: string) => {
    let order: { field: string; dir: string } | null = null
    let cap = Infinity
    const api: any = {
      doc: (id: string) => docRef(`${prefix}/${id}`),
      orderBy: (field: string, dir = 'asc') => {
        order = { field, dir }
        return api
      },
      limit: (value: number) => {
        cap = value
        return api
      },
      get: async () => {
        let entries: FakeDoc[] = [...store.entries()]
          .filter(([path]) => {
            const rest = path.slice(prefix.length + 1)
            return path.startsWith(`${prefix}/`) && !rest.includes('/')
          })
          .map(([path, data]) => ({ path, data }))
        if (order) {
          const { field, dir } = order
          // Real `orderBy` DROPS documents that lack the field — the exact
          // trap `readEmailDeliveries` is written to avoid, so the double has
          // to reproduce it or the guarantee goes untested.
          entries = entries
            .filter((entry) => entry.data[field] !== undefined)
            .sort((a, b) =>
              dir === 'desc'
                ? Number(b.data[field]) - Number(a.data[field])
                : Number(a.data[field]) - Number(b.data[field]),
            )
        }
        entries = entries.slice(0, cap)
        return {
          empty: entries.length === 0,
          size: entries.length,
          docs: entries.map((entry) => ({
            id: entry.path.split('/').pop(),
            ref: docRef(entry.path),
            data: () => entry.data,
          })),
        }
      },
    }
    return api
  }

  /**
   * Collection-group reads, which the erasure needs and no other case here
   * does. The conversion attributions an erasure has to reach live under
   * `hosts/{hostId}/campaignAttributions`, per SITE, while an erasure request
   * names only an ADDRESS — so a double that could only walk one host's
   * collection would let the sweep pass while reaching nothing. It swallows
   * its own errors, so a missing `collectionGroup` here reads as an erasure
   * that removed zero records rather than as a broken double.
   */
  const groupQuery = (
    name: string,
    field?: string,
    value?: unknown,
    cap = Infinity,
  ): any => ({
    where: (nextField: string, _op: string, nextValue: unknown) =>
      groupQuery(name, nextField, nextValue, cap),
    limit: (n: number) => groupQuery(name, field, value, n),
    get: async () => {
      const matched = [...store.entries()]
        .filter(([path]) => path.split('/').slice(-2)[0] === name)
        .filter(([, data]) => !field || data[field] === value)
        .slice(0, cap)
      return {
        empty: matched.length === 0,
        size: matched.length,
        docs: matched.map(([path, data]) => ({
          id: path.split('/').pop(),
          ref: docRef(path),
          data: () => data,
        })),
      }
    },
  })

  return {
    collection: (name: string) => collectionRef(name),
    collectionGroup: (name: string) => groupQuery(name),
    runTransaction: async (body: (transaction: any) => Promise<void>) =>
      body({
        get: async (ref: any) => ref.get(),
        set: async (ref: any, update: Record<string, any>) => ref.set(update),
      }),
    batch: () => {
      const queued: Array<() => Promise<void>> = []
      return {
        delete: (ref: any) => queued.push(() => ref.delete()),
        commit: async () => {
          for (const run of queued) await run()
        },
      }
    },
    /**
     * Keyed multi-get. Real `getAll` answers for EVERY reference given,
     * including ones that do not exist — a double that returned only the
     * present ones would let a reader that silently dropped absent keys pass.
     */
    getAll: async (...refs: Array<{ path: string }>) =>
      refs.map((ref) => ({
        exists: store.has(ref.path),
        id: ref.path.split('/').pop(),
        data: () => store.get(ref.path),
        get: (field: string) => store.get(ref.path)?.[field],
      })),
    /** Spec helper: seed and read one conversion attribution record. */
    seedAttribution: (hostId: string, id: string, personKey: string) =>
      store.set(`hosts/${hostId}/campaignAttributions/${id}`, {
        kind: 'form',
        refId: id,
        personKey,
      }),
    attribution: (hostId: string, id: string) =>
      store.get(`hosts/${hostId}/campaignAttributions/${id}`),
    /** Spec helper: the raw document, by address and message id. */
    read: (email: string, messageId: string) =>
      store.get(
        `emailDeliveries/${emailSuppressionKey(email)}/messages/${messageId}`,
      ),
    /** Spec helper: the PERSON document — the rollup's and the tombstone's home. */
    readPerson: (email: string) =>
      store.get(`emailDeliveries/${emailSuppressionKey(email)}`),
    size: () => store.size,
  }
}

function event(overrides: Partial<EmailDeliveryEvent> = {}): EmailDeliveryEvent {
  return {
    type: 'sent',
    at: 1_000,
    provider: 'resend',
    providerMessageId: 'msg_1',
    to: 'person@example.com',
    subject: 'Confirm your email address',
    context: 'email-verification',
    tags: {},
    link: null,
    bounceType: null,
    detail: null,
    ...overrides,
  }
}

describe('recordEmailDeliveryEvent', () => {
  it('files a message under the same key the suppression lists use', async () => {
    const firestore = fakeDeliveryFirestore()
    await recordEmailDeliveryEvent(event(), firestore)

    // Not an incidental detail: two collections keyed differently is how a
    // lookup comes to describe the wrong person.
    expect(firestore.read('person@example.com', 'msg_1')).toMatchObject({
      to: 'person@example.com',
      subject: 'Confirm your email address',
      context: 'email-verification',
      status: 'sent',
    })
  })

  it('accumulates the lifecycle into one document rather than one per event', async () => {
    const firestore = fakeDeliveryFirestore()
    await recordEmailDeliveryEvent(event({ type: 'sent', at: 1_000 }), firestore)
    await recordEmailDeliveryEvent(
      event({ type: 'delivered', at: 2_000 }),
      firestore,
    )
    await recordEmailDeliveryEvent(event({ type: 'opened', at: 3_000 }), firestore)

    const stored = firestore.read('person@example.com', 'msg_1')
    // Every state, in one map. Written as a nested map because merge deep-
    // merges those and keeps the siblings; a dotted key would instead create
    // three separate fields named `timestamps.sent`, `timestamps.delivered`
    // and `timestamps.opened` that no reader ever looks at — which is exactly
    // what shipped, and what the live import surfaced.
    expect(stored?.timestamps).toEqual({
      sent: 1_000,
      delivered: 2_000,
      opened: 3_000,
    })
    expect(stored?.status).toBe('opened')
  })

  it('counts opens and clicks, and keeps the distinct links', async () => {
    const firestore = fakeDeliveryFirestore()
    await recordEmailDeliveryEvent(event({ type: 'opened' }), firestore)
    await recordEmailDeliveryEvent(event({ type: 'opened' }), firestore)
    await recordEmailDeliveryEvent(
      event({ type: 'clicked', link: 'https://app.aglyn.com/billing' }),
      firestore,
    )
    await recordEmailDeliveryEvent(
      event({ type: 'clicked', link: 'https://app.aglyn.com/billing' }),
      firestore,
    )

    const stored = firestore.read('person@example.com', 'msg_1')
    expect(stored?.openCount).toBe(2)
    expect(stored?.clickCount).toBe(2)
    // The same link twice is two clicks and one destination.
    expect(stored?.clickedLinks).toEqual(['https://app.aglyn.com/billing'])
  })

  /*==========================================
   * `firstOfType` — the distinct-recipient signal.
   *
   * The delivery webhook's campaign counters (`delivered`, `bounced`,
   * `complained`, `uniqueOpens`, `uniqueClicks`) are all "one per MESSAGE,
   * not one per event", and this transaction is where that can be answered
   * for free: it already reads the row to decide whether to stamp
   * `firstSeenAtMs`. Deriving it anywhere else would cost a document read per
   * delivery event.
   *
   * It is also the whole idempotency of those counters. A provider retry, a
   * duplicate webhook and a dashboard replay all arrive as a second event for
   * the same message, and each has to contribute nothing.
   *=========================================*/

  it('reports the first event of a type as first', async () => {
    const firestore = fakeDeliveryFirestore()

    expect(
      await recordEmailDeliveryEvent(event({ type: 'delivered' }), firestore),
    ).toEqual({
      firstOfType: true,
      providerMessageId: 'msg_1',
      // Carried out with the verdict so the person rollup can be driven from
      // the outcomes alone. Deriving them by re-pairing outcomes against the
      // events they came from would need index alignment the filtered return
      // has already destroyed.
      to: 'person@example.com',
      type: 'delivered',
      at: 1_000,
    })
  })

  it('reports a SECOND event of the same type as not first', async () => {
    const firestore = fakeDeliveryFirestore()
    await recordEmailDeliveryEvent(event({ type: 'delivered' }), firestore)

    expect(
      await recordEmailDeliveryEvent(event({ type: 'delivered' }), firestore),
    ).toMatchObject({ firstOfType: false })
  })

  /*
   * PER TYPE, not per document. An `opened` after a `delivered` is the first
   * open even though the row already existed — a counter keyed on "is this
   * row new" would count the delivery and silently never count an open.
   */
  it('is per event type, not per message row', async () => {
    const firestore = fakeDeliveryFirestore()
    await recordEmailDeliveryEvent(event({ type: 'delivered' }), firestore)

    expect(
      await recordEmailDeliveryEvent(event({ type: 'opened' }), firestore),
    ).toMatchObject({ firstOfType: true })
  })

  it('is per message, so a second recipient is first again', async () => {
    const firestore = fakeDeliveryFirestore()
    await recordEmailDeliveryEvent(
      event({ type: 'opened', providerMessageId: 'msg_a' }),
      firestore,
    )

    expect(
      await recordEmailDeliveryEvent(
        event({ type: 'opened', providerMessageId: 'msg_b' }),
        firestore,
      ),
    ).toMatchObject({ firstOfType: true })
  })

  /*
   * An event whose timestamp is 0 is still an event. Reading the flag off a
   * truthiness check rather than off presence would report every such row as
   * first, forever — and 0 is what a payload carrying no usable timestamp
   * falls back to in more than one adapter.
   */
  it('treats a recorded timestamp of 0 as recorded', async () => {
    const firestore = fakeDeliveryFirestore()
    await recordEmailDeliveryEvent(event({ type: 'opened', at: 0 }), firestore)

    expect(
      await recordEmailDeliveryEvent(event({ type: 'opened', at: 9 }), firestore),
    ).toMatchObject({ firstOfType: false })
  })

  /*
   * The property the transaction exists for. Events arrive out of order, and
   * a document created by an `opened` must still be found by a read that
   * orders on `firstSeenAtMs` — a document missing that field is dropped from
   * the query entirely, so the message would simply not appear.
   */
  it('stamps firstSeenAtMs once, from whichever event arrives first', async () => {
    const firestore = fakeDeliveryFirestore()
    await recordEmailDeliveryEvent(event({ type: 'opened', at: 5_000 }), firestore)
    await recordEmailDeliveryEvent(event({ type: 'sent', at: 1_000 }), firestore)

    expect(firestore.read('person@example.com', 'msg_1')?.firstSeenAtMs).toBe(
      5_000,
    )
  })

  it('never overwrites a known subject with a payload that carries none', async () => {
    const firestore = fakeDeliveryFirestore()
    await recordEmailDeliveryEvent(event({ type: 'sent' }), firestore)
    await recordEmailDeliveryEvent(
      event({ type: 'opened', subject: null, context: null }),
      firestore,
    )

    // An open payload carries no subject. Letting it win would leave the staff
    // row with nothing identifying the message it describes.
    const stored = firestore.read('person@example.com', 'msg_1')
    expect(stored?.subject).toBe('Confirm your email address')
    expect(stored?.context).toBe('email-verification')
  })

  it('records a bounce with its type and the provider’s reason', async () => {
    const firestore = fakeDeliveryFirestore()
    await recordEmailDeliveryEvent(
      event({
        type: 'bounced',
        bounceType: 'permanent',
        detail: 'mailbox does not exist',
      }),
      firestore,
    )

    expect(firestore.read('person@example.com', 'msg_1')).toMatchObject({
      status: 'bounced',
      bounceType: 'permanent',
      detail: 'mailbox does not exist',
    })
  })

  it('writes nothing for an address that is not an address', async () => {
    const firestore = fakeDeliveryFirestore()
    expect(
      await recordEmailDeliveryEvent(event({ to: 'not-an-address' }), firestore),
    ).toBeNull()
    expect(firestore.size()).toBe(0)
  })

  it('reports failure instead of throwing, so a webhook still answers 200', async () => {
    const exploding = {
      collection: () => {
        throw new Error('firestore down')
      },
    }
    // A throw here becomes a non-2xx, which the provider answers by retrying
    // the same event forever.
    await expect(
      recordEmailDeliveryEvent(event(), exploding),
    ).resolves.toBeNull()
  })
})

describe('readEmailDeliveries', () => {
  it('returns messages newest first', async () => {
    const firestore = fakeDeliveryFirestore()
    await recordEmailDeliveryEvent(
      event({ providerMessageId: 'old', at: 1_000, subject: 'Older' }),
      firestore,
    )
    await recordEmailDeliveryEvent(
      event({ providerMessageId: 'new', at: 9_000, subject: 'Newer' }),
      firestore,
    )

    const rows = await readEmailDeliveries('person@example.com', { firestore })
    expect(rows.map((row) => row.subject)).toEqual(['Newer', 'Older'])
  })

  it('finds a message whose only event was an open', async () => {
    const firestore = fakeDeliveryFirestore()
    await recordEmailDeliveryEvent(
      event({ type: 'opened', providerMessageId: 'orphan', at: 4_000 }),
      firestore,
    )

    // Ordering on a per-state timestamp would hide exactly this row — a
    // message whose `sent` webhook never arrived is the one a staffer is
    // most likely to be looking for.
    const rows = await readEmailDeliveries('person@example.com', { firestore })
    expect(rows).toHaveLength(1)
    expect(rows[0].status).toBe('opened')
  })

  it('is empty for an address we never mailed', async () => {
    const firestore = fakeDeliveryFirestore()
    expect(await readEmailDeliveries('nobody@example.com', { firestore })).toEqual(
      [],
    )
  })

  it('reads case-insensitively, since the log is keyed on the normalized form', async () => {
    const firestore = fakeDeliveryFirestore()
    await recordEmailDeliveryEvent(event(), firestore)
    expect(
      await readEmailDeliveries('PERSON@Example.com', { firestore }),
    ).toHaveLength(1)
  })
})

describe('readEmailDeliveryHistory', () => {
  it('separates a failed read from an empty one', async () => {
    const exploding = {
      collection: () => {
        throw new Error('firestore down')
      },
    }
    // The whole reason the wrapper exists: a staff card that renders both as
    // an empty table tells somebody we never emailed them.
    expect(
      await readEmailDeliveryHistory('person@example.com', {
        firestore: exploding,
      }),
    ).toEqual({ lookupFailed: true, rows: [] })
  })

  it('reports a successful empty read as not-failed', async () => {
    const firestore = fakeDeliveryFirestore()
    expect(
      await readEmailDeliveryHistory('person@example.com', { firestore }),
    ).toEqual({ lookupFailed: false, rows: [] })
  })
})

describe('eraseEmailDeliveries', () => {
  it('removes every message recorded for the address', async () => {
    const firestore = fakeDeliveryFirestore()
    await recordEmailDeliveryEvent(event({ providerMessageId: 'a' }), firestore)
    await recordEmailDeliveryEvent(event({ providerMessageId: 'b' }), firestore)

    // The log holds an address, the subjects sent to it and when they were
    // opened. An erasure that left it behind would be one this repo's own
    // Privacy Policy says does not happen.
    expect(await eraseEmailDeliveries('person@example.com', firestore)).toBe(2)
    expect(
      await readEmailDeliveries('person@example.com', { firestore }),
    ).toEqual([])
  })

  it('erases nothing, and reports nothing, for an account with no address', async () => {
    const firestore = fakeDeliveryFirestore()
    expect(await eraseEmailDeliveries(null, firestore)).toBe(0)
  })
})

/*==========================================
 * THE SWEEP ACROSS AN ACCOUNT'S ADDRESSES.
 *
 * What this function does with a set of addresses. THE RULE ITSELF — that an
 * address a second account also holds is left intact, and why — is specified
 * in `account-addresses.spec.ts`, end to end from the resolver that decides
 * `shared`. Repeating it here would be two places to keep a policy in step.
 *
 * Every assertion is on the DOCUMENTS — the messages that survive or do not,
 * and the tombstone — never on rendered output. The card is one more reader
 * of these documents; a spec that drove the card would pass on a page that
 * renders correctly over data that is wrong.
 *=========================================*/

describe('eraseEmailDeliveriesForAddresses', () => {
  const held = (address: string, shared = false) => ({ address, shared })

  it('erases an address only this account holds, and tombstones it', async () => {
    // CONTROL. If the contested-address cases ever pass because the sweep
    // reached nothing at all, this fails first and says so: same fixture,
    // same double, and it asserts the sweep DOES erase.
    const firestore = fakeDeliveryFirestore()
    await recordEmailDeliveryEvent(event({ providerMessageId: 'a' }), firestore)
    await recordEmailDeliveryEvent(event({ providerMessageId: 'b' }), firestore)

    const result = await eraseEmailDeliveriesForAddresses(
      [held('person@example.com')],
      firestore,
    )

    expect(result.removed).toBe(2)
    expect(result.addresses).toEqual(['person@example.com'])
    expect(result.contestedAddresses).toEqual([])
    expect(
      await readEmailDeliveries('person@example.com', { firestore }),
    ).toEqual([])

    // The tombstone: what the ordinary case leaves behind so no reader meets
    // a blank table and concludes we never wrote to them.
    const tombstone = await readEmailDeliveryErasure(
      'person@example.com',
      firestore,
    )
    expect(tombstone).not.toBeNull()
    expect(tombstone?.count).toBe(2)
  })

  it('erases the addresses it can decide about even when another is contested', async () => {
    // A contested address must not turn the sweep into a no-op. `eraseUser`
    // refuses the whole run before reaching here, but the guarantee belongs
    // to this function too: it stops at the contested address, not at the
    // first one.
    const firestore = fakeDeliveryFirestore()
    await recordEmailDeliveryEvent(event({ to: 'role@example.com' }), firestore)
    await recordEmailDeliveryEvent(
      event({ to: 'person@example.com' }),
      firestore,
    )

    const result = await eraseEmailDeliveriesForAddresses(
      [held('role@example.com', true), held('person@example.com')],
      firestore,
    )

    expect(result.contestedAddresses).toEqual(['role@example.com'])
    expect(result.addresses).toEqual(['person@example.com'])
    expect(result.removed).toBe(1)
    expect(
      await readEmailDeliveries('role@example.com', { firestore }),
    ).toHaveLength(1)
    expect(
      await readEmailDeliveries('person@example.com', { firestore }),
    ).toEqual([])
  })

  it('tombstones an erased address that held nothing', async () => {
    // An address swept and found empty is still covered by the request, and a
    // later import must not be able to refill it silently.
    const firestore = fakeDeliveryFirestore()

    const result = await eraseEmailDeliveriesForAddresses(
      [held('person@example.com')],
      firestore,
    )

    expect(result.removed).toBe(0)
    expect(result.addresses).toEqual(['person@example.com'])
    expect(
      await readEmailDeliveryErasure('person@example.com', firestore),
    ).not.toBeNull()
  })
})

/*==========================================
 * THE IMPORT, END TO END.
 *
 * The gap these cover is the one that shipped: the log is written from
 * delivery-webhook events, which exist only for mail sent after the webhook
 * was connected — so the staff card answered "no delivery events recorded"
 * for a person the sending dashboard plainly showed two delivered emails to.
 *
 * Every test below therefore ends at `readEmailDeliveries`, the call the
 * staff route actually makes. Asserting on the written document would have
 * passed for a row the card can never reach.
 *=========================================*/

function snapshot(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    provider: 'resend',
    providerMessageId: 'msg_hist_1',
    to: 'william.hymes@hitechproductions.com',
    subject: 'Confirm your email address',
    sentAt: 1_756_182_526_000,
    status: 'delivered' as const,
    ...overrides,
  }
}

/** A provider whose history is `pages`, served one page at a time. */
function fakeSource(pages: Array<Array<ReturnType<typeof snapshot>>>) {
  const source = async ({ cursor }: { cursor?: string | null } = {}) => {
    const index = cursor ? Number(cursor) : 0
    return {
      snapshots: pages[index] ?? [],
      nextCursor: index + 1 < pages.length ? String(index + 1) : null,
    }
  }
  return jest.fn(source)
}

describe('importEmailDeliveryHistory', () => {
  it('makes history the staff card can read', async () => {
    const firestore = fakeDeliveryFirestore()
    await importEmailDeliveryHistory({
      source: fakeSource([
        [
          snapshot(),
          snapshot({
            providerMessageId: 'msg_hist_2',
            subject: 'Welcome to Aglyn',
            sentAt: 1_756_182_000_000,
          }),
        ],
      ]),
      firestore,
    })

    // The exact read the detail route performs, for the exact address in the
    // screenshot that started this.
    const rows = await readEmailDeliveries(
      'william.hymes@hitechproductions.com',
      { firestore },
    )
    expect(rows.map((row) => row.subject)).toEqual([
      'Confirm your email address',
      'Welcome to Aglyn',
    ])
    expect(rows[0].status).toBe('delivered')
    expect(rows[0].timestamps.sent).toBe(1_756_182_526_000)
  })

  it('walks every page and stops when the provider runs out', async () => {
    const firestore = fakeDeliveryFirestore()
    const source = fakeSource([
      [snapshot({ providerMessageId: 'a' })],
      [snapshot({ providerMessageId: 'b' })],
      [snapshot({ providerMessageId: 'c' })],
    ])

    const result = await importEmailDeliveryHistory({ source, firestore })
    expect(result).toMatchObject({
      scanned: 3,
      recorded: 3,
      pages: 3,
      nextCursor: null,
      truncated: false,
    })
    expect(
      await readEmailDeliveries('william.hymes@hitechproductions.com', {
        firestore,
      }),
    ).toHaveLength(3)
  })

  /*
   * Bounded by pages because this runs inside a request. An unbounded loop
   * over a large history times the request out and loses every page it had
   * already written — a partial import that reports nothing is
   * indistinguishable from one that did nothing.
   */
  it('stops at the page budget and reports where to resume', async () => {
    const firestore = fakeDeliveryFirestore()
    const source = fakeSource([
      [snapshot({ providerMessageId: 'a' })],
      [snapshot({ providerMessageId: 'b' })],
      [snapshot({ providerMessageId: 'c' })],
    ])

    const first = await importEmailDeliveryHistory({
      source,
      maxPages: 2,
      firestore,
    })
    expect(first).toMatchObject({ pages: 2, truncated: true, nextCursor: '2' })
    // Work already done survives the stop.
    expect(
      await readEmailDeliveries('william.hymes@hitechproductions.com', {
        firestore,
      }),
    ).toHaveLength(2)

    const second = await importEmailDeliveryHistory({
      source,
      cursor: first.nextCursor,
      firestore,
    })
    expect(second).toMatchObject({ truncated: false })
    expect(
      await readEmailDeliveries('william.hymes@hitechproductions.com', {
        firestore,
      }),
    ).toHaveLength(3)
  })

  it('is safe to run twice', async () => {
    const firestore = fakeDeliveryFirestore()
    const pages = [[snapshot()]]
    await importEmailDeliveryHistory({ source: fakeSource(pages), firestore })
    await importEmailDeliveryHistory({ source: fakeSource(pages), firestore })

    // One message, one row — not a duplicate per run.
    expect(
      await readEmailDeliveries('william.hymes@hitechproductions.com', {
        firestore,
      }),
    ).toHaveLength(1)
  })
})

describe('recordEmailDeliverySnapshot', () => {
  /*
   * A snapshot is weaker evidence than an event: the list endpoint reports one
   * `last_event` and no engagement detail. Letting an import overwrite what
   * the live feed recorded would turn "opened three times, then bounced" into
   * "delivered", which is a worse answer than the empty card.
   */
  it('never walks a status backwards from what the event feed recorded', async () => {
    const firestore = fakeDeliveryFirestore()
    await recordEmailDeliveryEvent(
      event({ type: 'bounced', bounceType: 'permanent' }),
      firestore,
    )
    await recordEmailDeliverySnapshot(
      snapshot({
        providerMessageId: 'msg_1',
        to: 'person@example.com',
        status: 'delivered',
      }),
      firestore,
    )

    expect(firestore.read('person@example.com', 'msg_1')?.status).toBe('bounced')
  })

  it('invents no open or click counts', async () => {
    const firestore = fakeDeliveryFirestore()
    await recordEmailDeliverySnapshot(
      snapshot({ providerMessageId: 'm', to: 'person@example.com', status: 'opened' }),
      firestore,
    )
    await recordEmailDeliverySnapshot(
      snapshot({ providerMessageId: 'm', to: 'person@example.com', status: 'opened' }),
      firestore,
    )

    const stored = firestore.read('person@example.com', 'm')
    // "Opened at least once" is all the provider said. Re-running the import
    // must not turn that into a number that grows.
    expect(stored?.status).toBe('opened')
    expect(stored?.openCount).toBeUndefined()
  })

  it('does not overwrite the send time the event feed already recorded', async () => {
    const firestore = fakeDeliveryFirestore()
    await recordEmailDeliveryEvent(event({ type: 'sent', at: 1_000 }), firestore)
    await recordEmailDeliverySnapshot(
      snapshot({
        providerMessageId: 'msg_1',
        to: 'person@example.com',
        sentAt: 9_999,
      }),
      firestore,
    )

    expect(firestore.read('person@example.com', 'msg_1')?.timestamps?.sent).toBe(
      1_000,
    )
  })

  it('writes nothing for a snapshot it cannot place in time', async () => {
    const firestore = fakeDeliveryFirestore()
    expect(
      await recordEmailDeliverySnapshot(snapshot({ sentAt: 0 }), firestore),
    ).toBe(false)
    expect(firestore.size()).toBe(0)
  })
})

/*==========================================
 * THE PER-PERSON ENGAGEMENT ROLLUP.
 *
 * The two things that make it safe are the two asserted hardest here: it
 * moves only on a FIRST event of its type, which is what makes a replay free,
 * and it only ever moves FORWARD, which is what stops an out-of-order event
 * making an active subscriber look cold to the control that refuses to mail
 * cold people.
 *=========================================*/

/** One outcome, as `recordEmailDeliveryEvent` returns it. */
const outcome = (
  over: Partial<{
    firstOfType: boolean
    providerMessageId: string
    to: string
    type: EmailDeliveryEvent['type']
    at: number
  }> = {},
) => ({
  firstOfType: true,
  providerMessageId: 'msg_1',
  to: 'person@example.com',
  type: 'opened' as EmailDeliveryEvent['type'],
  at: 5_000,
  ...over,
})

describe('recordPersonEngagement', () => {
  it('stamps the person document an open belongs to', async () => {
    const firestore = fakeDeliveryFirestore()
    await recordPersonEngagement([outcome({ at: 5_000 })], firestore)

    expect(firestore.readPerson('person@example.com')).toMatchObject({
      lastOpenedAtMs: 5_000,
      lastEngagedAtMs: 5_000,
    })
  })

  it('keeps opens and clicks apart, and engaged is the later of the two', async () => {
    const firestore = fakeDeliveryFirestore()
    await recordPersonEngagement(
      [
        outcome({ type: 'opened', at: 5_000 }),
        outcome({ type: 'clicked', at: 9_000, providerMessageId: 'msg_2' }),
      ],
      firestore,
    )

    expect(firestore.readPerson('person@example.com')).toMatchObject({
      lastOpenedAtMs: 5_000,
      lastClickedAtMs: 9_000,
      lastEngagedAtMs: 9_000,
    })
  })

  /**
   * ⚠️ THE ASSERTION THE ROLLUP EXISTS UNDER.
   *
   * Delivery is at-least-once and a human can press Replay in the provider's
   * dashboard. The reason a replay is free here is structural rather than
   * lucky: it finds its type already recorded on the message, so
   * `firstOfType` is false and the rollup is never reached.
   */
  it('writes nothing for an event that is not the first of its type', async () => {
    const firestore = fakeDeliveryFirestore()
    await recordPersonEngagement([outcome({ at: 5_000 })], firestore)
    const written = await recordPersonEngagement(
      [outcome({ firstOfType: false, at: 9_000 })],
      firestore,
    )

    expect(written).toBe(0)
    expect(firestore.readPerson('person@example.com')).toMatchObject({
      lastEngagedAtMs: 5_000,
    })
  })

  it('never walks a stamp backwards', async () => {
    const firestore = fakeDeliveryFirestore()
    await recordPersonEngagement([outcome({ at: 9_000 })], firestore)
    // A replay of an event whose first delivery never landed: first of its
    // type on a message we have not seen, and older than what we hold.
    await recordPersonEngagement(
      [outcome({ providerMessageId: 'msg_old', at: 1_000 })],
      firestore,
    )

    expect(firestore.readPerson('person@example.com')).toMatchObject({
      lastOpenedAtMs: 9_000,
      lastEngagedAtMs: 9_000,
    })
  })

  it('spends no write when nothing moved forward', async () => {
    const firestore = fakeDeliveryFirestore()
    await recordPersonEngagement([outcome({ at: 9_000 })], firestore)

    expect(
      await recordPersonEngagement(
        [outcome({ providerMessageId: 'msg_old', at: 1_000 })],
        firestore,
      ),
    ).toBe(0)
  })

  /*
   * `delivered`, `bounced`, `sent` and `delayed` are facts about the MESSAGE,
   * not about whether anybody read it. A rollup that moved on delivery would
   * make every mailed address permanently "engaged" and the sunset inert.
   */
  it.each(['sent', 'delivered', 'bounced', 'complained', 'delayed'] as const)(
    'does not treat %s as engagement',
    async (type) => {
      const firestore = fakeDeliveryFirestore()
      await recordPersonEngagement([outcome({ type, at: 5_000 })], firestore)

      expect(firestore.readPerson('person@example.com')).toBeUndefined()
    },
  )

  it('costs one document write per person, not per event', async () => {
    const firestore = fakeDeliveryFirestore()

    expect(
      await recordPersonEngagement(
        [
          outcome({ type: 'opened', at: 5_000 }),
          outcome({ type: 'clicked', at: 6_000 }),
          outcome({ to: 'other@example.com', at: 7_000 }),
        ],
        firestore,
      ),
    ).toBe(2)
  })

  it('writes nothing for an address that is not an address', async () => {
    const firestore = fakeDeliveryFirestore()

    expect(
      await recordPersonEngagement(
        [outcome({ to: 'not-an-address' })],
        firestore,
      ),
    ).toBe(0)
  })

  /*
   * The whole chain rather than the rollup alone: the outcome that drives it
   * is the one the delivery log actually produces, and a spec that hand-built
   * one would not notice the two drifting apart.
   */
  it('is driven by the delivery log’s own verdict, replay included', async () => {
    const firestore = fakeDeliveryFirestore()
    const first = await recordEmailDeliveryEvent(
      event({ type: 'opened', at: 5_000 }),
      firestore,
    )
    await recordPersonEngagement([first as any], firestore)
    // The same provider event, delivered twice.
    const replay = await recordEmailDeliveryEvent(
      event({ type: 'opened', at: 5_000 }),
      firestore,
    )

    expect(replay).toMatchObject({ firstOfType: false })
    expect(await recordPersonEngagement([replay as any], firestore)).toBe(0)
    expect(firestore.readPerson('person@example.com')).toMatchObject({
      lastEngagedAtMs: 5_000,
    })
    // And the MESSAGE row still counted both opens, which is the honest
    // answer to "how many times was this opened".
    expect(firestore.read('person@example.com', 'msg_1')?.openCount).toBe(2)
  })
})

describe('reading a person’s engagement', () => {
  it('answers with nulls for somebody we hold nothing about', async () => {
    const firestore = fakeDeliveryFirestore()

    expect(
      await readPersonEngagement('stranger@example.com', firestore),
    ).toEqual({
      lastEngagedAtMs: null,
      lastOpenedAtMs: null,
      lastClickedAtMs: null,
    })
  })

  it('answers with nulls for an address that is not an address', async () => {
    const firestore = fakeDeliveryFirestore()

    expect(await readPersonEngagement('nope', firestore)).toMatchObject({
      lastEngagedAtMs: null,
    })
  })

  /*
   * A row written before `lastEngagedAtMs` existed, or by a write that landed
   * half — the derived stamp is recomputed from the two it is derived from
   * rather than read back as absent. Absent would make the person look like
   * somebody who has never engaged, to the one control that refuses to mail
   * people who have never engaged.
   */
  it('derives the engaged stamp from the two beneath it when it is missing', async () => {
    const firestore = fakeDeliveryFirestore()
    await firestore
      .collection('emailDeliveries')
      .doc(emailSuppressionKey('person@example.com') as string)
      .set({ lastOpenedAtMs: 4_000, lastClickedAtMs: 7_000 })

    expect(
      await readPersonEngagement('person@example.com', firestore),
    ).toMatchObject({ lastEngagedAtMs: 7_000 })
  })

  it('returns an entry for every key asked about, present or not', async () => {
    const firestore = fakeDeliveryFirestore()
    await recordPersonEngagement([outcome({ at: 5_000 })], firestore)
    const known = emailSuppressionKey('person@example.com') as string
    const unknown = emailSuppressionKey('stranger@example.com') as string

    const found = await readPersonEngagementByKeys([known, unknown], firestore)
    expect(found.get(known)).toMatchObject({ lastEngagedAtMs: 5_000 })
    // Present, and empty — a caller must never have to tell "absent" from
    // "not read", because those lead to opposite decisions about mailing.
    expect(found.get(unknown)).toMatchObject({ lastEngagedAtMs: null })
  })
})

describe('erasure removes the summary, not only the messages it came from', () => {
  it('clears the engagement stamps it tombstones over', async () => {
    const firestore = fakeDeliveryFirestore()
    await recordEmailDeliveryEvent(
      event({ type: 'opened', at: 5_000 }),
      firestore,
    )
    await recordPersonEngagement([outcome({ at: 5_000 })], firestore)

    await eraseEmailDeliveriesForAddresses(
      [{ address: 'person@example.com' }],
      firestore,
    )

    const person = firestore.readPerson('person@example.com')
    // The tombstone stays — it is the proof the erasure covered this address.
    expect(person).toMatchObject({ erasedCount: 1 })
    // "This person read our mail on the 3rd" is the same personal fact as the
    // row it was derived from. A summary that outlived its source would be an
    // erasure that removed the evidence and kept the conclusion.
    expect(person).not.toHaveProperty('lastEngagedAtMs')
    expect(person).not.toHaveProperty('lastOpenedAtMs')
    expect(person).not.toHaveProperty('lastClickedAtMs')
    expect(
      await readPersonEngagement('person@example.com', firestore),
    ).toMatchObject({ lastEngagedAtMs: null })
  })

  it('clears the campaign touches revenue attribution is taken over', async () => {
    const firestore = fakeDeliveryFirestore()
    await recordEmailCampaignTouch(
      {
        email: 'person@example.com',
        hostId: 'host1',
        campaignId: 'spring',
        atMs: 5_000,
      },
      firestore,
    )
    expect(firestore.readPerson('person@example.com')).toHaveProperty(
      EMAIL_TOUCH_FIELD,
    )

    await eraseEmailDeliveriesForAddresses(
      [{ address: 'person@example.com' }],
      firestore,
    )

    // The strongest personal fact on the document — it names the person AND
    // what they were reading — so it goes with the stamps beside it. Nothing
    // may go on attributing their future orders to mail they asked us to
    // forget.
    expect(firestore.readPerson('person@example.com')).not.toHaveProperty(
      EMAIL_TOUCH_FIELD,
    )
    expect(
      await readEmailCampaignTouch('person@example.com', 'host1', firestore),
    ).toBeNull()
  })

  it('clears the CONVERSIONS those touches were credited with, on every site', async () => {
    const firestore = fakeDeliveryFirestore()
    const key = emailSuppressionKey('person@example.com') as string
    firestore.seedAttribution('host1', 'form:s1', key)
    firestore.seedAttribution('host2', 'lead:l1', key)
    firestore.seedAttribution('host2', 'form:s2', 'somebody-else')

    await eraseEmailDeliveriesForAddresses(
      [{ address: 'person@example.com' }],
      firestore,
    )

    // "This person came from that campaign and then filled in this form" is a
    // strictly stronger statement than the click it was derived from, so
    // deleting the click above and keeping this would be an erasure that
    // removed the evidence and kept the conclusion.
    expect(firestore.attribution('host1', 'form:s1')).toBeUndefined()
    // Per ADDRESS, not per host: the request names an address and knows
    // nothing about which sites it ever visited.
    expect(firestore.attribution('host2', 'lead:l1')).toBeUndefined()
    // And nobody else's.
    expect(firestore.attribution('host2', 'form:s2')).toBeDefined()
  })

  it('leaves a contested address’s conversions exactly where they are', async () => {
    const firestore = fakeDeliveryFirestore()
    const key = emailSuppressionKey('person@example.com') as string
    firestore.seedAttribution('host1', 'form:s1', key)

    await eraseEmailDeliveriesForAddresses(
      [{ address: 'person@example.com', shared: true }],
      firestore,
    )

    // A contested address is not erased at all, and the sweep must not run
    // past the `continue` that decided so — there is no undo below that line.
    expect(firestore.attribution('host1', 'form:s1')).toBeDefined()
  })

  it('leaves a contested address’s engagement exactly where it was', async () => {
    const firestore = fakeDeliveryFirestore()
    await recordPersonEngagement([outcome({ at: 5_000 })], firestore)

    await eraseEmailDeliveriesForAddresses(
      [{ address: 'person@example.com', shared: true }],
      firestore,
    )

    expect(firestore.readPerson('person@example.com')).toMatchObject({
      lastEngagedAtMs: 5_000,
    })
  })
})
