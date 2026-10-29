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
 * The review bar on a page version's preview (AGL-3616): Publish does what
 * the page's own Publish does — the pointer on a live page, the route on one
 * that is not — after asking once, and is never offered where it cannot be
 * done, with the reason in view.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'

const mockSetDoc = jest.fn()
const mockPublishRoute = jest.fn()
const mockRevalidate = jest.fn()
const mockConfirm = jest.fn()
const mockRefuseForms = jest.fn()
const mockSnackbar = jest.fn()
let mockScreen: Record<string, unknown> | null = null
let mockHost: Record<string, unknown> = {}
let mockRole = { canPublish: true, loaded: true }

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useUser: () => ({ data: { uid: 'u1', getIdToken: async () => 'tok' } }),
  useFirestore: () => ({}),
  useScreen: () => ({ doc: { status: 'success', data: mockScreen ?? undefined }, setDoc: (...args: unknown[]) => mockSetDoc(...args) }),
}))
jest.mock('firebase/firestore', () => ({
  doc: (_firestore: unknown, ...path: string[]) => ({ path: path.join('/') }),
  collection: (_firestore: unknown, ...path: string[]) => ({ path: path.join('/') }),
  query: (ref: unknown) => ref,
  limit: () => null,
}))
jest.mock('../hooks/use-firestore-doc', () => ({
  __esModule: true,
  default: (read: () => { path: string }) =>
    read().path.includes('/versions/')
      ? { status: 'success', data: { nodes: {} } }
      : { status: 'success', data: mockHost },
}))
jest.mock('../hooks/use-firestore-collection', () => ({
  __esModule: true,
  default: () => ({ status: 'success', data: [{ $id: 'home', ...(mockScreen ?? {}) }] }),
}))
jest.mock('../hooks/use-host-role', () => ({ __esModule: true, default: () => mockRole }))
jest.mock('../hooks/use-forms-publish-block', () => ({
  __esModule: true,
  default: () => ({ refuse: (...args: unknown[]) => mockRefuseForms(...args) }),
}))
jest.mock('../hooks/use-host-activity-logger', () => ({ __esModule: true, default: () => jest.fn() }))
jest.mock('../constants/screen-publishing', () => ({
  publishScreenRoute: (...args: unknown[]) => mockPublishRoute(...args),
}))
jest.mock('../utils/revalidate-live-pages', () => ({
  revalidateLivePages: (...args: unknown[]) => mockRevalidate(...args),
  describeRevalidateShortfall: () => null,
}))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  AppLink: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
  useConfirmationContext: () => ({ confirm: (...args: unknown[]) => mockConfirm(...args) }),
}))
jest.mock('@aglyn/shared-ui-snackstack', () => ({ useSnackbar: () => ({ enqueueSnackbar: mockSnackbar }) }))

import { PREVIEW_STATE_KEY_PREFIX } from '../constants/preview-state'
import {
  REVIEW_PUBLISH_ROLE_REASON,
  REVIEW_SNAPSHOT_REASON,
  ScreenVersionReviewBar,
} from './screen-version-review-bar.component'

const show = () =>
  render(<ScreenVersionReviewBar hostId="host-1" orgSlug="acme" host="welder" screenId="home" versionId="v-ai" />)

beforeEach(() => {
  jest.clearAllMocks()
  window.localStorage.clear()
  mockConfirm.mockResolvedValue(undefined)
  mockRefuseForms.mockReturnValue(false)
  mockRevalidate.mockResolvedValue({ reason: 'ok' })
  mockPublishRoute.mockResolvedValue(undefined)
  mockSetDoc.mockResolvedValue(undefined)
  mockRole = { canPublish: true, loaded: true }
  mockHost = { screens: {} }
  mockScreen = { displayName: 'Home', slug: '/', versionId: 'v-ai' }
})

describe('ScreenVersionReviewBar', () => {
  it('opens the version in the Besigner', () => {
    show()
    expect(screen.getByRole('link', { name: 'Open in Besigner' }).getAttribute('href')).toBe(
      '/acme/hosts/welder/screens/home/versions/v-ai/besigner',
    )
  })

  it('puts a page that is not on the site at its address with this version, once asked', async () => {
    show()
    expect(screen.getByText('A draft. This page is not on your site yet.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }))
    await waitFor(() => expect(mockPublishRoute).toHaveBeenCalled())
    expect(mockConfirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Publish Home?', confirmationText: 'Publish' }))
    expect(mockPublishRoute.mock.calls[0][1]).toMatchObject({ hostId: 'host-1', screenId: 'home', versionId: 'v-ai' })
    expect(mockPublishRoute.mock.calls[0].slice(2)).toEqual(['/', '/'])
    expect(mockSetDoc).not.toHaveBeenCalled()
  })

  it('makes this version the one a live page serves, and drops the cached page', async () => {
    mockHost = { screens: { home: '/' } }
    mockScreen = { displayName: 'Home', slug: '/', versionId: 'v-live' }
    show()
    expect(screen.getByText('A draft. The live page at / shows another version.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }))
    await waitFor(() => expect(mockSetDoc).toHaveBeenCalledWith({ versionId: 'v-ai' }))
    expect(mockRevalidate).toHaveBeenCalledWith(expect.objectContaining({ hostId: 'host-1', screenId: 'home' }))
    expect(mockPublishRoute).not.toHaveBeenCalled()
  })

  it('publishes nothing the person did not confirm, or that carries a form on a site with Forms off', async () => {
    mockConfirm.mockRejectedValueOnce(undefined)
    show()
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }))
    await waitFor(() => expect(mockConfirm).toHaveBeenCalled())
    mockRefuseForms.mockReturnValueOnce(true)
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }))
    await waitFor(() => expect(mockRefuseForms).toHaveBeenCalledTimes(2))
    expect(mockPublishRoute).not.toHaveBeenCalled()
  })

  it('says the version is live and offers no Publish', () => {
    mockHost = { screens: { home: '/' } }
    show()
    expect(screen.getByText('This version is live at /.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Publish' })).toBeNull()
  })

  it('holds Publish with the reason where the role cannot publish, the page has no address, or a Besigner snapshot is shown', () => {
    mockRole = { canPublish: false, loaded: true }
    const { unmount } = show()
    expect(screen.getByText(REVIEW_PUBLISH_ROLE_REASON)).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Publish' }) as HTMLButtonElement).disabled).toBe(true)
    unmount()

    mockRole = { canPublish: true, loaded: true }
    mockScreen = { displayName: 'Home', slug: '', versionId: 'v-ai' }
    const second = show()
    expect(screen.getByText(/has no address yet/)).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Publish' }) as HTMLButtonElement).disabled).toBe(true)
    second.unmount()

    mockScreen = { displayName: 'Home', slug: '/', versionId: 'v-ai' }
    window.localStorage.setItem(`${PREVIEW_STATE_KEY_PREFIX}screen:host-1:home:v-ai`, JSON.stringify({ nodes: {}, updatedAt: 1 }))
    show()
    expect(screen.getByText(REVIEW_SNAPSHOT_REASON)).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Publish' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
