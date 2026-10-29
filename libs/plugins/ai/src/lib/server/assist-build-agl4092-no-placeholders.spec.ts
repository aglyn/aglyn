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
 * THE CHAT NEVER ASKS A BUILD FOR PLACEHOLDERS (AGL-4092). On 2026-10-28 an
 * Assist build for an About page carried a brief the chat wrote itself,
 * ending "use bracketed placeholders where details are missing". The build
 * protocol forbade inventing parts, never placeholders, and the brief was
 * passed through as written, so the plan obeyed it: its card named "[year
 * founded]", "[team story]", "[email]" and "[phone]".
 *
 * The protocol now says never to ask for them, and the brief the build is
 * started with drops any clause that does, and says once where facts come
 * from. Pure: no model is asked.
 */

jest.mock('@aglyn/tenant-data-admin/server/release-flags', () => ({
  __esModule: true,
  filterEnabledPluginsByReleaseFlags: async (ids: readonly string[]) => [...ids],
}))
jest.mock('@aglyn/tenant-data-admin/server/organizations', () => ({
  __esModule: true,
  resolveOrgIdForHost: async () => null,
}))

import { AI_JOB_BRIEF_MAX_CHARS } from '../jobs/ai-job-text-step'
import { ASSIST_ABOUT_BRIEF } from '../jobs/fixtures/ai-site-agl4092-datasets'
import { assistBuildBlock, resolveAssistBuild } from './assist-build'

/** The rule the build protocol gained, word for word. */
const NEVER_PLACEHOLDERS =
  '- Never ask the build for placeholders, brackets or "to be added" text. Where the user gave no fact, say nothing of it: the build reads the site’s business profile and contact details itself.'

/** The line every brief the chat proposes now carries, word for word. */
const FACTS =
  'Facts: use the site’s business profile and contact details on file; where a fact is missing, leave it out — no placeholders, no brackets.'

const SCREEN = 'Site setup — the site’s own settings, including its domain.'

const resolved = (brief: string) =>
  resolveAssistBuild({ summary: 'Plan an About page', brief, publish: false }, { hostId: 'host-1', screen: SCREEN })

describe('a build the chat proposes (AGL-4092)', () => {
  it('is told never to ask for placeholders, brackets or "to be added" text', () => {
    expect(assistBuildBlock().split('\n')).toContain(NEVER_PLACEHOLDERS)
  })

  it('drops the recorded brief’s "use bracketed placeholders" clause and keeps the rest of its sentence', () => {
    const build = resolved(ASSIST_ABOUT_BRIEF)
    expect(build).not.toBeNull()
    const brief = build?.brief ?? ''
    expect(brief).not.toMatch(/placeholders where/i)
    expect(brief).not.toMatch(/bracketed/i)
    expect(brief).toContain('Do not invent names, history, prices, results or testimonials.')
    expect(brief).toContain('Use only the contact details on file.')
    expect(brief).toContain('Also propose a warmer look for the site')
  })

  it('carries the facts line once, before the console page it was asked from', () => {
    const brief = resolved(ASSIST_ABOUT_BRIEF)?.brief ?? ''
    expect(brief.endsWith(`${FACTS}\nAsked from the console page: ${SCREEN}`)).toBe(true)
    // A brief the chat proposes again, the facts line and all, still carries it once.
    const again = resolved(brief.split('\nAsked from')[0] ?? '')?.brief ?? ''
    expect(again.split(FACTS)).toHaveLength(2)
  })

  it('drops a sentence that asks for TBD or "to be added" text, and leaves a brief that asks for none as it was', () => {
    const asked = 'Make a Schedule page with the next five races. Mark any race without a date as TBD. Show the track for each.'
    const brief = resolved(asked)?.brief ?? ''
    expect(brief).toContain('Make a Schedule page with the next five races.')
    expect(brief).toContain('Show the track for each.')
    expect(brief).not.toContain('TBD')
    const plain = 'Make a Sponsors page that thanks the team’s sponsors and says how to become one. Add a page for the steel shelf brackets the team sells.'
    expect(resolved(plain)?.brief).toBe(`${plain}\n${FACTS}\nAsked from the console page: ${SCREEN}`)
  })

  it('still fits the job door’s limit', () => {
    const long = `${'Make a page about the team. '.repeat(400)}`.trim()
    expect((resolved(long)?.brief ?? '').length).toBeLessThanOrEqual(AI_JOB_BRIEF_MAX_CHARS)
    expect(resolved(long)?.brief).toContain(FACTS)
  })
})
