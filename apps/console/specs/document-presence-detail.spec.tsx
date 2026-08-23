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
import DocumentPresenceLive from '../components/document-presence-live.component'
import { presenceChipTooltip } from '../components/document-presence-chips.component'

/**
 * A detail page reports the room WITHOUT joining it (AGL-2486).
 *
 * Zach: "identify who is currently in the document already before joining."
 * The word doing the work there is BEFORE. An affordance that announces the
 * person reading it has destroyed the thing it was built to report: once a
 * detail page joins, everybody browsing a site is listed as editing, and the
 * chips stop meaning anything. So "does not join" is not an optimisation
 * here, it is the feature's correctness condition, and it is asserted rather
 * than assumed.
 */

const mockUsePresence = jest.fn()
const mockPeopleIn = jest.fn()
const mockRefresh = jest.fn()

jest.mock('../hooks/use-presence', () => ({
  __esModule: true,
  default: (options: unknown) => mockUsePresence(options),
}))

jest.mock('../hooks/use-presence-summary', () => ({
  __esModule: true,
  default: () => ({
    summary: {},
    peopleIn: (docType: string, docId: string) => mockPeopleIn(docType, docId),
    refresh: mockRefresh,
  }),
}))

const roomPerson = (over: Record<string, unknown> = {}) => ({
  uid: 'u1',
  displayName: 'Zach Gover',
  sessions: 1,
  ...over,
})

beforeEach(() => {
  mockUsePresence.mockReset().mockReturnValue({ people: [] })
  mockPeopleIn.mockReset().mockReturnValue([])
  mockRefresh.mockReset()
})

const renderLive = () =>
  render(
    <DocumentPresenceLive
      hostId="host-1"
      docType="screen"
      docId="doc-1"
      versionId="v7"
    />,
  )

describe('watching the room from a detail page', () => {
  it('subscribes as an OBSERVER, so reading the answer does not change it', () => {
    mockUsePresence.mockReturnValue({ people: [roomPerson()] })
    renderLive()
    expect(mockUsePresence).toHaveBeenCalled()
    const options = mockUsePresence.mock.calls[0][0] as Record<string, unknown>
    // The one assertion this whole file exists for.
    expect(options.observeOnly).toBe(true)
  })

  it('watches the room for the version the page is about', () => {
    renderLive()
    const options = mockUsePresence.mock.calls[0][0] as Record<string, unknown>
    expect(options.docType).toBe('screen')
    expect(options.docId).toBe('doc-1')
    // A room is one VERSION. The page must not silently watch a different
    // one from the one its open action would take you to.
    expect(options.versionId).toBe('v7')
  })
})

describe('a document nobody is in', () => {
  it('renders nothing at all, rather than a reserved gap', () => {
    const { container } = renderLive()
    expect(container.innerHTML).toBe('')
  })
})

describe('people in the room', () => {
  it('draws them as chips', () => {
    mockUsePresence.mockReturnValue({
      people: [roomPerson(), roomPerson({ uid: 'u2', displayName: 'Ada L' })],
    })
    const { container } = renderLive()
    expect(
      container
        .querySelector('[data-aglyn-document-presence]')
        ?.getAttribute('data-aglyn-document-presence'),
    ).toBe('2')
  })
})

/**
 * The contradiction this component exists to prevent.
 *
 * A list row counts the whole DOCUMENT; a room is one VERSION. Without this,
 * a reader clicks a row that says two people are in a screen and arrives at a
 * page that says nobody is — which reads as the feature being broken, not as
 * two different questions having two different answers.
 */
describe('people in a DIFFERENT version', () => {
  it('is reported separately, and never drawn as being in this room', () => {
    mockUsePresence.mockReturnValue({ people: [] })
    mockPeopleIn.mockReturnValue([{ uid: 'u9', displayName: 'Ada Lovelace' }])
    const { container } = renderLive()
    expect(
      container
        .querySelector('[data-aglyn-document-presence-other-versions]')
        ?.textContent,
    ).toBe('1 in another version')
    // Crucially NOT chips: they are not in the room this page is about.
    expect(container.querySelector('[data-aglyn-document-presence]')).toBeNull()
  })

  it('does not double-count somebody who is in this very room', () => {
    // The summary rolls UP across versions, so it includes the room this page
    // is watching. Subtracting the room is what stops one person being drawn
    // as a chip and counted again as "1 in another version".
    mockUsePresence.mockReturnValue({ people: [roomPerson({ uid: 'u1' })] })
    mockPeopleIn.mockReturnValue([{ uid: 'u1', displayName: 'Zach Gover' }])
    const { container } = renderLive()
    expect(
      container.querySelector('[data-aglyn-document-presence-other-versions]'),
    ).toBeNull()
  })
})

/**
 * What the sentence beside the faces is allowed to claim.
 *
 * A list row's chips are a roll-up across versions, so wording that says
 * "editing this" beside a row whose open button goes to version 7 asserts
 * something the data does not support. The reader is deciding whether to open
 * a document on the strength of that sentence.
 */
describe('the tooltip', () => {
  it('hedges the version on a list row, which counts the whole document', () => {
    const copy = presenceChipTooltip(['Zach Gover'], 'document')
    expect(copy).toContain('in this document')
    expect(copy).toContain('possibly in a different version')
    // It must not claim the version the reader is about to open.
    expect(copy).not.toContain('this version')
  })

  it('says `version` only where a real room backs the claim', () => {
    expect(presenceChipTooltip(['Zach Gover'], 'version')).toBe(
      'Zach Gover is editing this version right now.',
    )
  })

  it('reads as a sentence for several people', () => {
    expect(presenceChipTooltip(['Ada', 'Grace', 'Zach'], 'version')).toBe(
      'Ada, Grace and Zach are editing this version right now.',
    )
  })
})
