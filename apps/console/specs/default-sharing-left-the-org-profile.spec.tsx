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
 * Two settings left Settings → Profile, and this suite pins both moves by the
 * REQUEST each surface can make rather than by the words on it.
 *
 * 1. The billing address. `update-profile` posts the whole profile object, so
 *    the card must not carry address fields at all — a disabled input that is
 *    still in the payload is the same last-write-wins race with a nicer face.
 *
 * 2. `defaultResourceScope`, which decides what the next dataset or upload is
 *    shared with. It is not organization identity, and it now lives on the
 *    organization Media page beside the library those uploads land in.
 *
 * The third assertion here is a bug the move exposed rather than the move
 * itself: the control read `useOrgScope().currentOrg.defaultResourceScope`,
 * and `UserOrgMembership` has no such field — the value is on the org
 * document. So it answered `undefined` on every render and displayed the
 * "All sites" default to an organization actually stored as `host`.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'

/** The org DOCUMENT, where `defaultResourceScope` actually lives. */
let mockOrgDoc: Record<string, unknown> = {}
/** The MEMBERSHIP entry, which does not carry it — see the third test. */
let mockMembership: Record<string, unknown> = {}
/** Every body handed to `/api/orgs/settings`, in order. */
let mockRequests: Array<Record<string, unknown>> = []

jest.mock('@aglyn/shared-ui-snackstack', () => ({
  __esModule: true,
  useSnackbar: () => ({ enqueueSnackbar: () => undefined }),
}))

jest.mock('next/navigation', () => ({
  __esModule: true,
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/acme/settings/profile',
  useParams: () => ({ orgSlug: 'acme' }),
}))

/**
 * The logo field reaches the media library, a picker dialog and Firestore.
 * None of that is the subject, and mounting it would make this suite an
 * integration test of the DAM.
 */
jest.mock('../components/media-url-field.component', () => ({
  __esModule: true,
  default: () => null,
}))

jest.mock('../hooks/use-org-scope', () => {
  const scope = {
    orgs: [],
    // A getter, so a test can change the membership between renders without
    // handing the provider a fresh object every call (which is the shape that
    // manufactured the AGL-2105 render loop).
    get currentOrg() {
      return mockMembership
    },
    selectOrg: () => undefined,
    orgSlug: null,
    pathOrgSlug: 'acme',
    loading: false,
    confirmed: true,
    slugExists: true,
    error: false,
    retry: () => undefined,
    hasMoreOrgs: false,
    loadMoreOrgs: () => undefined,
  }
  return {
    __esModule: true,
    useOrgSlug: () => 'acme',
    useOrgScope: () => scope,
    default: () => scope,
  }
})

jest.mock('../hooks/use-current-org', () => ({
  __esModule: true,
  default: () => ({ org: mockOrgDoc, orgId: 'org-7', ready: true }),
  useCurrentOrg: () => ({ org: mockOrgDoc, orgId: 'org-7', ready: true }),
}))

jest.mock('../hooks/use-org-settings-request', () => {
  const send = async (body: Record<string, unknown>) => {
    mockRequests.push(body)
    return { ok: true }
  }
  return {
    __esModule: true,
    default: () => send,
    useOrgSettingsRequest: () => send,
  }
})

import OrgDefaultSharingCard from '../components/media/org-default-sharing-card.component'
import OrgProfileCard from '../components/settings/org-profile-card.component'

const ADDRESS = {
  line1: '4 Register Street',
  city: 'Austin',
  state: 'TX',
  postalCode: '78701',
  country: 'US',
}

beforeEach(() => {
  mockRequests = []
  mockMembership = { $id: 'org-7', role: 'owner', orgName: 'Acme' }
  mockOrgDoc = {
    $id: 'org-7',
    logoUrl: '',
    contact: {
      email: 'billing@example.test',
      phone: '+15125550101',
      website: 'https://example.test',
      address: { ...ADDRESS },
    },
  }
})

describe('the org profile card', () => {
  it('saves a profile that carries no address field', async () => {
    render(<OrgProfileCard />)
    fireEvent.click(screen.getByRole('button', { name: /save profile/i }))

    await waitFor(() => expect(mockRequests).toHaveLength(1))
    const [body] = mockRequests
    expect(body.action).toBe('update-profile')
    // The exact payload, not "no line1": a field added back under any name
    // would be posted to a route that ignores it, which is the silent-failure
    // shape this whole change exists to remove.
    expect(Object.keys(body).sort()).toEqual([
      'action',
      'contactEmail',
      'contactPhone',
      'contactWebsite',
      'logoUrl',
    ])
  })

  it('offers no select at all, so the sharing default cannot be set here', () => {
    render(<OrgProfileCard />)
    // Structural rather than textual: every control this card has left is a
    // text field. A returning `defaultResourceScope` dropdown — under any
    // label — puts a combobox back.
    expect(screen.queryAllByRole('combobox')).toHaveLength(0)
  })
})

describe('the default-sharing card on its new home', () => {
  it('posts the chosen scope to the settings route', async () => {
    render(<OrgDefaultSharingCard />)
    fireEvent.mouseDown(screen.getByRole('combobox'))
    fireEvent.click(
      screen.getByRole('option', {
        name: /only the site they were created in/i,
      }),
    )

    await waitFor(() => expect(mockRequests).toHaveLength(1))
    expect(mockRequests[0]).toEqual({
      action: 'set-default-resource-scope',
      defaultResourceScope: 'host',
    })
  })

  it('shows the value stored on the ORG DOCUMENT, not the membership', () => {
    mockOrgDoc = { ...mockOrgDoc, defaultResourceScope: 'host' }
    const { container } = render(<OrgDefaultSharingCard />)
    // The select's own form value, not its rendered label.
    expect(
      (container.querySelector('input') as HTMLInputElement | null)?.value,
    ).toBe('host')
  })

  it('NEGATIVE CONTROL: the membership entry is not consulted', () => {
    // `UserOrgMembership` carries role, orgName, slug and orgWide — never
    // `defaultResourceScope`. Reading it there is what produced a control
    // that always displayed "All sites". If a future edit points the card
    // back at `currentOrg`, this fixture makes it say `host` and this test
    // is the one that notices.
    mockMembership = { ...mockMembership, defaultResourceScope: 'host' }
    const { container } = render(<OrgDefaultSharingCard />)
    expect(
      (container.querySelector('input') as HTMLInputElement | null)?.value,
    ).toBe('org')
  })
})
