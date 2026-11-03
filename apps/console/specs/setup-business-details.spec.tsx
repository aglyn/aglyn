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
 * @jest-environment jsdom
 */

/**
 * A site's business details are entered in ONE place, the Business details
 * card on Setup → Business profile (AGL-4136).
 *
 * Rendered through the REAL forms library and the real settings scope — not
 * the stand-in renderer the other hub specs use — because what is under test
 * is what the card's fields are and what pressing Update writes: the
 * canonical paths, the mirrors the native apps read, and the deletes a
 * cleared field needs. A stand-in form would submit whatever the spec told
 * it to and prove none of that.
 */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { setSeedConfirmWaitMs } from '@aglyn/tenant-feature-instance/hooks/helpers/listen-confirmation'
import { deleteField } from 'firebase/firestore'
import type { ReactNode } from 'react'

/** The setter's options with the site-wide outbox stager taken out (see host-setup-stale-seed). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- a jest.fn's calls are `any`
function withoutSiteWideEntry(call: any[]): any[] {
  const [payload, options] = call as [unknown, Record<string, unknown> | undefined]
  if (!options || !('alongside' in options)) return call
  const { alongside: _entry, ...rest } = options
  return [payload, Object.keys(rest).length ? rest : undefined]
}

const mockSetDoc = jest.fn().mockResolvedValue(undefined)
const mockEnqueueSnackbar = jest.fn()

/** A site saved before AGL-4136: its email and address only in the one-block copies. */
const mockHostDoc = {
  data: {
    $id: 'host-1',
    subdomain: 'acme',
    displayName: 'Acme',
    seo: { title: 'Acme Builders', entity: { telephone: '+1 512 555 0100' } },
    business: {
      supportEmail: 'help@acme.test',
      address: '1 Old Rd\nAustin',
      socialLinks: [{ label: 'Instagram', url: 'https://instagram.com/acme' }],
    },
  } as Record<string, unknown>,
  status: 'success' as 'success' | 'error',
  fromCache: false,
  hasEmitted: true,
}

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useHost: () => ({ doc: mockHostDoc, setDoc: mockSetDoc }),
  useUser: () => ({ data: { getIdToken: async () => 'token' } }),
  useFirestore: () => ({}),
  // The REAL guard: the card's save goes through it like every settings card.
  writeGuardedBySeed: jest.requireActual('@aglyn/tenant-feature-instance')
    .writeGuardedBySeed,
}))
// The page-wide loading bar needs its provider; a stand-in that hands back a
// release, as the bar does, is all the save asks of it.
jest.mock('@aglyn/shared-ui-jsx', () => ({
  ...jest.requireActual('@aglyn/shared-ui-jsx'),
  useLoading: () => ({ queueLoading: () => () => undefined }),
}))
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: mockEnqueueSnackbar }),
}))

const nullCard = { __esModule: true, default: () => null }
// The other two cards on the page read their own documents and are held by
// their own specs.
jest.mock('../components/business-profile-card.component', () => nullCard)
jest.mock('../components/plugin-widget-slot.component', () => ({
  ...nullCard,
  useSlotHasWidgets: () => ({ hasWidgets: false, ready: true }),
}))
jest.mock('../components/host-id-provider', () => ({
  useHostId: () => 'host-1',
  useHostSubdomain: () => 'acme',
  useIsHostAdmin: () => true,
}))
jest.mock('../hooks/use-org-scope', () => ({ useOrgSlug: () => 'acme-org' }))
jest.mock('../hooks/use-current-org', () => {
  const useCurrentOrg = () => ({ org: undefined, orgId: 'org-1', ready: true })
  return { __esModule: true, useCurrentOrg, default: useCurrentOrg }
})
jest.mock('../hooks/use-host-activity-logger', () => ({
  __esModule: true,
  default: () => () => undefined,
}))
jest.mock('../constants/docs-links', () => ({ docsHelp: () => undefined }))
jest.mock('next/navigation', () => ({
  usePathname: () => '/acme-org/hosts/acme/setup/business',
  useRouter: () => ({ replace: () => undefined, push: () => undefined }),
  useSearchParams: () => new URLSearchParams(''),
}))

/* eslint-disable @typescript-eslint/no-var-requires */
const HOST = '../app/(app)/[orgSlug]/hosts/[host]'
const { HostSettingsScopeProvider, HOST_SETTINGS_SCHEMAS } = require(`${HOST}/host-settings-scope`)
const BusinessSection = require(`${HOST}/setup/(sections)/business/page`).default
/* eslint-enable @typescript-eslint/no-var-requires */

const Page = ({ children }: { children?: ReactNode }) => (
  <HostSettingsScopeProvider>
    <BusinessSection />
    {children}
  </HostSettingsScopeProvider>
)

beforeAll(() => setSeedConfirmWaitMs(0))
afterAll(() => setSeedConfirmWaitMs())
beforeEach(() => {
  jest.clearAllMocks()
  mockHostDoc.fromCache = false
})

/**
 * The page, once its fields are drawn. The form's field components load on
 * demand, so the first render shows the card before its inputs.
 */
async function renderPage() {
  render(<Page />)
  await screen.findByLabelText('Business name', { selector: 'input' })
}

const input = (label: string) =>
  screen.getByLabelText(label, { selector: 'input' }) as HTMLInputElement
const type = (label: string, value: string) =>
  fireEvent.change(input(label), { target: { value } })

/** The payload of the one write the save made. */
async function savedPayload() {
  fireEvent.click(screen.getByRole('button', { name: 'Update' }))
  await waitFor(() => expect(mockSetDoc).toHaveBeenCalledTimes(1))
  const [payload, options] = withoutSiteWideEntry(mockSetDoc.mock.calls[0])
  expect(options).toEqual({ merge: true })
  return payload
}

describe('the Business details card on Setup → Business profile (AGL-4136)', () => {
  it('asks for every business detail, in one card', async () => {
    await renderPage()
    for (const label of [
      'Business name',
      'Slogan',
      'Phone',
      'Email',
      'Street',
      'City',
      'State or region',
      'Postal code',
      'Country',
    ]) {
      expect([label, input(label)]).toBeTruthy()
    }
    expect(screen.getByText('Social links')).toBeTruthy()
    // The social links are the stored ones, in the editor moved here.
    expect(screen.getByDisplayValue('https://instagram.com/acme')).toBeTruthy()
    // Where the rest of the business's facts live, with a link there.
    const note = screen.getByRole('link', { name: 'SEO → Local business' })
    expect(note.getAttribute('href')).toBe('/acme-org/hosts/acme/setup/seo')
  })

  it('shows the site’s one email, read from the older copy where the entity has none', async () => {
    await renderPage()
    expect(input('Email').value).toBe('help@acme.test')
    expect(input('Phone').value).toBe('+1 512 555 0100')
  })

  it('names what an empty business name stands for', async () => {
    await renderPage()
    expect(input('Business name').placeholder).toBe('Acme')
  })

  it('shows an older one-block address where the parts go, until they are filled in', async () => {
    await renderPage()
    expect(screen.getByText(/Your site shows “1 Old Rd, Austin” now/)).toBeTruthy()
  })

  it('saves the canonical paths and mirrors the email and the formatted address', async () => {
    await renderPage()
    type('Business name', 'Acme Builders')
    type('Slogan', 'Built right')
    type('Email', 'hello@acme.test')
    type('Street', '12 Bean St')
    type('City', 'Portland')
    type('State or region', 'OR')

    const payload = await savedPayload()
    expect(payload.seo.entity).toMatchObject({
      name: 'Acme Builders',
      slogan: 'Built right',
      telephone: '+1 512 555 0100',
      email: 'hello@acme.test',
      address: { streetAddress: '12 Bean St', addressLocality: 'Portland', addressRegion: 'OR' },
    })
    // The copies the native apps and older readers still read, kept in step.
    expect(payload.business.supportEmail).toBe('hello@acme.test')
    expect(payload.business.address).toBe('12 Bean St, Portland, OR')
    expect(payload.business.socialLinks).toEqual([
      { label: 'Instagram', url: 'https://instagram.com/acme' },
    ])
    // The site's own name is not this card's to change.
    expect(payload.displayName).toBeUndefined()
  })

  it('keeps the older address block through a save that never touched the address', async () => {
    await renderPage()
    type('Phone', '+1 512 555 0199')
    const payload = await savedPayload()
    expect(payload.seo.entity.telephone).toBe('+1 512 555 0199')
    expect(payload.business.address).toBe('1 Old Rd\nAustin')
  })

  it('deletes a cleared email and its copy, so the fallback cannot bring it back', async () => {
    await renderPage()
    type('Email', '')
    type('Phone', '')
    const payload = await savedPayload()
    expect(payload.business.supportEmail).toEqual(deleteField())
    expect(payload.seo.entity.telephone).toEqual(deleteField())
  })

  it('drops a removed social link, and a row left without an address', async () => {
    await renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'Add a link' }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove Instagram' }))
    const payload = await savedPayload()
    expect(payload.business.socialLinks).toEqual([])
  })

  it('refuses a save from a seed the server never confirmed, like every settings card', async () => {
    mockHostDoc.fromCache = true
    await renderPage()
    type('Slogan', 'Built right')
    fireEvent.click(screen.getByRole('button', { name: 'Update' }))
    await waitFor(() => expect(mockEnqueueSnackbar).toHaveBeenCalled())
    expect(mockSetDoc).not.toHaveBeenCalled()
    expect(mockEnqueueSnackbar.mock.calls[0][0]).toEqual(expect.stringMatching(/nothing was saved/i))
  })

  it('lists what pages can use, with this site’s values', async () => {
    await renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'Show what your pages can use' }))
    const list = within(screen.getByTestId('host-token-preview'))
    expect(list.getByText('{{host.phoneLink}}')).toBeTruthy()
    expect(list.getByText('tel:+15125550100')).toBeTruthy()
    expect(list.getByText('{{host.instagramUrl}}')).toBeTruthy()
    expect(list.getAllByText('https://instagram.com/acme').length).toBeGreaterThan(0)
  })
})

describe('the business details are declared once (AGL-4136)', () => {
  type Field = { name?: string; component?: unknown }
  const owners = (name: string) =>
    (HOST_SETTINGS_SCHEMAS as Array<{ id: string; fields: Field[] }>)
      .filter((schema) => schema.fields.some((field) => field.name === name))
      .map((schema) => schema.id)

  it.each([
    'seo.entity.name',
    'seo.entity.slogan',
    'seo.entity.telephone',
    'seo.entity.email',
    'seo.entity.address.streetAddress',
    'seo.entity.address.addressLocality',
    'seo.entity.address.addressRegion',
    'seo.entity.address.postalCode',
    'seo.entity.address.addressCountry',
    'business.socialLinks',
  ])('%s has one editor, Business details', (name) => {
    // One owner is also what routes the AI SEO audit's proposal for it to
    // this card's draft rather than dropping it.
    expect(owners(name)).toEqual(['hostBusinessDetails'])
  })
})
