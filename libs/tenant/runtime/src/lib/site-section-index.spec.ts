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

jest.mock('@aglyn/tenant-data-admin', () => ({ firebaseAdmin: { app: jest.fn() } }))
jest.mock('@aglyn/tenant-data-admin/render-cache', () => ({
  PUBLISHED_SITE_DATA_TTL_SECONDS: 60,
  tenantDataTag: (hostId: string) => `tenant-data:${hostId}`,
  withRenderCache: jest.fn(async ({ read }: { read: () => unknown }) => read()),
}))
jest.mock('./template-screens', () => ({ __esModule: true, default: jest.fn(async () => new Set()) }))
jest.mock('./get-screen-version', () => ({ __esModule: true, default: jest.fn() }))

import {
  markdownToPlainText,
  rankSiteSections,
  siteSectionIndex,
  splitMarkdownIntoSections,
  SITE_SECTION_TEXT_CHARS,
  type SiteSection,
} from './site-section-index'

const page = { url: '/visit', fallbackTitle: 'Visit', kind: 'page' as const }

describe('site section index (AGL-4250)', () => {
  it('reads Markdown as the words a visitor sees', () => {
    expect(markdownToPlainText('**Open** [daily](/hours) ![x](/a.jpg)\n- 9 to 4')).toBe('Open daily 9 to 4')
  })

  it('cuts a page at its headings, naming it by its # line', () => {
    const sections = splitMarkdownIntoSections(
      '# Plan your visit\n\n> Everything to know.\n\nWe are in Texas.\n\n## Hours\n\nOpen 9 to 4.\n\n## Pets\n\nDogs on a leash.\n\n---\n\nSource: https://example.com/visit\n',
      page,
    )
    expect(sections.map((section) => [section.title, section.heading])).toEqual([
      ['Plan your visit', ''],
      ['Plan your visit', 'Hours'],
      ['Plan your visit', 'Pets'],
    ])
    expect(sections[0].text).toBe('Everything to know. We are in Texas.')
    expect(sections[2]).toMatchObject({ url: '/visit', text: 'Dogs on a leash.', kind: 'page' })
  })

  it('caps a section so one long page cannot fill the index', () => {
    const [section] = splitMarkdownIntoSections(`# Long\n\n${'word '.repeat(2_000)}`, page)
    expect(section.text.length).toBeLessThanOrEqual(SITE_SECTION_TEXT_CHARS)
  })

  it('keeps the fallback title for a page with no # line', () => {
    expect(splitMarkdownIntoSections('Hello there.', page)[0].title).toBe('Visit')
  })

  it('ranks the answering page first and reuses the index until the sections change', () => {
    const sections: SiteSection[] = [
      { url: '/', title: 'Acme Ranch', heading: '', text: 'Welcome to Acme Ranch, a motocross park.', kind: 'page' },
      { url: '/rules', title: 'Park rules', heading: 'Pets', text: 'Dogs are welcome on a leash.', kind: 'page' },
    ]
    expect(rankSiteSections(sections, 'can I bring my dogs', 6, 'h1')[0].section.url).toBe('/rules')
    const index = siteSectionIndex(sections, 'h1')
    expect(siteSectionIndex([...sections], 'h1')).toBe(index)
    expect(siteSectionIndex([...sections, { ...sections[1], url: '/more' }], 'h1')).not.toBe(index)
  })
})
