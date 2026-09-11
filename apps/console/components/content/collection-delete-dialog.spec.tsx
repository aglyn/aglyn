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
 * A collection delete names what links to its listing before the author
 * confirms (AGL-2806).
 *
 * A Screen Link, Button, Tabs link or any other link can point at a
 * collection's listing page (AGL-2799). A screen delete lists every link to
 * the screen first; the collection delete showed only its own blockers —
 * entries and template screens — and let a linked listing go without a word,
 * so its links broke on the live site before anyone had seen them.
 *
 * Rendered over the real MUI tree, with the scan handed in the way the page
 * hands it: already in flight when the dialog opens.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { fetchArtifactUsage } from '../artifacts/artifact-delete-confirm.component'
import type { ArtifactUsageScan } from '../artifacts/artifact-usage-copy'
import {
  CollectionDeleteDialog,
  type CollectionDeleteDialogProps,
} from './collection-delete-dialog.component'

const linkedFrom = (...names: string[]): Promise<ArtifactUsageScan | null> =>
  Promise.resolve({
    dependents: names.map((name) => ({
      type: 'screen' as const,
      id: name.toLowerCase(),
      name,
      relation: 'link' as const,
    })),
    complete: true,
  })

const baseProps = (
  overrides: Partial<CollectionDeleteDialogProps> = {},
): CollectionDeleteDialogProps => ({
  open: true,
  collection: { displayName: 'Blog', slug: 'blog' },
  denial: null,
  scan: linkedFrom(),
  confirmText: '',
  onConfirmTextChange: jest.fn(),
  busy: false,
  onClose: jest.fn(),
  onConfirm: jest.fn(),
  ...overrides,
})

const deleteButton = () =>
  screen.getByRole('button', { name: 'Delete collection' }) as HTMLButtonElement

describe('the collection delete dialog names links to the listing (AGL-2806)', () => {
  it('lists the documents that link to the listing, and what those links lose', async () => {
    render(
      <CollectionDeleteDialog
        {...baseProps({ scan: linkedFrom('Home', 'Site nav') })}
      />,
    )
    await waitFor(() =>
      expect(screen.getByText(/Used by 2 things: Home, Site nav\./)).toBeTruthy(),
    )
    expect(
      screen.getByText(/links stop working until you point them somewhere else/),
    ).toBeTruthy()
  })

  it('says the check is running until the scan lands', () => {
    render(
      <CollectionDeleteDialog
        {...baseProps({ scan: new Promise<never>(() => undefined) })}
      />,
    )
    expect(screen.getByText(/Checking where it is used/)).toBeTruthy()
  })

  it('says it could not check, never that nothing links, when the scan fails', async () => {
    // `fetchArtifactUsage` answers null for every failure, by design.
    render(
      <CollectionDeleteDialog {...baseProps({ scan: Promise.resolve(null) })} />,
    )
    await waitFor(() =>
      expect(screen.getByText(/could not check where it is used/i)).toBeTruthy(),
    )
    expect(screen.queryByText(/Nothing else references it/)).toBeNull()
  })

  it('says nothing links to it only when a complete scan found nothing', async () => {
    render(
      <CollectionDeleteDialog
        {...baseProps({ scan: Promise.resolve({ dependents: [], complete: true }) })}
      />,
    )
    await waitFor(() =>
      expect(screen.getByText(/Nothing else references it/)).toBeTruthy(),
    )
  })

  it('still names the links while entries refuse the delete', async () => {
    // The links will need repointing whichever blocker is cleared first, so a
    // refusal does not hide them.
    render(
      <CollectionDeleteDialog
        {...baseProps({
          denial: { error: '"Blog" still has 3 entries. Delete them first.' },
          scan: linkedFrom('Home'),
        })}
      />,
    )
    expect(screen.getByText(/still has 3 entries/)).toBeTruthy()
    await waitFor(() =>
      expect(screen.getByText(/Used by 1 thing: Home\./)).toBeTruthy(),
    )
    expect(deleteButton().disabled).toBe(true)
  })

  it('arms Delete only for the exact display name', () => {
    const onConfirm = jest.fn()
    const { rerender } = render(
      <CollectionDeleteDialog {...baseProps({ confirmText: 'blog', onConfirm })} />,
    )
    expect(deleteButton().disabled).toBe(true)
    rerender(
      <CollectionDeleteDialog {...baseProps({ confirmText: 'Blog', onConfirm })} />,
    )
    expect(deleteButton().disabled).toBe(false)
    fireEvent.click(deleteButton())
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })
})

describe('the scan the page starts asks about the collection (AGL-2806)', () => {
  const originalFetch = global.fetch

  afterEach(() => {
    global.fetch = originalFetch
  })

  it('posts the collection kind and id to the where-used endpoint', async () => {
    const fetchMock = jest.fn(async (_url: string, _init: RequestInit) => ({
      ok: true,
      json: async () => ({ dependents: [], complete: true }),
    }))
    global.fetch = fetchMock as unknown as typeof fetch
    await fetchArtifactUsage({
      hostId: 'host-1',
      kind: 'collection',
      id: 'yQuEudFcgR',
      user: { uid: 'uid-1', getIdToken: async () => 'token' } as never,
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe('/api/hosts/where-used')
    expect(JSON.parse(String(fetchMock.mock.calls[0][1].body))).toEqual({
      hostId: 'host-1',
      kind: 'collection',
      id: 'yQuEudFcgR',
    })
  })
})
