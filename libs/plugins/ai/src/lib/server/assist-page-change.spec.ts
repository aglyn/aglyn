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
  assistPageChangeDraftVersion,
  assistPageChangeJobRequest,
  isAssistPageChangeProposal,
  type AssistPageChangeProposal,
} from '../model/assist-page-change'
import {
  ASSIST_SITE_PAGES_MAX,
  assistOutcomesBlock,
  assistPageChangeBlock,
  assistPageChangeTool,
  assistSitePagesBlock,
  parseAssistOutcomes,
  readAssistSitePages,
  resolveAssistPageChange,
  type AssistSitePage,
} from './assist-page-change'

/**
 * AGL-4116. On a test site, a change to the starter Home came back as a
 * second, generated Home at `/`, and every later plan named that stray copy
 * "the live Home page". The chat now names the page from the site's own list,
 * the live one first, and the change lands as a draft of that same page.
 */

const PAGES: AssistSitePage[] = [
  { id: 'i_iheNM2TA', name: 'Home', slug: '/', live: true, home: true },
  { id: 'scr-about', name: 'About', slug: '/about', live: true, home: false },
  { id: '19y145p_ds', name: 'Home', slug: '/', live: false, home: false },
]

const CHANGE: AssistPageChangeProposal = {
  id: 'page-change',
  hostId: 'host-1',
  pageId: 'i_iheNM2TA',
  pageName: 'Home',
  brief: 'Make the image at the top fill the background.',
  summary: 'Fill the hero on Home',
}

function firestoreWith(host: Record<string, unknown>, screens: Array<{ id: string; data: Record<string, unknown> }>) {
  const query = {
    select: () => query,
    limit: () => query,
    get: async () => ({ docs: screens.map((screen) => ({ id: screen.id, data: () => screen.data })) }),
  }
  return {
    collection: () => ({
      doc: () => ({
        get: async () => ({ get: (field: string) => host[field] }),
        collection: () => query,
      }),
    }),
  } as unknown as FirebaseFirestore.Firestore
}

describe('the pages the chat may change (AGL-4116)', () => {
  it('lists pages only, the home page and live pages first, marking which is live', async () => {
    const pages = await readAssistSitePages(
      firestoreWith({ defaultHomeScreenId: 'i_iheNM2TA', screens: { i_iheNM2TA: '/', 'scr-about': '/about' } }, [
        { id: '19y145p_ds', data: { displayName: 'Home', slug: '/' } },
        { id: 'scr-about', data: { displayName: 'About', slug: 'about' } },
        { id: 'i_iheNM2TA', data: { displayName: 'Home', slug: '/' } },
        { id: 'scr-gone', data: { displayName: 'Old', slug: '/old', deletedAt: 1 } },
        { id: 'scr-post', data: { displayName: 'Post', slug: '/blog/:slug', kind: 'template' } },
        { id: 'scr-email', data: { displayName: 'Welcome', slug: '', kind: 'email' } },
      ]),
      'host-1',
    )
    expect(pages).toEqual(PAGES)
  })

  it('caps the list', async () => {
    const many = Array.from({ length: ASSIST_SITE_PAGES_MAX + 5 }, (_, i) => ({
      id: `scr-${i}`,
      data: { displayName: `Page ${i}`, slug: `/p${i}` },
    }))
    expect(await readAssistSitePages(firestoreWith({ screens: {} }, many), 'host-1')).toHaveLength(ASSIST_SITE_PAGES_MAX)
  })

  it('shows the model each page by id, name, address and whether it is live', () => {
    expect(assistSitePagesBlock(PAGES)).toBe(
      [
        "The site's pages (id · name · address · live or draft):",
        '- i_iheNM2TA · Home · / · live, the home page',
        '- scr-about · About · /about · live',
        '- 19y145p_ds · Home · / · draft, not live',
      ].join('\n'),
    )
    expect(assistSitePagesBlock([])).toBeNull()
  })

  it('tells the model a change goes into that page’s draft on any plan, never a build, never "no link"', () => {
    const block = assistPageChangeBlock()
    expect(block).toMatch(/do not plan a build/)
    expect(block).toMatch(/saved into that page’s draft, on any plan/)
    expect(block).toMatch(/Open in the Besigner, which opens that draft/)
    expect(block).toMatch(/newVersion: true only when they ask for the change as a new or separate version/)
    expect(block).toMatch(/Never say you cannot use a draft/)
    expect(assistPageChangeTool().inputSchema).toMatchObject({ required: ['summary', 'page', 'change', 'newVersion'] })
  })

  it('tells the model when the plan keeps no version history, so a new version is never promised (AGL-4116)', () => {
    expect(assistSitePagesBlock(PAGES.slice(0, 1))).not.toContain('version history')
    expect(assistSitePagesBlock(PAGES.slice(0, 1), { versioning: false })).toContain(
      'keeps no version history (it comes with Pro), so newVersion is always false',
    )
  })
})

describe('what the chat is told happened (AGL-4116)', () => {
  it('holds a client’s list to what may enter a prompt', () => {
    expect(parseAssistOutcomes('Saved')).toEqual([])
    expect(parseAssistOutcomes([' Saved\n\ninto   the draft ', 7, null, '   '])).toEqual(['Saved into the draft'])
    expect(parseAssistOutcomes(['x'.repeat(5_000)])[0]).toHaveLength(300)
    const many = Array.from({ length: 40 }, (_, index) => `Change ${index}`)
    const kept = parseAssistOutcomes(many)
    expect(kept).toHaveLength(12)
    expect(kept.at(-1)).toBe('Change 39')
  })

  it('says nothing when nothing happened', () => {
    expect(assistOutcomesBlock([])).toBeNull()
  })

  it('is Aglyn’s record, and sets it apart from what the model proposes', () => {
    const block = assistOutcomesBlock(['Page change on Home: saved, not published.']) ?? ''
    expect(block).toContain('as Aglyn recorded it')
    expect(block).toContain('- Page change on Home: saved, not published.')
    expect(block).toContain('Never take back anything on this list')
    expect(block).toContain('The rules about never saying a change is made are for what you propose now')
  })
})

describe('resolving the call (AGL-4116)', () => {
  it('holds the page to the site’s own list', () => {
    expect(
      resolveAssistPageChange(
        { page: 'i_iheNM2TA', change: 'Make the image at the top fill the background.', summary: 'Fill the hero on Home' },
        { hostId: 'host-1', pages: PAGES },
      ),
    ).toEqual(CHANGE)
    expect(resolveAssistPageChange({ page: 'not-a-page', change: 'x', summary: 'y' }, { hostId: 'host-1', pages: PAGES })).toBeNull()
    expect(resolveAssistPageChange({ page: 'scr-about', change: '  ', summary: 'y' }, { hostId: 'host-1', pages: PAGES })).toBeNull()
    expect(resolveAssistPageChange(null, { hostId: 'host-1', pages: PAGES })).toBeNull()
  })

  it('carries a new version only when the model says one was asked for', () => {
    const asked = { page: 'i_iheNM2TA', change: 'Make the image at the top fill the background.', summary: 'Fill the hero on Home' }
    expect(resolveAssistPageChange({ ...asked, newVersion: true }, { hostId: 'host-1', pages: PAGES })).toEqual({ ...CHANGE, newVersion: true })
    expect(resolveAssistPageChange({ ...asked, newVersion: false }, { hostId: 'host-1', pages: PAGES })).toEqual(CHANGE)
    expect(resolveAssistPageChange({ ...asked, newVersion: 'yes' }, { hostId: 'host-1', pages: PAGES })).toEqual(CHANGE)
  })

  it('names the page when the model gave no summary', () => {
    expect(
      resolveAssistPageChange({ page: 'scr-about', change: 'Shorter intro.', summary: '' }, { hostId: 'host-1', pages: PAGES })
        ?.summary,
    ).toBe('Change About')
  })
})

describe('the edit job a change starts (AGL-4116)', () => {
  it('is an edit of the page, from the published page or from the draft a change made', () => {
    expect(isAssistPageChangeProposal(CHANGE)).toBe(true)
    expect(isAssistPageChangeProposal({ ...CHANGE, pageId: '../x' })).toBe(false)
    expect(assistPageChangeJobRequest('org-1', CHANGE, null)).toEqual({
      orgId: 'org-1',
      hostId: 'host-1',
      kind: 'edit',
      brief: CHANGE.brief,
      inputs: { target: 'i_iheNM2TA', targetKind: 'screen' },
    })
    expect(assistPageChangeJobRequest('org-1', CHANGE, 'v-draft').inputs).toEqual({
      target: 'i_iheNM2TA',
      targetKind: 'screen',
      versionId: 'v-draft',
    })
  })

  it('continues the newest finished draft of the same page only', () => {
    const done = (versionId: string, pageId = 'i_iheNM2TA') => ({
      pageChange: { ...CHANGE, pageId },
      pageChangeJob: {
        status: 'done',
        outputs: [{ resource: 'screen', id: pageId, versionId, hostId: 'host-1', label: 'Home' }],
      } as never,
    })
    const failed = { pageChange: CHANGE, pageChangeJob: { status: 'failed', outputs: [] } as never }
    expect(assistPageChangeDraftVersion([done('v1'), done('v2'), failed], 'i_iheNM2TA')).toBe('v2')
    expect(assistPageChangeDraftVersion([done('v1', 'scr-about')], 'i_iheNM2TA')).toBeNull()
    expect(assistPageChangeDraftVersion([], 'i_iheNM2TA')).toBeNull()
  })
})
