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
 * WHAT GOES WITH THE SITE IS LISTED BEFORE IT GOES (AGL-4003).
 *
 * Deleting a site erases the datasets shared with it alone, with their
 * records. The card reads that list from `GET /api/hosts/delete` when it
 * opens and shows each dataset with its record count while the name is
 * typed, and the confirm dialog names how many go.
 */
import { render, screen, waitFor } from '@testing-library/react'

const mockAuthorizedFetch = jest.fn()
const mockConfirm = jest.fn()

jest.mock('@aglyn/shared-util-http/authorized-token', () => ({
  __esModule: true,
  authorizedFetch: (...args: unknown[]) => mockAuthorizedFetch(...args),
}))
jest.mock('@aglyn/tenant-feature-instance', () => ({
  __esModule: true,
  useUser: () => ({ data: { uid: 'u-1' } }),
}))
jest.mock('../hooks/use-host', () => ({
  __esModule: true,
  useHost: () => ({ doc: { data: { displayName: 'Laurel Fork', memberRoles: { 'u-1': 'admin' } } } }),
}))
jest.mock('../hooks/use-org-scope', () => ({ __esModule: true, useOrgSlug: () => 'acme' }))
jest.mock('next/navigation', () => ({ __esModule: true, useRouter: () => ({ push: jest.fn() }) }))
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  __esModule: true,
  useSnackbar: () => ({ enqueueSnackbar: jest.fn() }),
}))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  __esModule: true,
  useConfirmationContext: () => ({ confirm: mockConfirm }),
  CardDisplay: (props: { header: string; children: unknown }) => (
    <section aria-label={props.header}>{props.children as never}</section>
  ),
}))
jest.mock('../constants/docs-links', () => ({ __esModule: true, docsHelp: () => null }))
jest.mock('@aglyn/aglyn/app-utils/console/route-links', () => ({
  __esModule: true,
  buildRoute: () => '/acme/hosts',
  Route: { HOST_LIST: 'HOST_LIST' },
}))

import DeleteSiteCard, {
  DeleteSiteResources,
  deleteSiteConfirmText,
  deleteSiteItemCount,
  type DeleteSitePreview,
} from './delete-site-card.component'

const NOUNS = { noun: ['dataset', 'datasets'] as const, itemNoun: ['record', 'records'] as const }
const PREVIEW: DeleteSitePreview = {
  resources: [
    {
      pluginId: 'data',
      preview: {
        ...NOUNS,
        going: [
          { id: 'ds-1', name: 'Gallery collections', items: 12 },
          { id: 'ds-2', name: 'Photography packages', items: 1 },
        ],
        staying: 2,
      },
    },
  ],
}
const one = (going: Array<{ id: string; name: string; items: number | null }>, staying = 0): DeleteSitePreview => ({
  resources: [{ pluginId: 'data', preview: { ...NOUNS, going, staying } }],
})

beforeEach(() => {
  jest.clearAllMocks()
  mockAuthorizedFetch.mockResolvedValue({ ok: true, json: async () => PREVIEW })
})

describe('the Delete site card lists what goes with the site (AGL-4003)', () => {
  it('reads the preview for this site and lists each dataset with its records', async () => {
    render(<DeleteSiteCard hostId="host-1" />)

    expect(await screen.findByText('Gallery collections')).toBeTruthy()
    expect(screen.getByText('12 records')).toBeTruthy()
    expect(screen.getByText('Photography packages')).toBeTruthy()
    expect(screen.getByText('1 record')).toBeTruthy()
    expect(screen.getByText(/These 2 datasets are deleted with the site/)).toBeTruthy()
    expect(screen.getByText(/2 datasets this site shares with other sites stay/)).toBeTruthy()
    expect(screen.getByText(/AI jobs, AI insights, and Assist conversations/)).toBeTruthy()
    expect(mockAuthorizedFetch).toHaveBeenCalledWith(
      expect.objectContaining({ uid: 'u-1' }),
      '/api/hosts/delete?hostId=host-1',
    )
  })

  it('says so when no dataset goes, while it reads, and when the list could not be read', async () => {
    const { rerender } = render(<DeleteSiteResources preview={one([])} />)
    expect(screen.getByText(/No datasets are shared with this site only/)).toBeTruthy()

    rerender(<DeleteSiteResources preview={{ resources: [] }} />)
    expect(screen.getByText(/No datasets are shared with this site only/)).toBeTruthy()

    rerender(<DeleteSiteResources preview={null} />)
    expect(screen.getByText(/Could not list everything that goes with this site/)).toBeTruthy()
    expect(screen.queryByText(/No datasets are shared/)).toBeNull()

    rerender(<DeleteSiteResources preview={undefined} />)
    expect(screen.getByText(/Checking which datasets go with this site/)).toBeTruthy()
  })

  it('lists what it could read and says the rest is missing when one plugin could not answer', () => {
    render(
      <DeleteSiteResources
        preview={{
          resources: [
            { pluginId: 'broken', preview: null },
            ...one([{ id: 'ds-1', name: 'Gallery collections', items: 3 }], 1).resources,
          ],
        }}
      />,
    )
    expect(screen.getByText('Gallery collections')).toBeTruthy()
    expect(screen.getByText(/This dataset is deleted with the site, with its records/)).toBeTruthy()
    expect(screen.getByText(/One dataset this site shares with other sites stays/)).toBeTruthy()
    expect(screen.getByText(/Could not list everything that goes with this site/)).toBeTruthy()
  })

  it('shows the failure, not an empty list, when the route refuses', async () => {
    mockAuthorizedFetch.mockResolvedValue({ ok: false, json: async () => ({ error: 'no' }) })
    render(<DeleteSiteCard hostId="host-1" />)
    await waitFor(() => expect(screen.getByText(/Could not list everything that goes/)).toBeTruthy())
  })

  it('names in the confirm how many datasets go', () => {
    expect(deleteSiteConfirmText('Laurel Fork', PREVIEW)).toBe(
      '"Laurel Fork" and all of its pages, media, and settings, with the 2 datasets shared ' +
        "with this site only and their records, are permanently deleted. This can't be undone.",
    )
    expect(deleteSiteConfirmText('Laurel Fork', one([{ id: 'ds-1', name: 'A', items: 1 }]))).toContain(
      'with the dataset shared with this site only and its records,',
    )
    expect(deleteSiteConfirmText('Laurel Fork', one([]))).toBe(
      "\"Laurel Fork\" and all of its pages, media, and settings are permanently deleted. This can't be undone.",
    )
    expect(deleteSiteConfirmText('Laurel Fork', null)).toBe(
      "\"Laurel Fork\" and all of its pages, media, and settings are permanently deleted. This can't be undone.",
    )
  })

  it('counts items in words', () => {
    expect(deleteSiteItemCount(0, NOUNS.itemNoun)).toBe('0 records')
    expect(deleteSiteItemCount(1, NOUNS.itemNoun)).toBe('1 record')
    expect(deleteSiteItemCount(1200, NOUNS.itemNoun)).toBe('1,200 records')
    expect(deleteSiteItemCount(null, NOUNS.itemNoun)).toBe('Records not counted')
  })
})
