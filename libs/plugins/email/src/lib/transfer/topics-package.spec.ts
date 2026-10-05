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
 *
 * @jest-environment node
 */

/**
 * EMAIL TOPICS IN A WORKSPACE PACKAGE (AGL-3550): the catalog travels as
 * every reader sees it, built-ins included; an import writes the topic's
 * definition and nothing else — no opt-out, no confirmation, nothing under
 * a site; undo puts a replaced topic back and retires one it added.
 */

jest.mock('@aglyn/tenant-data-admin/server/firebase-admin', () => ({ __esModule: true, default: {} }))
jest.mock('firebase-admin/firestore', () => ({ __esModule: true, FieldValue: { delete: () => '__delete' } }))

import { DECLARED_SUBSCRIPTION_TOPICS } from '@aglyn/aglyn/app-utils/subscription-topics'
import type {
  TransferApplyWriter,
  TransferPackageItemWrite,
  TransferResourceContext,
} from '@aglyn/aglyn/plugin-manager/plugin-transfer-resources'
import type { TransferRowResult } from '@aglyn/aglyn/data-transfer'
import {
  EMAIL_TOPIC_PACKAGE_RULES,
  emailTopicDependencies,
  emailTopicPackageContent,
  emailTopicPackageProblems,
  type EmailTopicPackageContent,
} from './topics-package'
import { createEmailTopicsPackage } from './topics-package.server'

const DELETE = '__delete'
let store: Record<string, Record<string, unknown>> = {}

const merged = (path: string, data: Record<string, unknown>, merge: boolean) => {
  const next: Record<string, unknown> = { ...(merge ? store[path] : {}) }
  for (const [key, value] of Object.entries(data)) {
    if (value === DELETE) delete next[key]
    else next[key] = value
  }
  store[path] = next
}

const docRef = (path: string): any => ({
  id: path.slice(path.lastIndexOf('/') + 1),
  path,
  get: async () => ({ exists: store[path] !== undefined, data: () => store[path] }),
  set: async (data: Record<string, unknown>, options?: { merge?: boolean }) => merged(path, data, !!options?.merge),
  delete: async () => void delete store[path],
})

const collectionRef = (path: string): any => ({
  doc: (id: string) => docRef(`${path}/${id}`),
  get: async () => ({
    docs: Object.keys(store)
      .filter((key) => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes('/'))
      .map((key) => ({ id: key.slice(path.length + 1), data: () => store[key] })),
  }),
})

const firestore: any = {
  collection: (name: string) => ({ doc: (id: string) => ({ collection: (sub: string) => collectionRef(`${name}/${id}/${sub}`) }) }),
  runTransaction: async (fn: (transaction: any) => Promise<unknown>) =>
    fn({
      get: (ref: any) => ref.get(),
      set: (ref: any, data: Record<string, unknown>, options?: { merge?: boolean }) => merged(ref.path, data, !!options?.merge),
      create: (ref: any, data: Record<string, unknown>) => {
        if (store[ref.path]) throw new Error('6 ALREADY_EXISTS')
        merged(ref.path, data, false)
      },
    }),
}

const ORG = 'org-1'
const TOPICS = `orgs/${ORG}/emailTopics`
const ctx: TransferResourceContext = { resource: 'email.topics', orgId: ORG, hostId: null, actorUid: 'uid-1' }
const pkg = createEmailTopicsPackage({ firestore: () => firestore, deleteField: () => DELETE })
const BUILT_IN = DECLARED_SUBSCRIPTION_TOPICS[0]

function writer(): TransferApplyWriter & { marked: TransferRowResult[] } {
  const marked: TransferRowResult[] = []
  return {
    marked,
    alreadyApplied: async (row: number) => marked.find((result) => result.row === row) ?? null,
    markApplied: async (result: TransferRowResult) => void marked.push(result),
  } as unknown as TransferApplyWriter & { marked: TransferRowResult[] }
}

function write(
  targetId: string,
  decision: TransferPackageItemWrite['decision'],
  content: Partial<EmailTopicPackageContent>,
  rename?: { name?: string },
): TransferPackageItemWrite<EmailTopicPackageContent> {
  return {
    row: 0,
    item: { kind: 'email.topics', $id: targetId } as never,
    decision,
    targetId,
    ...(rename ? { rename } : {}),
    content: emailTopicPackageContent(content),
  }
}

beforeEach(() => {
  store = {}
})

describe('an email topic as a package item (AGL-3550)', () => {
  it('carries what the topic says, never anything about a person', () => {
    expect(
      emailTopicPackageContent({ name: ' Weekly ', description: 'News', archived: true, doubleOptIn: false, optedOutAt: 1, createdBy: 'x' }),
    ).toEqual({ name: 'Weekly', description: 'News', archived: true, doubleOptIn: false })
    expect(emailTopicPackageContent({ name: 'Weekly' }).doubleOptIn).toBeNull()
    expect(emailTopicDependencies()).toEqual([])
  })

  it('refuses a nameless topic and an id no unsubscribe link could carry', () => {
    expect(emailTopicPackageProblems(emailTopicPackageContent({ name: '' }), 'a:b')).toEqual([
      'Name the topic.',
      'This topic’s id cannot be used in an unsubscribe link.',
    ])
  })

  it('states the rules an import cannot change', () => {
    expect(EMAIL_TOPIC_PACKAGE_RULES.map((rule) => rule.id)).toEqual(['no-subscriptions', 'choices-stay', 'retire'])
  })
})

describe('reading the catalog', () => {
  it('lists the built-ins nobody changed beside the org’s own, and exports them the same', async () => {
    store[`${TOPICS}/custom-1`] = { name: 'Recipes', description: 'Monthly' }
    const items = await pkg.items(ctx)
    expect(items.map((item) => item.id)).toEqual([...DECLARED_SUBSCRIPTION_TOPICS.map((topic) => topic.id), 'custom-1'])
    const [read] = await pkg.readItems(ctx, ['custom-1'])
    expect(read).toEqual({
      kind: 'email.topics',
      id: 'custom-1',
      name: 'Recipes',
      content: { name: 'Recipes', description: 'Monthly', archived: false, doubleOptIn: null },
    })
  })
})

describe('importing', () => {
  it('creates a topic and writes only its definition', async () => {
    const out = writer()
    const result = await pkg.writeItems(ctx, [write('custom-2', 'create', { name: 'Recipes', doubleOptIn: true })], out)
    expect(result.results).toEqual([{ row: 0, outcome: 'created', recordId: 'custom-2' }])
    expect(store).toEqual({ [`${TOPICS}/custom-2`]: { name: 'Recipes', description: '', archived: false, doubleOptIn: true } })
  })

  it('keeps a copy under its new id and name', async () => {
    store[`${TOPICS}/custom-1`] = { name: 'Recipes' }
    await pkg.writeItems(ctx, [write('fresh-id', 'keepBoth', { name: 'Recipes' }, { name: 'Recipes (copy)' })], writer())
    expect(store[`${TOPICS}/fresh-id`]).toMatchObject({ name: 'Recipes (copy)' })
    expect(store[`${TOPICS}/custom-1`]).toEqual({ name: 'Recipes' })
  })

  it('replaces a built-in as an override at its own id, clearing a confirmation the package leaves to the site', async () => {
    store[`${TOPICS}/${BUILT_IN.id}`] = { name: BUILT_IN.name, description: '', archived: false, doubleOptIn: true }
    const result = await pkg.writeItems(ctx, [write(BUILT_IN.id, 'replace', { name: 'Deals' })], writer())
    expect(result.results[0]).toMatchObject({ outcome: 'updated', recordId: BUILT_IN.id })
    expect(store[`${TOPICS}/${BUILT_IN.id}`]).toEqual({ name: 'Deals', description: '', archived: false })
  })

  it('never creates over a built-in or a stored topic, and never writes twice on a retry', async () => {
    const out = writer()
    const first = await pkg.writeItems(ctx, [write(BUILT_IN.id, 'create', { name: 'Again' })], out)
    expect(first.results[0]).toMatchObject({ outcome: 'failed', message: 'A topic with this id already exists.' })
    const retried = await pkg.writeItems(ctx, [write(BUILT_IN.id, 'create', { name: 'Again' })], out)
    expect(retried.results).toEqual(first.results)
    expect(out.marked).toHaveLength(1)
    expect(store).toEqual({})
  })
})

describe('undo', () => {
  it('puts a replaced topic back, a built-in nobody had changed to no document at all', async () => {
    store[`${TOPICS}/custom-1`] = { name: 'Changed', description: '', archived: false }
    store[`${TOPICS}/${BUILT_IN.id}`] = { name: 'Deals', description: '', archived: false }
    const outcome = await pkg.revertItems(ctx, [
      { action: 'restore', id: 'custom-1', content: emailTopicPackageContent({ name: 'Recipes', doubleOptIn: false }) },
      { action: 'restore', id: BUILT_IN.id, content: emailTopicPackageContent(BUILT_IN) },
    ])
    expect(outcome).toEqual({ done: ['custom-1', BUILT_IN.id], refused: [] })
    expect(store).toEqual({ [`${TOPICS}/custom-1`]: { name: 'Recipes', description: '', archived: false, doubleOptIn: false } })
  })

  it('retires a topic the import added rather than deleting it', async () => {
    store[`${TOPICS}/custom-2`] = { name: 'Recipes', description: '', archived: false }
    const outcome = await pkg.revertItems(ctx, [{ action: 'delete', id: 'custom-2' }])
    expect(outcome.done).toEqual(['custom-2'])
    expect(store[`${TOPICS}/custom-2`]).toEqual({ name: 'Recipes', description: '', archived: true })
  })
})
