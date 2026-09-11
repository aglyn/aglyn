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
 * Adding a members video makes the file private, and says what that breaks
 * first (AGL-2814).
 *
 * The routes are the real contract here: `/api/media/references` answers
 * where the file is used, `/api/media/folders {action:'set-private'}` makes it
 * private. They are answered by a fake `authorizedFetch` so the assertions are
 * about the requests the editor sends and what it does with each answer.
 */

import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from '@testing-library/react'
import { MediaPickerContext, type PickedMedia } from '@aglyn/aglyn'
import {
  MembersVideosField,
  paidMediaConfirmation,
  paidMediaScopeBody,
  usePaidMediaAttach,
  usesBesideProduct,
} from './paid-media'

const mockAuthorizedFetch = jest.fn()
jest.mock('@aglyn/shared-util-http/authorized-token', () => ({
  authorizedFetch: (...args: unknown[]) => mockAuthorizedFetch(...args),
}))

const mockConfirm = jest.fn()
jest.mock('@aglyn/shared-ui-jsx', () => ({
  useConfirmationContext: () => ({ confirm: mockConfirm }),
}))

const mockEnqueueSnackbar = jest.fn()
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: mockEnqueueSnackbar }),
}))

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useUser: () => ({ data: { uid: 'uid-editor', getIdToken: jest.fn() } }),
}))

jest.mock('firebase/firestore', () => ({
  doc: jest.fn(),
  getDoc: jest.fn(),
}))

const HOST = 'host-1'
const PRODUCT = 'prod-course'

const answer = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
})

/** Which route each request went to, with its parsed body. */
function requests(): { url: string; body: Record<string, unknown> }[] {
  return mockAuthorizedFetch.mock.calls.map(([, url, init]) => ({
    url: String(url),
    body: JSON.parse(String(init?.body ?? '{}')),
  }))
}

function routes(handlers: {
  references?: () => unknown
  folders?: () => unknown
}) {
  mockAuthorizedFetch.mockImplementation(async (_user: unknown, url: string) => {
    if (url === '/api/media/references') {
      if (!handlers.references) throw new Error('unexpected references call')
      return handlers.references()
    }
    if (url === '/api/media/folders') {
      if (!handlers.folders) throw new Error('unexpected folders call')
      return handlers.folders()
    }
    throw new Error(`unexpected request to ${url}`)
  })
}

const publicFilm: PickedMedia = {
  url: '/api/media/cdn/org:acme/med-film',
  fileName: 'week-1.mp4',
  mediaId: 'med-film',
  mediaScope: 'org:acme',
}

async function attach(picked: PickedMedia) {
  const { result } = renderHook(() =>
    usePaidMediaAttach({ hostId: HOST, productId: PRODUCT }),
  )
  let stored: string | null = null
  await act(async () => {
    stored = await result.current.attach(picked)
  })
  return stored
}

beforeEach(() => {
  mockAuthorizedFetch.mockReset()
  mockConfirm.mockReset().mockResolvedValue(undefined)
  mockEnqueueSnackbar.mockReset()
})

describe('the pure pieces', () => {
  it('names an asset’s library the way the media routes read it', () => {
    expect(paidMediaScopeBody('org:acme')).toEqual({ orgId: 'acme' })
    expect(paidMediaScopeBody('org:acme:host-1')).toEqual({ orgId: 'acme' })
    expect(paidMediaScopeBody('host-1')).toEqual({ hostId: 'host-1' })
  })

  it('does not count this product as a place making the file private breaks', () => {
    const own = {
      kind: 'plugin',
      collectionId: 'products',
      id: PRODUCT,
      hostId: HOST,
      name: 'Training program',
    }
    const page = { kind: 'screen', id: 'home', hostId: HOST, name: 'Home' }
    const otherProduct = { ...own, id: 'prod-other', name: 'Other course' }
    const sameIdOtherSite = { ...own, hostId: 'host-2' }
    expect(
      usesBesideProduct([own, page, otherProduct, sameIdOtherSite], {
        hostId: HOST,
        productId: PRODUCT,
      }),
    ).toEqual([page, otherProduct, sameIdOtherSite])
    // A product not saved yet has no row of its own to exclude.
    expect(usesBesideProduct([own], { hostId: HOST })).toEqual([own])
  })

  it('tells the author what making it private breaks, and what it could not check', () => {
    const page = (name: string) => ({ kind: 'screen', id: name, hostId: HOST, name })
    expect(paidMediaConfirmation({ others: [], checked: 'full' })).toContain(
      'Nothing else uses it.',
    )
    expect(
      paidMediaConfirmation({
        others: ['Home', 'Trailer', 'Blog', 'About'].map(page),
        checked: 'full',
      }),
    ).toContain('It is also used on “Home”, “Trailer”, “Blog” and 1 more, and it stops showing there.')
    expect(paidMediaConfirmation({ others: [], checked: 'partial' })).toContain(
      'could not check everywhere',
    )
    expect(paidMediaConfirmation({ others: [], checked: 'failed' })).toContain(
      'could not check where else',
    )
    expect(paidMediaConfirmation({ others: [], checked: 'full' })).toContain(
      'Any public link to it that was already shared stops working too.',
    )
  })
})

describe('AGL-2814 · adding a members video', () => {
  it('stores the reference of a file that is already private, asking nothing', async () => {
    const stored = await attach({
      url: 'media:org:acme/med-film',
      mediaId: 'med-film',
      mediaScope: 'org:acme',
      private: true,
    })
    expect(stored).toBe('media:org:acme/med-film')
    expect(mockAuthorizedFetch).not.toHaveBeenCalled()
    expect(mockConfirm).not.toHaveBeenCalled()
  })

  it('makes a public file private after the author confirms, and stores its reference', async () => {
    routes({
      references: () => answer(200, { references: [], complete: true }),
      folders: () => answer(200, { ok: true, private: true, rawUrlCleared: true }),
    })
    const stored = await attach(publicFilm)
    expect(stored).toBe('media:org:acme/med-film')
    expect(requests()).toEqual([
      {
        url: '/api/media/references',
        body: { orgId: 'acme', mediaId: 'med-film' },
      },
      {
        url: '/api/media/folders',
        body: {
          orgId: 'acme',
          action: 'set-private',
          mediaId: 'med-film',
          private: true,
        },
      },
    ])
    expect(mockConfirm.mock.calls[0][0].description).toContain(
      'Nothing else uses it.',
    )
  })

  it('names the pages a reused file is on, and adds nothing when the author cancels', async () => {
    routes({
      references: () =>
        answer(200, {
          references: [
            { kind: 'screen', id: 'home', hostId: HOST, name: 'Home' },
            {
              kind: 'plugin',
              collectionId: 'products',
              id: PRODUCT,
              hostId: HOST,
              name: 'Training program',
            },
          ],
          complete: true,
        }),
    })
    mockConfirm.mockRejectedValue(undefined)
    expect(await attach(publicFilm)).toBeNull()
    expect(mockConfirm.mock.calls[0][0].description).toContain(
      'It is also used on “Home”, and it stops showing there.',
    )
    expect(requests().map((request) => request.url)).toEqual([
      '/api/media/references',
    ])
  })

  it('⛔ adds nothing when the file could not be made private, and says why', async () => {
    routes({
      references: () => answer(200, { references: [], complete: true }),
      folders: () =>
        answer(403, { error: 'Only an organization admin can change this' }),
    })
    expect(await attach(publicFilm)).toBeNull()
    expect(mockEnqueueSnackbar).toHaveBeenCalledWith(
      'Only an organization admin can change this. The video was not added.',
      expect.objectContaining({ variant: 'error' }),
    )
  })

  it('still asks, and says so, when the usage scan fails', async () => {
    routes({
      references: () => {
        throw new Error('offline')
      },
      folders: () => answer(200, { ok: true, rawUrlCleared: true }),
    })
    expect(await attach(publicFilm)).toBe('media:org:acme/med-film')
    expect(mockConfirm.mock.calls[0][0].description).toContain(
      'could not check where else',
    )
  })

  it('warns when an old public link could not be confirmed dead, and still adds the video', async () => {
    routes({
      references: () => answer(200, { references: [], complete: true }),
      folders: () => answer(200, { ok: true, rawUrlCleared: false }),
    })
    expect(await attach(publicFilm)).toBe('media:org:acme/med-film')
    expect(mockEnqueueSnackbar).toHaveBeenCalledWith(
      expect.stringContaining('could not be confirmed dead'),
      expect.objectContaining({ variant: 'warning' }),
    )
  })

  it('⛔ refuses a pick that names no library file', async () => {
    expect(
      await attach({ url: 'https://videos.example.com/w1.m3u8' }),
    ).toBeNull()
    expect(mockAuthorizedFetch).not.toHaveBeenCalled()
    expect(mockEnqueueSnackbar).toHaveBeenCalledWith(
      'Choose the video from the media library, so its links can expire.',
      expect.objectContaining({ variant: 'warning' }),
    )
  })

  it('opens the picker for private files, and adds what it attached', async () => {
    const pickMedia = jest.fn().mockResolvedValue({
      url: 'media:org:acme/med-film',
      fileName: 'week-1.mp4',
      mediaId: 'med-film',
      mediaScope: 'org:acme',
      private: true,
    })
    const onChange = jest.fn()
    render(
      <MediaPickerContext.Provider value={{ pickMedia }}>
        <MembersVideosField
          hostId={HOST}
          productId={PRODUCT}
          videos={[]}
          onChange={onChange}
        />
      </MediaPickerContext.Provider>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Add members video' }))
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith([
        { url: 'media:org:acme/med-film', title: 'week-1.mp4' },
      ]),
    )
    expect(pickMedia).toHaveBeenCalledWith({ allowPrivate: true })
  })

  it('makes a site-library file private through the site’s own scope', async () => {
    routes({
      references: () => answer(200, { references: [], complete: true }),
      folders: () => answer(200, { ok: true, rawUrlCleared: true }),
    })
    const stored = await attach({
      url: 'https://firebasestorage.googleapis.com/v0/b/b/o/x?token=t',
      mediaId: 'med-film',
      mediaScope: HOST,
    })
    expect(stored).toBe(`media:${HOST}/med-film`)
    expect(requests().map((request) => request.body['hostId'])).toEqual([
      HOST,
      HOST,
    ])
  })
})
