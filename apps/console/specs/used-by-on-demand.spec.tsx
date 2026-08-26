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
 * "Used by" costs money, so it runs when ASKED (AGL-703).
 *
 * The scan reads every screen, every layout and — for a component — every
 * component definition, decoding published node trees as it goes. On a site
 * with a widely used layout that is hundreds of document reads. Fired on
 * mount, opening a detail page to rename something bills the same as deciding
 * whether to delete it.
 *
 * The media library settled this in AGL-845 and says so in its own comment:
 * *"scanning every published screen, layout, and content entry for this
 * asset's URLs is expensive, so it runs ONLY when the user asks, never on
 * drawer open."* This is that rule, on the artifact side, and it is asserted
 * against the NETWORK rather than against the rendering — the cost is the
 * request, and a card that renders an idle-looking placeholder while quietly
 * fetching would pass any check of what is on screen.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import UsedByCard from '../components/used-by-card.component'

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useUser: () => ({ data: { uid: 'uid-1', getIdToken: async () => 'token' } }),
}))
jest.mock('../hooks/use-org-scope', () => ({ useOrgSlug: () => 'acme' }))
jest.mock('../components/host-id-provider', () => ({
  useHostSubdomain: () => 'site',
}))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AppLink: ({ children, href }: { children?: ReactNode; href?: string }) => (
    <a href={href}>{children}</a>
  ),
}))

const fetchMock = jest.fn()

beforeEach(() => {
  fetchMock.mockReset()
  fetchMock.mockResolvedValue({
    ok: true,
    json: async () => ({
      dependents: [{ type: 'screen', id: 's1', name: 'Home' }],
      complete: true,
    }),
  })
  ;(global as any).fetch = fetchMock
})

describe('the Used by card scans only when asked (AGL-703)', () => {
  it('THE COST: mounting sends no request at all', async () => {
    render(<UsedByCard hostId="h1" kind="layout" id="l1" noun="layout" />)
    // Not "renders a button" — the claim is about the wire. An effect that
    // fired and threw the answer away would still be 53 reads.
    await waitFor(() =>
      expect(screen.getByText(/Find where this is used/i)).toBeTruthy(),
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('scans once, and only once, when the reader asks', async () => {
    render(<UsedByCard hostId="h1" kind="layout" id="l1" noun="layout" />)
    fireEvent.click(screen.getByText(/Find where this is used/i))
    await waitFor(() => expect(screen.getByText('Home')).toBeTruthy())
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe('/api/hosts/where-used')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      hostId: 'h1',
      kind: 'layout',
      id: 'l1',
    })
  })

  it('asks again on Rescan, because the answer is a snapshot', async () => {
    render(<UsedByCard hostId="h1" kind="layout" id="l1" noun="layout" />)
    fireEvent.click(screen.getByText(/Find where this is used/i))
    await waitFor(() => expect(screen.getByText('Home')).toBeTruthy())
    fireEvent.click(screen.getByText(/Rescan/i))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
  })

  it('scans SCREENS too — the kind the endpoint could not answer', async () => {
    render(<UsedByCard hostId="h1" kind="screen" id="scr1" noun="screen" />)
    fireEvent.click(screen.getByText(/Find where this is used/i))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).kind).toBe('screen')
  })

  it('returns to idle when the card switches artifact', async () => {
    // One artifact's dependents must never appear under another's name, and
    // the new artifact must not be scanned unasked either.
    const { rerender } = render(
      <UsedByCard hostId="h1" kind="layout" id="l1" noun="layout" />,
    )
    fireEvent.click(screen.getByText(/Find where this is used/i))
    await waitFor(() => expect(screen.getByText('Home')).toBeTruthy())

    rerender(<UsedByCard hostId="h1" kind="layout" id="l2" noun="layout" />)
    await waitFor(() =>
      expect(screen.getByText(/Find where this is used/i)).toBeTruthy(),
    )
    expect(screen.queryByText('Home')).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('a failed scan reads as a FAILURE, never as an empty list', async () => {
    // The card IS the answer here, unlike the delete confirmation's advisory
    // note — so "nothing uses this" after a network error would be the card
    // inviting the deletion it exists to prevent.
    fetchMock.mockResolvedValue({ ok: false, status: 500 })
    render(<UsedByCard hostId="h1" kind="component" id="c1" noun="component" />)
    fireEvent.click(screen.getByText(/Find where this is used/i))
    await waitFor(() =>
      expect(screen.getByText(/not the same as nothing using it/i)).toBeTruthy(),
    )
    expect(screen.queryByText(/Nothing uses this/i)).toBeNull()
  })
})
