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
 * Where a plugin runs, written for a marketplace plugin being installed with
 * "All sites except…" (AGL-4047).
 *
 * The transaction is the console's "Runs on" one, moved here so the
 * marketplace's install route can write the same entries before its pin. What
 * an install changes: the plugin reads as on (the install switches it on), the
 * choice only ever leaves sites out, and a refusal on any site writes nothing.
 * The real transaction runs against the emulator in the console's
 * `plugin-runs-on.emulator.spec.ts`; this double holds what the install adds.
 */

jest.mock('./scope-sharing-sweep', () => ({
  orgHostIdsFromDoc: (org: { hosts?: Record<string, boolean> } | undefined) =>
    Object.keys(org?.hosts ?? {}),
}))

import { pluginRunsOnChoiceFrom, writePluginRunsOn } from './plugin-runs-on'

type Doc = Record<string, unknown>

function fakeFirestore(docs: Record<string, Doc>) {
  const updates: Array<{ path: string; data: Doc }> = []
  const ref = (path: string) => ({ path, id: path.split('/').pop() as string })
  const snapshot = (target: { path: string; id: string }) => ({
    id: target.id,
    exists: Boolean(docs[target.path]),
    data: () => docs[target.path],
    get: (field: string) => docs[target.path]?.[field],
  })
  const firestore = {
    collection: (name: string) => ({ doc: (id: string) => ref(`${name}/${id}`) }),
    runTransaction: async (work: (tx: unknown) => Promise<unknown>) =>
      work({
        get: async (target: { path: string; id: string }) => snapshot(target),
        getAll: async (...targets: Array<{ path: string; id: string }>) => targets.map(snapshot),
        update: (target: { path: string }, data: Doc) => updates.push({ path: target.path, data }),
      }),
  }
  return { firestore: firestore as unknown as FirebaseFirestore.Firestore, updates }
}

const ORG = 'org-1'
const LISTING = 'lst-1'

const workspace = (overrides: Record<string, Doc> = {}): Record<string, Doc> => ({
  [`orgs/${ORG}`]: { hosts: { a: true, b: true, c: true }, enabledPlugins: ['crm'] },
  'hosts/a': { orgId: ORG, displayName: 'Bakery' },
  'hosts/b': { orgId: ORG, displayName: 'Cafe' },
  'hosts/c': { orgId: ORG, displayName: 'Catering', disabledPlugins: [LISTING] },
  ...overrides,
})

const write = (
  docs: Record<string, Doc>,
  options: Partial<Parameters<typeof writePluginRunsOn>[0]> = {},
) => {
  const fake = fakeFirestore(docs)
  const result = writePluginRunsOn({
    firestore: fake.firestore,
    orgId: ORG,
    pluginId: LISTING,
    label: 'Promo Countdown',
    choice: { mode: 'allExcept', exceptHostIds: ['a'] },
    installing: true,
    mayChangeSite: async () => true,
    refusedOnSite: (name) => `refused on ${name}`,
    now: () => 'NOW',
    ...options,
  })
  return { result, updates: fake.updates }
}

describe('writing "All sites except…" for a plugin being installed', () => {
  it('leaves the chosen site out, though the workspace has not switched the listing on yet', async () => {
    const { result, updates } = write(workspace())
    await expect(result).resolves.toEqual({ ok: true, leftOutHostIds: ['a'], broughtBackHostIds: [] })
    expect(updates).toEqual([
      { path: 'hosts/a', data: { disabledPlugins: [LISTING], updatedAt: 'NOW' } },
    ])
  })

  it('keeps a site’s own earlier switch, as a plain All sites install does', async () => {
    // Catering switched this listing off before it was last uninstalled.
    const { result, updates } = write(workspace())
    await result
    expect(updates.map((update) => update.path)).not.toContain('hosts/c')
  })

  it('without `installing`, the same choice is refused for a plugin the workspace has off (the control)', async () => {
    const { result, updates } = write(workspace(), { installing: false })
    await expect(result).resolves.toMatchObject({
      ok: false,
      status: 400,
      problem: 'Promo Countdown is switched off for this workspace, so it runs on no site. Switch it on first.',
    })
    expect(updates).toEqual([])
  })

  it('refuses, naming the site, when the member can’t change a site it leaves out, and writes nothing', async () => {
    const { result, updates } = write(workspace(), {
      choice: { mode: 'allExcept', exceptHostIds: ['a', 'b'] },
      mayChangeSite: async (hostId) => hostId !== 'b',
    })
    await expect(result).resolves.toEqual({ ok: false, status: 403, problem: 'refused on Cafe' })
    expect(updates).toEqual([])
  })

  it('asks only about the sites it leaves out', async () => {
    const asked: string[] = []
    const { result } = write(workspace(), {
      mayChangeSite: async (hostId) => {
        asked.push(hostId)
        return true
      },
    })
    await result
    expect(asked).toEqual(['a'])
  })

  it('refuses leaving every site out, by the plugin’s name', async () => {
    const { result, updates } = write(workspace(), {
      choice: { mode: 'allExcept', exceptHostIds: ['a', 'b', 'c'] },
    })
    await expect(result).resolves.toMatchObject({
      ok: false,
      status: 400,
      problem:
        'Keep at least one site in. To stop Promo Countdown on every site, switch it off for the workspace.',
    })
    expect(updates).toEqual([])
  })

  it('never writes a site another workspace now holds', async () => {
    const { result, updates } = write(
      workspace({ 'hosts/a': { orgId: 'someone-else', displayName: 'Bakery' } }),
      { choice: { mode: 'allExcept', exceptHostIds: ['a', 'b'] } },
    )
    await expect(result).resolves.toEqual({ ok: true, leftOutHostIds: ['b'], broughtBackHostIds: [] })
    expect(updates.map((update) => update.path)).toEqual(['hosts/b'])
  })

  it('plans a default-open workspace (no list at all) as on, too', async () => {
    const { result } = write(
      workspace({ [`orgs/${ORG}`]: { hosts: { a: true, b: true, c: true } } }),
    )
    await expect(result).resolves.toMatchObject({ ok: true, leftOutHostIds: ['a'] })
  })
})

describe('pluginRunsOnChoiceFrom', () => {
  it('reads the two choices and nothing else', () => {
    expect(pluginRunsOnChoiceFrom({ mode: 'all' })).toEqual({ mode: 'all' })
    expect(pluginRunsOnChoiceFrom({ mode: 'allExcept', exceptHostIds: ['a'] })).toEqual({
      mode: 'allExcept',
      exceptHostIds: ['a'],
    })
    expect(pluginRunsOnChoiceFrom({ mode: 'selected', hostIds: ['a'] })).toBeNull()
    expect(pluginRunsOnChoiceFrom({ mode: 'allExcept', exceptHostIds: ['hosts/a'] })).toBeNull()
    expect(pluginRunsOnChoiceFrom(null)).toBeNull()
  })
})
