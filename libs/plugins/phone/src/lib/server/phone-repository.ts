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

import {
  PHONE_COLLECTIONS,
  PHONE_SINGLETON_ID,
  type PhoneAccount,
  type PhoneCall,
  type PhoneCompliance,
  type PhoneMessage,
  type PhoneNumberIndexEntry,
  type PhoneNumberRecord,
  type PhonePortRequest,
  type PhoneSettings,
  type PhoneThread,
} from '../model/phone.types'

/**
 * Everything Phone stores, behind one interface (AGL-4251), so the service is
 * written once against it and the specs run it on {@link createMemoryPhoneRepository}.
 * The Firestore implementation is the only code that names a path.
 */
export interface PhoneRepository {
  getAccount(orgId: string): Promise<PhoneAccount | null>
  putAccount(orgId: string, account: PhoneAccount): Promise<void>
  /** The org a subaccount belongs to, for a webhook that names only the subaccount. */
  orgForSubaccount(subaccountSid: string): Promise<string | null>

  listNumbers(orgId: string): Promise<PhoneNumberRecord[]>
  getNumber(orgId: string, numberId: string): Promise<PhoneNumberRecord | null>
  putNumber(orgId: string, number: PhoneNumberRecord): Promise<void>
  getNumberIndex(e164: string): Promise<PhoneNumberIndexEntry | null>
  putNumberIndex(e164: string, entry: PhoneNumberIndexEntry): Promise<void>
  deleteNumberIndex(e164: string): Promise<void>

  getSettings(orgId: string): Promise<PhoneSettings | null>
  putSettings(orgId: string, settings: PhoneSettings): Promise<void>
  getCompliance(orgId: string): Promise<PhoneCompliance | null>
  putCompliance(orgId: string, compliance: PhoneCompliance): Promise<void>

  listThreads(orgId: string, options: { limit: number; archived?: boolean; beforeMs?: number | null }): Promise<PhoneThread[]>
  getThread(orgId: string, threadId: string): Promise<PhoneThread | null>
  putThread(orgId: string, thread: PhoneThread): Promise<void>
  /** Newest last. */
  listMessages(orgId: string, threadId: string, limit: number): Promise<PhoneMessage[]>
  getMessage(orgId: string, threadId: string, messageId: string): Promise<PhoneMessage | null>
  putMessage(orgId: string, message: PhoneMessage): Promise<void>

  listCalls(orgId: string, options: { limit: number; theirs?: string | null }): Promise<PhoneCall[]>
  getCall(orgId: string, callId: string): Promise<PhoneCall | null>
  putCall(orgId: string, call: PhoneCall): Promise<void>

  listPorts(orgId: string): Promise<PhonePortRequest[]>
  putPort(orgId: string, port: PhonePortRequest): Promise<void>

  /** Adds to a site's monthly usage counter (`hosts/{hostId}/counters/{counter}`, field `month`). */
  incrementUsage(hostId: string, counter: string, month: string, by: number): Promise<void>
}

/** The Firestore surface the implementation needs: firebase-admin's, narrowed. */
export interface PhoneFirestore {
  collection(path: string): FirestoreCollection
  doc(path: string): FirestoreDoc
}
interface FirestoreDoc {
  get(): Promise<{ exists: boolean; data(): Record<string, unknown> | undefined }>
  set(data: Record<string, unknown>, options?: { merge?: boolean }): Promise<unknown>
  delete(): Promise<unknown>
}
interface FirestoreQuery {
  where(field: string, op: '==' | '<' | '>' | '<=' | '>=', value: unknown): FirestoreQuery
  orderBy(field: string, direction?: 'asc' | 'desc'): FirestoreQuery
  limit(n: number): FirestoreQuery
  get(): Promise<{ docs: Array<{ data(): Record<string, unknown> }> }>
}
interface FirestoreCollection extends FirestoreQuery {
  doc(id: string): FirestoreDoc
}

function strip<T extends object>(value: T): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>
}

export function createFirestorePhoneRepository(
  firestore: () => PhoneFirestore,
  increment: (by: number) => unknown,
): PhoneRepository {
  const org = (orgId: string) => `orgs/${orgId}`
  const read = async <T>(path: string): Promise<T | null> => {
    const snapshot = await firestore().doc(path).get()
    return snapshot.exists ? ((snapshot.data() ?? null) as T | null) : null
  }
  const write = (path: string, value: object) => firestore().doc(path).set(strip(value)).then(() => undefined)
  const all = async <T>(query: FirestoreQuery): Promise<T[]> =>
    (await query.get()).docs.map((doc) => doc.data() as T)
  const c = PHONE_COLLECTIONS
  return {
    getAccount: (orgId) => read(`${org(orgId)}/${c.account}/${PHONE_SINGLETON_ID}`),
    async putAccount(orgId, account) {
      await write(`${org(orgId)}/${c.account}/${PHONE_SINGLETON_ID}`, account)
      await write(`${c.subaccountIndex}/${account.subaccountSid}`, { orgId })
    },
    async orgForSubaccount(sid) {
      const entry = await read<{ orgId?: string }>(`${c.subaccountIndex}/${sid}`)
      return entry?.orgId ?? null
    },
    listNumbers: (orgId) => all(firestore().collection(`${org(orgId)}/${c.numbers}`).limit(20)),
    getNumber: (orgId, id) => read(`${org(orgId)}/${c.numbers}/${id}`),
    putNumber: (orgId, number) => write(`${org(orgId)}/${c.numbers}/${number.id}`, number),
    getNumberIndex: (e164) => read(`${c.numberIndex}/${e164}`),
    putNumberIndex: (e164, entry) => write(`${c.numberIndex}/${e164}`, entry),
    deleteNumberIndex: (e164) => firestore().doc(`${c.numberIndex}/${e164}`).delete().then(() => undefined),
    getSettings: (orgId) => read(`${org(orgId)}/${c.settings}/${PHONE_SINGLETON_ID}`),
    putSettings: (orgId, settings) => write(`${org(orgId)}/${c.settings}/${PHONE_SINGLETON_ID}`, settings),
    getCompliance: (orgId) => read(`${org(orgId)}/${c.compliance}/${PHONE_SINGLETON_ID}`),
    putCompliance: (orgId, compliance) => write(`${org(orgId)}/${c.compliance}/${PHONE_SINGLETON_ID}`, compliance),
    async listThreads(orgId, options) {
      let query: FirestoreQuery = firestore()
        .collection(`${org(orgId)}/${c.threads}`)
        .where('archived', '==', options.archived === true)
      if (options.beforeMs) query = query.where('lastMessageAtMs', '<', options.beforeMs)
      return all(query.orderBy('lastMessageAtMs', 'desc').limit(options.limit))
    },
    getThread: (orgId, id) => read(`${org(orgId)}/${c.threads}/${id}`),
    putThread: (orgId, thread) =>
      write(`${org(orgId)}/${c.threads}/${thread.id}`, { ...thread, archived: thread.archived === true }),
    async listMessages(orgId, threadId, limit) {
      const newestFirst = await all<PhoneMessage>(
        firestore().collection(`${org(orgId)}/${c.threads}/${threadId}/${c.messages}`).orderBy('atMs', 'desc').limit(limit),
      )
      return newestFirst.reverse()
    },
    getMessage: (orgId, threadId, id) => read(`${org(orgId)}/${c.threads}/${threadId}/${c.messages}/${id}`),
    putMessage: (orgId, message) =>
      write(`${org(orgId)}/${c.threads}/${message.threadId}/${c.messages}/${message.id}`, message),
    async listCalls(orgId, options) {
      let query: FirestoreQuery = firestore().collection(`${org(orgId)}/${c.calls}`)
      if (options.theirs) query = query.where('theirs', '==', options.theirs)
      return all(query.orderBy('startedAtMs', 'desc').limit(options.limit))
    },
    getCall: (orgId, id) => read(`${org(orgId)}/${c.calls}/${id}`),
    putCall: (orgId, call) => write(`${org(orgId)}/${c.calls}/${call.id}`, call),
    listPorts: (orgId) => all(firestore().collection(`${org(orgId)}/${c.ports}`).orderBy('createdAtMs', 'desc').limit(20)),
    putPort: (orgId, port) => write(`${org(orgId)}/${c.ports}/${port.id}`, port),
    async incrementUsage(hostId, counter, month, by) {
      await firestore().doc(`hosts/${hostId}/counters/${counter}`).set({ [month]: increment(by) }, { merge: true })
    },
  }
}

/** The in-memory twin, for specs. `usage` is readable to assert on. */
export function createMemoryPhoneRepository(): PhoneRepository & {
  usage: Record<string, number>
  dump(): Record<string, unknown>
} {
  const docs = new Map<string, unknown>()
  const usage: Record<string, number> = {}
  const clone = <T>(value: T): T => (value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T))
  const get = async <T>(key: string) => (docs.has(key) ? clone(docs.get(key) as T) : null)
  const set = async (key: string, value: unknown) => {
    docs.set(key, clone(value))
  }
  const under = <T>(prefix: string): T[] =>
    [...docs.entries()]
      .filter(([key]) => key.startsWith(prefix) && !key.slice(prefix.length).includes('/'))
      .map(([, value]) => clone(value as T))
  return {
    usage,
    dump: () => Object.fromEntries(docs),
    getAccount: (orgId) => get(`account/${orgId}`),
    async putAccount(orgId, account) {
      await set(`account/${orgId}`, account)
      await set(`subaccount/${account.subaccountSid}`, orgId)
    },
    orgForSubaccount: (sid) => get<string>(`subaccount/${sid}`),
    listNumbers: async (orgId) => under<PhoneNumberRecord>(`numbers/${orgId}/`),
    getNumber: (orgId, id) => get(`numbers/${orgId}/${id}`),
    putNumber: (orgId, number) => set(`numbers/${orgId}/${number.id}`, number),
    getNumberIndex: (e164) => get(`index/${e164}`),
    putNumberIndex: (e164, entry) => set(`index/${e164}`, entry),
    deleteNumberIndex: async (e164) => {
      docs.delete(`index/${e164}`)
    },
    getSettings: (orgId) => get(`settings/${orgId}`),
    putSettings: (orgId, settings) => set(`settings/${orgId}`, settings),
    getCompliance: (orgId) => get(`compliance/${orgId}`),
    putCompliance: (orgId, compliance) => set(`compliance/${orgId}`, compliance),
    listThreads: async (orgId, options) =>
      under<PhoneThread>(`threads/${orgId}/`)
        .filter((thread) => (thread.archived === true) === (options.archived === true))
        .filter((thread) => !options.beforeMs || thread.lastMessageAtMs < options.beforeMs)
        .sort((a, b) => b.lastMessageAtMs - a.lastMessageAtMs)
        .slice(0, options.limit),
    getThread: (orgId, id) => get(`threads/${orgId}/${id}`),
    putThread: (orgId, thread) => set(`threads/${orgId}/${thread.id}`, thread),
    listMessages: async (orgId, threadId, limit) =>
      under<PhoneMessage>(`messages/${orgId}/${threadId}/`)
        .sort((a, b) => a.atMs - b.atMs)
        .slice(-limit),
    getMessage: (orgId, threadId, id) => get(`messages/${orgId}/${threadId}/${id}`),
    putMessage: (orgId, message) => set(`messages/${orgId}/${message.threadId}/${message.id}`, message),
    listCalls: async (orgId, options) =>
      under<PhoneCall>(`calls/${orgId}/`)
        .filter((call) => !options.theirs || call.theirs === options.theirs)
        .sort((a, b) => b.startedAtMs - a.startedAtMs)
        .slice(0, options.limit),
    getCall: (orgId, id) => get(`calls/${orgId}/${id}`),
    putCall: (orgId, call) => set(`calls/${orgId}/${call.id}`, call),
    listPorts: async (orgId) => under<PhonePortRequest>(`ports/${orgId}/`),
    putPort: (orgId, port) => set(`ports/${orgId}/${port.id}`, port),
    async incrementUsage(hostId, counter, month, by) {
      const key = `${hostId}/${counter}/${month}`
      usage[key] = (usage[key] ?? 0) + by
    },
  }
}
