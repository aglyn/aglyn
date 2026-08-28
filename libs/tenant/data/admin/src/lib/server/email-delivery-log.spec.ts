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
import {
  eraseEmailDeliveries,
  importEmailDeliveryHistory,
  readEmailDeliveries,
  readEmailDeliveryHistory,
  recordEmailDeliveryEvent,
  recordEmailDeliverySnapshot,
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

  return {
    collection: (name: string) => collectionRef(name),
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
    /** Spec helper: the raw document, by address and message id. */
    read: (email: string, messageId: string) =>
      store.get(
        `emailDeliveries/${emailSuppressionKey(email)}/messages/${messageId}`,
      ),
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
    ).toBe(false)
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
    ).resolves.toBe(false)
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
