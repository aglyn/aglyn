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
 * EVERY ADDRESS AN ACCOUNT HOLDS, and what the address-keyed stores do with
 * them.
 *
 * ## These assert on DOCUMENTS, not on rendered output
 *
 * The bugs here are all "which document did we read / destroy": a changed
 * primary read an empty document under a new hash while the real history sat
 * under the old one, and erasure swept one hash out of several. A spec that
 * asserted on a card's rows could pass while reading the wrong document, so
 * every assertion below names a path in the fake store.
 *
 * ## Every fixture reaches the code under test
 *
 * Written after four tests were found passing because their fixtures never
 * did. The delivery-log documents here are created THROUGH
 * `recordEmailDeliveryEvent`, so a message that the reader cannot find is a
 * message the writer never wrote — rather than a hand-built document at a
 * path the code does not use, which passes an "erased everything" assertion
 * by having had nothing to erase.
 *
 * ⛔ Every address below is synthetic.
 */

import {
  eraseEmailDeliveriesForAddresses,
  readEmailDeliveryHistoryForAddresses,
  recordEmailDeliveryEvent,
} from './email-delivery-log'
import { FieldValue } from 'firebase-admin/firestore'
import { emailSuppressionKey } from './email-suppression'
import { resolveAccountAddresses } from './account-addresses'

jest.mock('./firebase-admin', () => ({
  __esModule: true,
  default: { app: () => ({ firestore: () => undefined }) },
  firebaseAdmin: { app: () => ({ firestore: () => undefined }) },
}))

const mockFindAccountByVerifiedAlias = jest.fn()
jest.mock('./account-emails', () => ({
  __esModule: true,
  ACCOUNT_EMAILS_SUBCOLLECTION: 'emails',
  EMAIL_IDENTITY_INDEX_COLLECTION: 'emailIdentityIndex',
  findAccountByVerifiedAlias: (address: unknown) =>
    mockFindAccountByVerifiedAlias(address),
}))

const mockFindUserByEmailAcrossPools = jest.fn()
jest.mock('./auth-pools', () => ({
  __esModule: true,
  findUserByEmailAcrossPools: (address: unknown) =>
    mockFindUserByEmailAcrossPools(address),
}))

/*==========================================
 * The same local double `email-delivery-log.spec.ts` uses, plus the two
 * things this file needs that it does not: `users/{uid}/emails` documents,
 * and a way to ask what is left at a path AFTER an erasure.
 *
 * Not the shared `test-firestore` fake, for the reason recorded in that
 * file's header: it models neither subcollections nor `runTransaction`, both
 * of which are load-bearing in the code under test.
 *=========================================*/

function applyWrite(
  target: Record<string, any>,
  update: Record<string, any>,
): Record<string, any> {
  const next = { ...target }
  for (const [key, value] of Object.entries(update)) {
    if (value && typeof value === 'object' && 'operand' in (value as any)) {
      next[key] = Number(next[key] ?? 0) + Number((value as any).operand)
      continue
    }
    // `FieldValue.delete()` — asked before the timestamp branch below, which
    // matches every sentinel and would otherwise store a deletion as a
    // written field. Real Firestore honors it inside `set({merge:true})`, and
    // this file's tombstone assertion is precisely that the fields an erasure
    // destroyed do not survive on the tombstone — a double that kept them
    // would report the erasure as incomplete when it was not.
    if (
      value &&
      typeof value === 'object' &&
      typeof (value as any).isEqual === 'function' &&
      FieldValue.delete().isEqual(value as any)
    ) {
      delete next[key]
      continue
    }
    if (
      value &&
      typeof value === 'object' &&
      typeof (value as any).isEqual === 'function' &&
      !('operand' in (value as any))
    ) {
      next[key] = { serverTimestamp: true }
      continue
    }
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
    next[key] = value
  }
  return next
}

function fakeFirestore() {
  const store = new Map<string, Record<string, any>>()

  const docRef = (path: string): any => ({
    path,
    id: path.split('/').pop() as string,
    get: async () => ({
      exists: store.has(path),
      id: path.split('/').pop(),
      data: () => store.get(path),
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
        let entries = [...store.entries()]
          .filter(([path]) => {
            const rest = path.slice(prefix.length + 1)
            return path.startsWith(`${prefix}/`) && !rest.includes('/')
          })
          .map(([path, data]) => ({ path, data }))
        if (order) {
          const { field, dir } = order
          // Real `orderBy` DROPS documents lacking the field.
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
            get: (field: string) => entry.data[field],
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
    /** Spec helper: message ids currently stored under an address. */
    messagesFor: (address: string) => {
      const prefix = `emailDeliveries/${emailSuppressionKey(address)}/messages/`
      return [...store.keys()]
        .filter((path) => path.startsWith(prefix))
        .map((path) => path.slice(prefix.length))
        .sort()
    },
    /** Spec helper: the parent document, where a tombstone lands. */
    tombstoneFor: (address: string) =>
      store.get(`emailDeliveries/${emailSuppressionKey(address)}`),
    seed: (path: string, data: Record<string, any>) => store.set(path, data),
  }
}

/** Writes one delivery row THROUGH the real writer. */
async function sendTo(
  firestore: any,
  to: string,
  messageId: string,
  at = 1_000,
): Promise<void> {
  const written = await recordEmailDeliveryEvent(
    {
      type: 'sent',
      at,
      provider: 'resend',
      providerMessageId: messageId,
      to,
      subject: 'Your receipt',
      context: 'receipt',
      tags: {},
      link: null,
      bounceType: null,
      detail: null,
    },
    firestore,
  )
  // The fixture must reach the code under test. A silently unwritten row is
  // how an erasure spec passes by erasing nothing.
  if (!written) throw new Error(`fixture not written for ${messageId}`)
}

beforeEach(() => {
  mockFindAccountByVerifiedAlias.mockReset().mockResolvedValue(null)
  mockFindUserByEmailAcrossPools.mockReset().mockResolvedValue(null)
})

describe('resolveAccountAddresses', () => {
  it('finds the primary, a provider address and a retained former primary', async () => {
    const firestore = fakeFirestore()
    firestore.seed('users/uid_1/emails/old@example.test', {
      address: 'old@example.test',
      verified: false,
      primary: false,
    })

    const set = await resolveAccountAddresses({
      uid: 'uid_1',
      record: {
        email: 'new@example.test',
        providerData: [{ email: 'work@example.test' }],
      },
      firestore,
    })

    expect(set.primary).toBe('new@example.test')
    // Primary FIRST — the card leads with the address staff recognize.
    expect(set.addresses.map((entry) => entry.address)).toEqual([
      'new@example.test',
      'old@example.test',
      'work@example.test',
    ])
    expect(set.incomplete).toBe(false)
  })

  it('records WHY each address is listed', async () => {
    const firestore = fakeFirestore()
    firestore.seed('users/uid_1/emails/both@example.test', {
      address: 'both@example.test',
    })
    const set = await resolveAccountAddresses({
      uid: 'uid_1',
      record: {
        email: 'primary@example.test',
        providerData: [{ email: 'both@example.test' }],
      },
      firestore,
    })
    const both = set.addresses.find(
      (entry) => entry.address === 'both@example.test',
    )
    // One address, two sources — a card saying "provider" alone would imply
    // it is not also stored.
    expect(both?.sources.sort()).toEqual(['provider', 'stored'])
  })

  it('reports INCOMPLETE when the stored addresses cannot be read', async () => {
    const firestore = fakeFirestore()
    jest
      .spyOn(firestore, 'collection')
      .mockImplementation(() => {
        throw new Error('firestore down')
      })

    const set = await resolveAccountAddresses({
      uid: 'uid_1',
      record: { email: 'primary@example.test' },
      firestore,
    })

    // The primary still resolves — it came off the Auth record, not the store
    // — but the caller must be told the list may be short. Erasure turns on
    // exactly this flag.
    expect(set.addresses.map((entry) => entry.address)).toEqual([
      'primary@example.test',
    ])
    expect(set.incomplete).toBe(true)
  })

  it('marks an address another account holds as SHARED', async () => {
    const firestore = fakeFirestore()
    // The live shape, synthetically: this account's provider address is
    // somebody else's primary.
    mockFindUserByEmailAcrossPools.mockImplementation(async (address: string) =>
      address === 'shared@example.test'
        ? { record: { uid: 'uid_other' }, tenantId: null }
        : null,
    )

    const set = await resolveAccountAddresses({
      uid: 'uid_1',
      record: {
        email: 'primary@example.test',
        providerData: [{ email: 'shared@example.test' }],
      },
      detectShared: true,
      firestore,
    })

    expect(
      set.addresses.find((entry) => entry.address === 'shared@example.test')
        ?.shared,
    ).toBe(true)
    // CONTROL: the account's own primary resolving to ITSELF is not sharing.
    expect(
      set.addresses.find((entry) => entry.address === 'primary@example.test')
        ?.shared,
    ).toBe(false)
  })

  it('surfaces a refused provider claim as a conflict', async () => {
    const firestore = fakeFirestore()
    firestore.seed('users/uid_1/emails/contested@example.test', {
      address: 'contested@example.test',
      verified: false,
      indexConflict: true,
    })
    const set = await resolveAccountAddresses({
      uid: 'uid_1',
      record: { email: 'primary@example.test' },
      firestore,
    })
    expect(
      set.addresses.find(
        (entry) => entry.address === 'contested@example.test',
      )?.indexConflict,
    ).toBe(true)
  })
})

describe('the history survives an email change', () => {
  it('returns mail sent to the address the account was moved OFF', async () => {
    const firestore = fakeFirestore()
    await sendTo(firestore, 'old@example.test', 'msg_old', 1_000)
    await sendTo(firestore, 'new@example.test', 'msg_new', 2_000)

    // The account was moved to `new@`, and `old@` was retained as a row.
    firestore.seed('users/uid_1/emails/old@example.test', {
      address: 'old@example.test',
    })
    const set = await resolveAccountAddresses({
      uid: 'uid_1',
      record: { email: 'new@example.test' },
      firestore,
    })

    const history = await readEmailDeliveryHistoryForAddresses(
      set.addresses.map((entry) => entry.address),
      { firestore },
    )

    // THE ASSERTION THAT BITES: before the fix this was ['msg_new'] alone,
    // because only the current primary's hash was ever read.
    expect(history.rows.map((row) => row.messageId).sort()).toEqual([
      'msg_new',
      'msg_old',
    ])
    // Newest first across BOTH addresses, not concatenated per address.
    expect(history.rows[0].messageId).toBe('msg_new')
    expect(history.addressesRead).toEqual([
      'new@example.test',
      'old@example.test',
    ])
    expect(history.lookupFailed).toBe(false)
  })

  it('CONTROL: a single-address account reads exactly what it always did', async () => {
    const firestore = fakeFirestore()
    await sendTo(firestore, 'only@example.test', 'msg_only')

    const set = await resolveAccountAddresses({
      uid: 'uid_1',
      record: { email: 'only@example.test' },
      firestore,
    })

    const history = await readEmailDeliveryHistoryForAddresses(
      set.addresses.map((entry) => entry.address),
      { firestore },
    )
    expect(history.rows.map((row) => row.messageId)).toEqual(['msg_only'])
    expect(history.addressesRead).toEqual(['only@example.test'])
  })

  it('surfaces mail to a SECONDARY provider address', async () => {
    const firestore = fakeFirestore()
    await sendTo(firestore, 'work@example.test', 'msg_work')

    const set = await resolveAccountAddresses({
      uid: 'uid_1',
      record: {
        email: 'personal@example.test',
        providerData: [{ email: 'work@example.test' }],
      },
      firestore,
    })
    const history = await readEmailDeliveryHistoryForAddresses(
      set.addresses.map((entry) => entry.address),
      { firestore },
    )
    expect(history.rows.map((row) => row.messageId)).toEqual(['msg_work'])
  })
})

describe('erasure reaches every address', () => {
  it('destroys the messages under a former AND a provider address', async () => {
    const firestore = fakeFirestore()
    await sendTo(firestore, 'primary@example.test', 'msg_primary')
    await sendTo(firestore, 'former@example.test', 'msg_former')
    await sendTo(firestore, 'work@example.test', 'msg_work')

    // Proof the fixtures reached the store — an erasure spec that passes
    // because there was nothing to erase is the exact failure being guarded.
    expect(firestore.messagesFor('primary@example.test')).toEqual(['msg_primary'])
    expect(firestore.messagesFor('former@example.test')).toEqual(['msg_former'])
    expect(firestore.messagesFor('work@example.test')).toEqual(['msg_work'])

    firestore.seed('users/uid_1/emails/former@example.test', {
      address: 'former@example.test',
    })
    const set = await resolveAccountAddresses({
      uid: 'uid_1',
      record: {
        email: 'primary@example.test',
        providerData: [{ email: 'work@example.test' }],
      },
      firestore,
    })
    const result = await eraseEmailDeliveriesForAddresses(
      set.addresses,
      firestore,
    )

    // THE ASSERTION THAT BITES: erasure passed only `record.email`, so
    // `former@` and `work@` kept their full history — recipient address,
    // subject and timings — after the request was reported complete.
    expect(firestore.messagesFor('primary@example.test')).toEqual([])
    expect(firestore.messagesFor('former@example.test')).toEqual([])
    expect(firestore.messagesFor('work@example.test')).toEqual([])
    expect(result.removed).toBe(3)
    expect(result.addresses.sort()).toEqual([
      'former@example.test',
      'primary@example.test',
      'work@example.test',
    ])
  })

  it('CONTROL: erases nothing belonging to an address the account does not hold', async () => {
    const firestore = fakeFirestore()
    await sendTo(firestore, 'mine@example.test', 'msg_mine')
    await sendTo(firestore, 'stranger@example.test', 'msg_stranger')

    const set = await resolveAccountAddresses({
      uid: 'uid_1',
      record: { email: 'mine@example.test' },
      firestore,
    })
    await eraseEmailDeliveriesForAddresses(set.addresses, firestore)

    expect(firestore.messagesFor('mine@example.test')).toEqual([])
    // An erasure request for one account authorizes nothing against another's.
    expect(firestore.messagesFor('stranger@example.test')).toEqual([
      'msg_stranger',
    ])
    expect(firestore.tombstoneFor('stranger@example.test')).toBeUndefined()
  })
})

/*==========================================
 * THE SHARED-ADDRESS RULE.
 *
 * The delivery log is keyed by ADDRESS, so an address two accounts hold has
 * ONE set of rows standing as two people's answer to "what did you send me".
 * Erasing them honours one request and destroys a second person's history for
 * an address they legitimately hold.
 *
 * Nothing readable here separates the two shapes it could be — one human with
 * two accounts (the ordinary live case: a provider address that is another
 * account's primary) or a role mailbox two people share. The data records
 * that two account records name one address, and nothing about the humans. So
 * the sweep does not choose: it erases what it can decide about, reports the
 * rest as CONTESTED, and `eraseUser` refuses the whole run on that.
 *=========================================*/

describe('the shared-address rule', () => {
  /** Held by this account through a provider, and by another as its primary. */
  const heldByAnotherAccount = () =>
    mockFindUserByEmailAcrossPools.mockImplementation(async (address: string) =>
      address === 'shared@example.test'
        ? { record: { uid: 'uid_other' }, tenantId: null }
        : null,
    )

  it('leaves a two-holder address intact rather than erasing the other account’s mail', async () => {
    const firestore = fakeFirestore()
    await sendTo(firestore, 'shared@example.test', 'msg_shared')
    await sendTo(firestore, 'primary@example.test', 'msg_primary')
    heldByAnotherAccount()

    const set = await resolveAccountAddresses({
      uid: 'uid_1',
      record: {
        email: 'primary@example.test',
        providerData: [{ email: 'shared@example.test' }],
      },
      detectShared: true,
      firestore,
    })
    const result = await eraseEmailDeliveriesForAddresses(
      set.addresses,
      firestore,
    )

    // THE ASSERTION THAT BITES: destroying the second holder's mail is the
    // one outcome here with no remedy, and an erasure request against this
    // account never authorized it.
    expect(firestore.messagesFor('shared@example.test')).toEqual(['msg_shared'])
    expect(result.contestedAddresses).toEqual(['shared@example.test'])

    // The account's OWN address still goes. A contested address must not turn
    // the sweep into a no-op, which would be the other failure: mail left
    // behind under an erasure reported complete.
    expect(firestore.messagesFor('primary@example.test')).toEqual([])
    expect(result.addresses).toEqual(['primary@example.test'])
    expect(result.removed).toBe(1)
  })

  it('writes no tombstone over rows it left in place', async () => {
    const firestore = fakeFirestore()
    await sendTo(firestore, 'shared@example.test', 'msg_shared')
    heldByAnotherAccount()

    const set = await resolveAccountAddresses({
      uid: 'uid_1',
      record: { email: 'shared@example.test' },
      detectShared: true,
      firestore,
    })
    await eraseEmailDeliveriesForAddresses(set.addresses, firestore)

    // A tombstone means "the records here were removed under an erasure
    // request". Over rows still present it is confidently wrong, which is
    // worse than the blank table it exists to prevent: it would tell the
    // second holder their mail is gone while it sits underneath.
    expect(firestore.tombstoneFor('shared@example.test')).toBeUndefined()
  })

  it('leaves the other holder’s card reading their real mail, not a blank table', async () => {
    const firestore = fakeFirestore()
    await sendTo(firestore, 'shared@example.test', 'msg_shared')

    await eraseEmailDeliveriesForAddresses(
      [{ address: 'shared@example.test', shared: true }],
      firestore,
    )

    // Read the way the staff route reads it. Three states render as an empty
    // table and are kept apart; this must be none of them.
    const history = await readEmailDeliveryHistoryForAddresses(
      ['shared@example.test'],
      { firestore },
    )
    expect(history.rows.map((row) => row.messageId)).toEqual(['msg_shared'])
    expect(history.lookupFailed).toBe(false)
    expect(history.erasures['shared@example.test']).toBeUndefined()
  })

  it('still tombstones a single-holder address, so its reader is never blank', async () => {
    // The tombstone mechanism is unchanged for every address that IS erased —
    // including ones merely BELIEVED unshared, since `shared: false` is only
    // ever the absence of evidence.
    const firestore = fakeFirestore()
    await sendTo(firestore, 'solo@example.test', 'msg_solo')

    const set = await resolveAccountAddresses({
      uid: 'uid_1',
      record: { email: 'solo@example.test' },
      detectShared: true,
      firestore,
    })
    await eraseEmailDeliveriesForAddresses(set.addresses, firestore)

    expect(firestore.messagesFor('solo@example.test')).toEqual([])
    const tombstone = firestore.tombstoneFor('solo@example.test')
    expect(tombstone?.erasedCount).toBe(1)
    expect(typeof tombstone?.erasedAtMs).toBe('number')
    // ⚠️ The tombstone must not retain what the erasure destroyed.
    expect(Object.keys(tombstone ?? {}).sort()).toEqual([
      'erasedAtMs',
      'erasedCount',
      'updatedAt',
    ])

    const history = await readEmailDeliveryHistoryForAddresses(
      ['solo@example.test'],
      { firestore },
    )
    expect(history.rows).toEqual([])
    expect(history.erasures['solo@example.test']?.count).toBe(1)
  })

  it('CONTROL: an untouched address carries no tombstone', async () => {
    const firestore = fakeFirestore()
    await sendTo(firestore, 'quiet@example.test', 'msg_quiet')
    const history = await readEmailDeliveryHistoryForAddresses(
      ['quiet@example.test'],
      { firestore },
    )
    expect(history.rows.map((row) => row.messageId)).toEqual(['msg_quiet'])
    expect(history.erasures).toEqual({})
  })
})
