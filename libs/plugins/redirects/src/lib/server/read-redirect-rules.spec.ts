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
  readAllRedirectRules,
  REDIRECT_RULES_PAGE_SIZE,
  type RedirectRulesQuery,
} from './read-redirect-rules'

/**
 * The walk that replaced the live resolver's `limit(100)` (AGL-4247): every
 * stored rule comes back, however many there are, in pages.
 */

type Doc = { id: string; enabled: boolean }

function fakeRules(count: number, disabledEvery = 0) {
  const all: Doc[] = Array.from({ length: count }, (_, i) => ({
    id: `r${String(i).padStart(5, '0')}`,
    enabled: !(disabledEvery && i % disabledEvery === 0),
  }))
  const calls: Array<{ enabledOnly: boolean; after: string | null; limit: number }> = []
  const build = (state: { enabledOnly: boolean; ordered: boolean; after: Doc | null; limit: number }): RedirectRulesQuery<Doc> => ({
    where: (field, _op, value) => {
      expect(field).toBe('enabled')
      expect(value).toBe(true)
      return build({ ...state, enabledOnly: true })
    },
    orderBy: () => build({ ...state, ordered: true }),
    startAfter: (doc) => build({ ...state, after: doc }),
    limit: (count) => build({ ...state, limit: count }),
    get: async () => {
      expect(state.ordered).toBe(true)
      calls.push({ enabledOnly: state.enabledOnly, after: state.after?.id ?? null, limit: state.limit })
      const pool = all.filter((doc) => !state.enabledOnly || doc.enabled)
      const start = state.after ? pool.findIndex((doc) => doc.id === state.after?.id) + 1 : 0
      return { docs: pool.slice(start, start + state.limit) }
    },
  })
  return { all, calls, query: build({ enabledOnly: false, ordered: false, after: null, limit: Infinity }) }
}

describe('readAllRedirectRules (AGL-4247)', () => {
  it('returns every rule past the old 100-rule window', async () => {
    const { all, query } = fakeRules(145)
    const docs = await readAllRedirectRules(query)
    expect(docs.map((doc) => doc.id)).toEqual(all.map((doc) => doc.id))
  })

  it('pages with startAfter until a page comes back short', async () => {
    const { calls, query } = fakeRules(REDIRECT_RULES_PAGE_SIZE * 2 + 7)
    const docs = await readAllRedirectRules(query)
    expect(docs).toHaveLength(REDIRECT_RULES_PAGE_SIZE * 2 + 7)
    expect(calls.map((call) => call.limit)).toEqual([
      REDIRECT_RULES_PAGE_SIZE,
      REDIRECT_RULES_PAGE_SIZE,
      REDIRECT_RULES_PAGE_SIZE,
    ])
    expect(calls[0].after).toBeNull()
    expect(calls[1].after).toBe(docs[REDIRECT_RULES_PAGE_SIZE - 1].id)
  })

  it('reads one extra empty page when the count is an exact multiple of the page', async () => {
    const { calls, query } = fakeRules(REDIRECT_RULES_PAGE_SIZE)
    expect(await readAllRedirectRules(query)).toHaveLength(REDIRECT_RULES_PAGE_SIZE)
    expect(calls).toHaveLength(2)
  })

  it('keeps only enabled rules when asked', async () => {
    const { all, calls, query } = fakeRules(300, 3)
    const docs = await readAllRedirectRules(query, { enabledOnly: true })
    expect(docs.map((doc) => doc.id)).toEqual(all.filter((doc) => doc.enabled).map((doc) => doc.id))
    expect(calls.every((call) => call.enabledOnly)).toBe(true)
  })

  it('returns nothing for a site with no rules, in one read', async () => {
    const { calls, query } = fakeRules(0)
    expect(await readAllRedirectRules(query)).toEqual([])
    expect(calls).toHaveLength(1)
  })
})
