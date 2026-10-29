/**
 * @jest-environment jsdom
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored (feedback_jest_environment_pragma_shadowed_by_license).
 *
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
 * The listing editor's Category offers a site starter the kinds of site
 * (AGL-4049).
 *
 * It offered every listing the plugin taxonomy, so a starter filed under its
 * style's name ("Home services & trades") opened with a value the menu did not
 * have, and Save sent it to `categories`, which the server refused as outside
 * the taxonomy.
 */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { SITE_STYLES } from '@aglyn/aglyn/app-utils/site-styles'

const mockFetch = jest.fn()
jest.mock('@aglyn/shared-util-http/authorized-token', () => ({
  authorizedFetch: (...args: unknown[]) => mockFetch(...args),
}))
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: jest.fn() }),
}))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))
jest.mock('@aglyn/aglyn-markdown-editor', () => ({
  MarkdownField: () => null,
}))
jest.mock('@aglyn/aglyn', () => ({
  __esModule: true,
  ...jest.requireActual('@aglyn/aglyn'),
  useMediaPicker: () => ({ pickMedia: undefined }),
}))

import ListingDetailEditor from './listing-detail-editor.component'

const STYLE_NAMES = SITE_STYLES.map((style) => style.name)

beforeEach(() => {
  mockFetch.mockReset()
  mockFetch.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) })
})

function edit(listing: Record<string, unknown>) {
  render(
    <ListingDetailEditor
      orgId="org-1"
      listingId="listing-1"
      listing={{ $id: 'listing-1', displayName: 'A listing', ...listing }}
      user={{}}
      onDone={() => undefined}
    />,
  )
}

const category = () => screen.getByRole('combobox', { name: /^Category/ })
const optionsOf = async () => {
  fireEvent.mouseDown(category())
  return within(await screen.findByRole('listbox')).getAllByRole('option')
}

async function saveWithAgreement() {
  fireEvent.click(screen.getByRole('checkbox'))
  fireEvent.click(screen.getByRole('button', { name: 'Save listing' }))
  await waitFor(() => expect(mockFetch).toHaveBeenCalled())
  const [, , init] = mockFetch.mock.calls.at(-1) as [unknown, string, { body: string }]
  return JSON.parse(init.body)
}

describe('a site starter’s Category (AGL-4049)', () => {
  it('opens on the kind of site it is filed under', () => {
    edit({ artifactType: 'siteStarter', category: 'Home services & trades' })
    expect(category().textContent).toBe('Home services & trades')
  })

  it('offers the kinds of site, not the plugin taxonomy', async () => {
    edit({ artifactType: 'siteStarter', category: 'Home services & trades' })
    const labels = (await optionsOf()).map((option) => option.textContent)
    expect(labels).toEqual(['None', ...STYLE_NAMES])
    expect(labels).not.toContain('analytics')
  })

  it('keeps a category it has that is not a kind, rather than opening on nothing', async () => {
    edit({ artifactType: 'siteStarter', category: 'design' })
    expect(category().textContent).toBe('design')
    expect((await optionsOf()).map((option) => option.textContent)).toEqual(['None', ...STYLE_NAMES, 'design'])
  })

  it('saves the pick as the starter’s own category', async () => {
    edit({ artifactType: 'siteStarter', category: 'Home services & trades' })
    const portfolio = (await optionsOf()).find((option) => option.textContent === 'Portfolio') as HTMLElement
    fireEvent.click(portfolio)
    const body = await saveWithAgreement()
    expect(body).toMatchObject({ action: 'update-listing', listingId: 'listing-1', category: 'Portfolio' })
    expect(body).not.toHaveProperty('categories')
  })
})

describe('every other listing keeps the plugin taxonomy', () => {
  it('offers the fixed categories and saves them as before', async () => {
    edit({ artifactType: 'plugin', categories: ['seo'] })
    expect(category().textContent).toBe('seo')
    const labels = (await optionsOf()).map((option) => option.textContent)
    expect(labels).toContain('analytics')
    expect(labels).not.toContain('Portfolio')
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape' })
    const body = await saveWithAgreement()
    expect(body).toMatchObject({ categories: ['seo'] })
    expect(body).not.toHaveProperty('category')
  })
})
