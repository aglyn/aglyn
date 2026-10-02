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

import { render } from '@testing-library/react'
import { readFileSync } from 'fs'
import { join } from 'path'
import LiveDescendantsNote, {
  liveDescendantsToastClause,
} from '../components/live-descendants-note.component'

/**
 * UNPUBLISHING OR DELETING A PARENT SAYS WHAT STAYS UP (AGL-3463).
 *
 * Neither act removes more than the parent's own routing entry, so the pages
 * nested under it keep serving. A confirmation that said nothing about them
 * would leave the author believing the section went down with its parent.
 */
describe('LiveDescendantsNote', () => {
  const pages = [
    { id: 'a', path: 'company/about', name: 'About' },
    { id: 't', path: 'company/about/team', name: 'Team' },
  ]

  it('renders nothing when nothing below is live', () => {
    const { container } = render(<LiveDescendantsNote pages={[]} />)
    expect(container.textContent).toBe('')
  })

  it('names each page that stays live, with its address', () => {
    const { container } = render(<LiveDescendantsNote pages={pages} />)
    expect(container.textContent).toContain(
      'These pages under it stay live at their own addresses:',
    )
    expect(container.textContent).toContain('About — /company/about')
    expect(container.textContent).toContain('Team — /company/about/team')
    expect(container.textContent).toContain('Unpublish them separately')
  })

  it('stays inline, because the confirm dialog renders it inside a <p>', () => {
    const paragraph = document.createElement('p')
    document.body.appendChild(paragraph)
    const { container } = render(<LiveDescendantsNote pages={pages} />, {
      container: paragraph,
    })
    expect(container.querySelector('div, ul, li, p p')).toBeNull()
    expect(container.querySelectorAll('[role="listitem"]')).toHaveLength(2)
  })

  it('summarizes past the first eight', () => {
    const many = Array.from({ length: 11 }, (_, index) => ({
      id: `p${index}`,
      path: `section/p${index}`,
    }))
    const { container } = render(<LiveDescendantsNote pages={many} />)
    expect(container.querySelectorAll('[role="listitem"]')).toHaveLength(9)
    expect(container.textContent).toContain('and 3 more')
  })

  it('reads as one clause on the toasts that have no confirmation', () => {
    expect(liveDescendantsToastClause(0)).toBe('')
    expect(liveDescendantsToastClause(1)).toBe(
      ' — the page under it stays live at its own address',
    )
    expect(liveDescendantsToastClause(3)).toBe(
      ' — the 3 pages under it stay live at their own addresses',
    )
  })
})

const readRepo = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8')

const SCREENS_LIST =
  'apps/console/app/(app)/[orgSlug]/hosts/[host]/screens/page.tsx'
const VIEW =
  'apps/console/app/(editor)/[orgSlug]/hosts/[host]/screens/[screenId]/versions/[versionId]/view/page.tsx'
const BESIGNER =
  'apps/console/app/(editor)/[orgSlug]/hosts/[host]/screens/[screenId]/versions/[versionId]/besigner/page.tsx'

/** The body of the `confirm({ … })` call that carries `title`. */
function confirmCall(source: string, title: string): string {
  const at = source.indexOf(`title: '${title}'`)
  expect(at).toBeGreaterThan(-1)
  return source.slice(at, source.indexOf('confirmationText', at))
}

describe('every unpublish and delete confirmation names the pages that stay up', () => {
  it('the Pages list: Unpublish and Delete', () => {
    const source = readRepo(SCREENS_LIST)
    for (const title of ['Unpublish this page?', 'Delete this page?']) {
      expect(confirmCall(source, title)).toMatch(
        /<LiveDescendantsNote pages=\{liveDescendantPages\(id\)\} \/>/,
      )
    }
  })

  it('the page details view: Delete, and the unpublish toast', () => {
    const source = readRepo(VIEW)
    expect(confirmCall(source, 'Delete this page?')).toMatch(
      /<LiveDescendantsNote pages=\{liveDescendants\} \/>/,
    )
    expect(source).toMatch(
      /`Page unpublished\$\{liveDescendantsToastClause\(liveDescendants\.length\)\}`/,
    )
  })

  it('the besigner: both unpublish paths say so in their toast', () => {
    const source = readRepo(BESIGNER)
    expect(
      source.match(
        /`Page unpublished\$\{liveDescendantsToastClause\(liveDescendantCount\)\}`/g,
      ),
    ).toHaveLength(2)
  })
})
