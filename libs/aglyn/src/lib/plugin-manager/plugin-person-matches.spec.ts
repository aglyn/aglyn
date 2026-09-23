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
  listPluginPersonMatchers,
  registerPluginPersonMatcher,
  resetPluginPersonMatchers,
  runPluginPersonMatchers,
  type PluginPersonMatch,
  type PluginPersonMatchRequest,
} from './plugin-person-matches'

const request: PluginPersonMatchRequest = {
  orgId: 'house',
  orgSlug: 'house-org',
  email: 'someone@example.com',
  name: 'Some One',
  accountCreatedAtMs: 1_000,
}

const match = (overrides: Partial<PluginPersonMatch>): PluginPersonMatch => ({
  kind: 'contact',
  id: 'c1',
  label: 'Some One',
  email: null,
  basis: 'name',
  firstSeenAtMs: null,
  sources: [],
  href: null,
  ...overrides,
})

afterEach(() => resetPluginPersonMatchers())

it('asks every plugin, puts certain answers first, and tags who answered', async () => {
  registerPluginPersonMatcher(async () => [match({ id: 'guess' })], { pluginId: 'one' })
  registerPluginPersonMatcher(async () => [match({ id: 'sure', basis: 'email' })], { pluginId: 'two' })
  const report = await runPluginPersonMatchers(request)
  expect(report.asked).toEqual(['one', 'two'])
  expect(report.matches.map((found) => [found.id, found.pluginId])).toEqual([
    ['sure', 'two'],
    ['guess', 'one'],
  ])
  expect(report.failed).toEqual([])
})

it('reports a matcher that threw as failed, not as having found nobody', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
  registerPluginPersonMatcher(async () => {
    throw new Error('boom')
  }, { pluginId: 'broken' })
  registerPluginPersonMatcher(async () => [match({})], { pluginId: 'fine' })
  const report = await runPluginPersonMatchers(request)
  expect(report.failed).toEqual(['broken'])
  expect(report.matches).toHaveLength(1)
  // The log line names the workspace and never the person.
  expect(String((console.error as jest.Mock).mock.calls[0][0])).not.toContain('someone@example.com')
})

it('replaces a plugin’s matcher in place, and refuses one with no owner', () => {
  registerPluginPersonMatcher(async () => [], { pluginId: 'one' })
  registerPluginPersonMatcher(async () => [], { pluginId: 'one' })
  expect(listPluginPersonMatchers()).toEqual(['one'])
  expect(() => registerPluginPersonMatcher(async () => [])).toThrow(/no owner/)
})

it('hands each matcher its own copy of the request', async () => {
  registerPluginPersonMatcher(async (asked) => {
    ;(asked as { email: string | null }).email = null
    return []
  }, { pluginId: 'meddler' })
  const seen: Array<string | null> = []
  registerPluginPersonMatcher(async (asked) => {
    seen.push(asked.email)
    return []
  }, { pluginId: 'reader' })
  await runPluginPersonMatchers(request)
  expect(seen).toEqual(['someone@example.com'])
})
