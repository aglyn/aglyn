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
 * A REMOVED CONTAINER COMES OFF THE CRM'S RECORDS, AND THE RECORDS STAY.
 *
 * The plugin that keeps a container — Marketing, for a campaign — removes it
 * by asking every plugin's membership detacher, once per site, with the
 * container's id and its membership field. This is the CRM's: a lead carries
 * the field at the top of its document, on the organization and on the site,
 * and a contact inside the site's consent group's facet. Every assertion is
 * about a record SURVIVING with one container fewer.
 */

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: {
    arrayRemove: (...values: unknown[]) => ({ __sentinel: 'arrayRemove', values }),
  },
}))
// The platform's own wiring, which this spec replaces with its double.
jest.mock('@aglyn/tenant-data-admin/server/firebase-admin', () => ({ __esModule: true, default: {} }))
jest.mock('@aglyn/tenant-data-admin/server/organizations', () => ({ consentGroupForSite: jest.fn() }))
jest.mock('@aglyn/tenant-data-admin/server/crm-records', () => ({ restampCrmListFieldsOf: jest.fn() }))

import { containerMembershipField } from '@aglyn/aglyn/app-utils/container-membership'
import { createCrmContainerDetacher } from './container-detach'

const HOST = 'site-1'
const ORG = 'org-1'
const CAMPAIGN = 'spring-2026'
const OTHER = 'autumn-2026'
const FIELD = containerMembershipField('campaign')

type Doc = Record<string, any>

/** The value at a dotted path. */
const at = (doc: Doc, path: string): unknown =>
  path.split('.').reduce<any>((node, key) => node?.[key], doc)

function harness(seed: Record<string, Doc>, groupOf: (hostId: string) => string = (hostId) => hostId) {
  const store = new Map<string, Doc>(Object.entries(seed).map(([path, doc]) => [path, JSON.parse(JSON.stringify(doc)) as Doc]))
  const restamped: string[] = []
  const ref = (path: string) => ({ path })
  const collection = (path: string): any => ({
    firestore,
    doc: (id: string) => ({ collection: (name: string) => collection(`${path}/${id}/${name}`) }),
    where: (fieldPath: string, _op: string, value: unknown) => ({
      limit: (n: number) => ({
        get: async () => {
          const docs = [...store.entries()]
            .filter(([key]) => key.startsWith(`${path}/`) && key.split('/').length === path.split('/').length + 1)
            .filter(([, doc]) => {
              const held = at(doc, fieldPath)
              return Array.isArray(held) && held.includes(value)
            })
            .slice(0, n)
            .map(([key]) => ({ ref: ref(key) }))
          return { empty: docs.length === 0, size: docs.length, docs }
        },
      }),
    }),
  })
  const firestore: any = {
    collection: (name: string) => collection(name),
    batch: () => {
      const writes: Array<() => void> = []
      return {
        update: (target: { path: string }, patch: Record<string, any>) => {
          writes.push(() => {
            const doc = store.get(target.path) ?? {}
            for (const [fieldPath, value] of Object.entries(patch)) {
              const keys = fieldPath.split('.')
              const leaf = keys.pop() as string
              const node = keys.reduce<any>((parent, key) => (parent[key] ??= {}), doc)
              node[leaf] = (node[leaf] ?? []).filter((entry: unknown) => !value.values.includes(entry))
            }
            store.set(target.path, doc)
          })
        },
        commit: async () => writes.forEach((write) => write()),
      }
    },
  }
  const detach = createCrmContainerDetacher({
    firestore: () => firestore,
    consentGroupId: async (hostId) => groupOf(hostId),
    restampLeads: async (refs) => {
      restamped.push(...refs.map((one) => one.path))
    },
  })
  return { store, restamped, detach }
}

describe('the CRM’s membership detacher', () => {
  it('clears the container off a lead on the org and on the site, leaving the lead and its other containers', async () => {
    const { store, restamped, detach } = harness({
      [`orgs/${ORG}/leads/org-lead`]: { name: 'Org lead', [FIELD]: [CAMPAIGN, OTHER] },
      [`hosts/${HOST}/leads/site-lead`]: { name: 'Site lead', [FIELD]: [CAMPAIGN] },
      [`orgs/${ORG}/leads/unrelated`]: { name: 'Unrelated', [FIELD]: [OTHER] },
    })

    const report = await detach({ hostId: HOST, orgId: ORG, field: FIELD, id: CAMPAIGN })

    expect(report).toEqual({ detached: 2, remaining: false })
    expect(store.get(`orgs/${ORG}/leads/org-lead`)).toEqual({ name: 'Org lead', [FIELD]: [OTHER] })
    expect(store.get(`hosts/${HOST}/leads/site-lead`)).toEqual({ name: 'Site lead', [FIELD]: [] })
    expect(store.get(`orgs/${ORG}/leads/unrelated`)?.[FIELD]).toEqual([OTHER])
    // The Leads list's container filter reads the restamped fields.
    expect(restamped.sort()).toEqual([`hosts/${HOST}/leads/site-lead`, `orgs/${ORG}/leads/org-lead`])
  })

  it('clears it out of the contact facet the site’s consent group holds, and no other', async () => {
    const { store, detach } = harness(
      {
        [`orgs/${ORG}/contacts/shared`]: {
          email: 'shared@example.com',
          facets: {
            brand: { tags: ['vip'], [FIELD]: [CAMPAIGN, OTHER] },
            'other-site': { [FIELD]: [CAMPAIGN] },
          },
        },
      },
      () => 'brand',
    )

    const report = await detach({ hostId: HOST, orgId: ORG, field: FIELD, id: CAMPAIGN })

    expect(report.detached).toBe(1)
    const contact = store.get(`orgs/${ORG}/contacts/shared`)
    expect(contact?.['email']).toBe('shared@example.com')
    expect(contact?.['facets']?.['brand']).toEqual({ tags: ['vip'], [FIELD]: [OTHER] })
    // Another holder's filing of the same person is theirs.
    expect(contact?.['facets']?.['other-site']?.[FIELD]).toEqual([CAMPAIGN])
  })

  it('walks only the org’s leads where no site is named, and only the site’s where no org is', async () => {
    const seed = {
      [`orgs/${ORG}/leads/org-lead`]: { [FIELD]: [CAMPAIGN] },
      [`hosts/${HOST}/leads/site-lead`]: { [FIELD]: [CAMPAIGN] },
      [`orgs/${ORG}/contacts/ada`]: { facets: { [HOST]: { [FIELD]: [CAMPAIGN] } } },
    }
    const orgOnly = harness(seed)
    await orgOnly.detach({ hostId: '', orgId: ORG, field: FIELD, id: CAMPAIGN })
    expect(orgOnly.store.get(`orgs/${ORG}/leads/org-lead`)?.[FIELD]).toEqual([])
    expect(orgOnly.store.get(`hosts/${HOST}/leads/site-lead`)?.[FIELD]).toEqual([CAMPAIGN])
    // A contact's facet is a site's: with no site there is no facet to name.
    expect(orgOnly.store.get(`orgs/${ORG}/contacts/ada`)?.['facets']?.[HOST]?.[FIELD]).toEqual([CAMPAIGN])

    const siteOnly = harness(seed)
    await siteOnly.detach({ hostId: HOST, orgId: '', field: FIELD, id: CAMPAIGN })
    expect(siteOnly.store.get(`hosts/${HOST}/leads/site-lead`)?.[FIELD]).toEqual([])
    expect(siteOnly.store.get(`orgs/${ORG}/leads/org-lead`)?.[FIELD]).toEqual([CAMPAIGN])
  })

  it('answers nothing detached for a field no declared container kind owns', async () => {
    const { store, detach } = harness({ [`orgs/${ORG}/leads/lead`]: { tagIds: [CAMPAIGN] } })
    expect(await detach({ hostId: HOST, orgId: ORG, field: 'tagIds', id: CAMPAIGN })).toEqual({
      detached: 0,
      remaining: false,
    })
    expect(store.get(`orgs/${ORG}/leads/lead`)?.['tagIds']).toEqual([CAMPAIGN])
  })
})
