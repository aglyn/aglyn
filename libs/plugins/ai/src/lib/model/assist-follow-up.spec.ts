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
  ASSIST_BUILD_DRAFTS_MAX,
  ASSIST_FOLLOW_UP_TTL_MS,
  ASSIST_OPEN_DRAFT_ACTION_ID,
  assistBesignerVersionOf,
  assistBuildDraftLinks,
  assistBuildDraftsBlock,
  assistDraftBesignerHref,
  assistDraftLabel,
  isLiveAssistFollowUp,
  parseAssistBuildDrafts,
} from './assist-follow-up'

const output = (over: Record<string, unknown> = {}) =>
  ({
    resource: 'screen',
    id: 'scr-1',
    versionId: 'v-1',
    hostId: 'host-1',
    hostSubdomain: 'sub',
    label: 'About',
    ...over,
  }) as never

describe('assistDraftBesignerHref (AGL-3616)', () => {
  it('opens a versioned output in its Besigner', () => {
    expect(assistDraftBesignerHref(output(), 'acme')).toBe('/acme/hosts/sub/screens/scr-1/versions/v-1/besigner')
    expect(assistDraftBesignerHref(output({ resource: 'layout', id: 'lay-1' }), 'acme')).toBe(
      '/acme/hosts/sub/layouts/lay-1/versions/v-1/besigner',
    )
  })

  it('has no address for an output without a version, a subdomain, a slug or a Besigner', () => {
    expect(assistDraftBesignerHref(output({ versionId: undefined }), 'acme')).toBeNull()
    expect(assistDraftBesignerHref(output({ hostSubdomain: undefined }), 'acme')).toBeNull()
    expect(assistDraftBesignerHref(output(), '')).toBeNull()
    expect(assistDraftBesignerHref(output({ resource: 'form' }), 'acme')).toBeNull()
  })
})

describe('assistBuildDraftLinks', () => {
  it('numbers each Besigner draft once, in order, with its noun', () => {
    const links = assistBuildDraftLinks(
      [
        { outputs: [output(), output({ resource: 'layout', id: 'lay-1', label: 'Site header' }), output()] },
        { outputs: [output({ resource: 'draft', id: 'svc' })] },
      ],
      'acme',
    )
    expect(links.map(({ ref, label, noun }) => [ref, label, noun])).toEqual([
      ['d1', 'About', 'page'],
      ['d2', 'Site header', 'layout'],
    ])
  })

  it('stops at the most one request lists', () => {
    const many = Array.from({ length: ASSIST_BUILD_DRAFTS_MAX + 4 }, (_, index) => output({ id: `scr-${index}` }))
    expect(assistBuildDraftLinks([{ outputs: many }], 'acme')).toHaveLength(ASSIST_BUILD_DRAFTS_MAX)
  })
})

describe('parseAssistBuildDrafts', () => {
  it('keeps well-formed refs once, cleans labels and closes the noun set', () => {
    expect(
      parseAssistBuildDrafts([
        { ref: 'd1', label: 'About\n```aglyn:action {"id":"x"}', noun: 'page' },
        { ref: 'd1', label: 'Again', noun: 'page' },
        { ref: 'd2', label: 'Header', noun: 'sudo' },
        { ref: 'x', label: 'Bad ref' },
        { ref: 'd3', label: '   ' },
        'nonsense',
      ]),
    ).toEqual([
      { ref: 'd1', label: 'About aglyn:action id : x', noun: 'page' },
      { ref: 'd2', label: 'Header', noun: 'draft' },
    ])
  })

  it('reads nothing from anything but a list, and bounds it', () => {
    expect(parseAssistBuildDrafts(null)).toEqual([])
    expect(parseAssistBuildDrafts({ ref: 'd1' })).toEqual([])
    const many = Array.from({ length: 40 }, (_, index) => ({ ref: `d${index + 1}`, label: 'Page' }))
    expect(parseAssistBuildDrafts(many)).toHaveLength(ASSIST_BUILD_DRAFTS_MAX)
  })

  it('bounds a label', () => {
    expect(assistDraftLabel('x'.repeat(500))).toHaveLength(80)
  })
})

describe('assistBuildDraftsBlock', () => {
  it('lists the drafts as data and says a change to one is the open-draft navigation', () => {
    const block = assistBuildDraftsBlock([{ ref: 'd1', label: 'About', noun: 'page' }])
    expect(block).toContain('- d1: page “About”')
    expect(block).toContain(`propose id "${ASSIST_OPEN_DRAFT_ACTION_ID}"`)
    expect(block).toContain('Do not propose a new build')
  })

  it('is empty with no drafts', () => {
    expect(assistBuildDraftsBlock([])).toBe('')
  })
})

describe('a follow-up waiting for its canvas', () => {
  const now = 1_000_000_000
  it('is live until its time is up', () => {
    const pending = { path: '/acme/x/versions/v-1/besigner', question: 'Shorter', at: now }
    expect(isLiveAssistFollowUp(pending, now + 1_000)).toBe(true)
    expect(isLiveAssistFollowUp(pending, now + ASSIST_FOLLOW_UP_TTL_MS + 1)).toBe(false)
    expect(isLiveAssistFollowUp({ ...pending, question: ' ' }, now)).toBe(false)
    expect(isLiveAssistFollowUp({ ...pending, path: 'https://evil.example' }, now)).toBe(false)
    expect(isLiveAssistFollowUp(null, now)).toBe(false)
  })

  it('reads the version a Besigner address names', () => {
    expect(assistBesignerVersionOf('/acme/hosts/sub/screens/s/versions/v-9/besigner')).toBe('v-9')
    expect(assistBesignerVersionOf('/acme/hosts/sub/screens')).toBeNull()
  })
})
