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

import { mockWindow, PHONE, TABLET } from '../spec-native-mocks'

const mockAccess = {
  value: { loaded: true, role: 'owner' as string | null, orgWide: true, tokens: ['org'] as string[], member: null, hostAccess: {} },
}
const mockDocs: Record<string, unknown> = {}
const mockUpload = jest.fn()
const mockReplace = jest.fn()
const mockList = {
  options: null as any,
  state: { rows: [] as any[], ready: true, error: null as Error | null, hasMore: false, loadMore: jest.fn() },
}
const mockFolders = { options: null as any, rows: [] as any[] }

jest.mock('@aglyn/mobile-core', () => ({
  DEFAULT_CONSOLE_ORIGIN: 'https://app.aglyn.com',
  getMobileConfig: () => ({ consoleOrigin: 'https://app.aglyn.com' }),
  searchWords: (text: string) => text.split(/\s+/).filter(Boolean),
  useOrgAccess: () => mockAccess.value,
  useLiveDoc: (_firestore: unknown, path: string[] | null) => {
    if (!path) return { data: null, ready: false, error: null }
    const key = path.join('/')
    return key in mockDocs ? { data: mockDocs[key], ready: true, error: null } : { data: null, ready: true, error: null }
  },
  uploadMedia: (...args: unknown[]) => mockUpload(...args),
  replaceMedia: (...args: unknown[]) => mockReplace(...args),
}))
jest.mock('./use-media', () => ({
  useLivePlan: (options: unknown) => {
    mockList.options = options
    return mockList.state
  },
  useMediaFolders: (options: unknown) => {
    mockFolders.options = options
    return mockFolders.rows
  },
}))
jest.mock('expo-image-picker', () => ({
  requestCameraPermissionsAsync: jest.fn(),
  requestMediaLibraryPermissionsAsync: jest.fn(),
  launchCameraAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
}))

import { fireEvent, render, screen, waitFor } from '@testing-library/react-native'
import * as ImagePicker from 'expo-image-picker'
import { Linking } from 'react-native'
import { captureAlerts, fakeContext } from '../spec-support'
import { damTransport, putFile, readBase64 } from './device-files'
import { libraryFor } from './library-access'
import MediaItemScreen from './media-item-screen'
import { canWriteLibrary, mediaImageUrl, mediaViewQuery } from './media-model'
import MediaScreen from './media-screen'

const picker = ImagePicker as jest.Mocked<typeof ImagePicker>

const PHOTO = {
  $id: 'm1',
  fileName: 'storefront.jpg',
  contentType: 'image/jpeg',
  kind: 'image',
  sizeBytes: 1_258_291,
  width: 1600,
  height: 1067,
  alt: 'The bakery storefront at dawn',
  cdnPath: '/api/media/cdn/site-1/m1',
  updatedAt: { seconds: 1_790_000_000 },
}

const PICKED = {
  canceled: false,
  assets: [{ uri: 'file:///tmp/IMG_0001.jpg', fileName: 'IMG_0001.jpg', mimeType: 'image/jpeg', fileSize: 204_800, width: 3, height: 2 }],
}

beforeEach(() => {
  jest.clearAllMocks()
  mockWindow.size = PHONE
  mockAccess.value = { loaded: true, role: 'owner', orgWide: true, tokens: ['org'], member: null, hostAccess: {} }
  for (const key of Object.keys(mockDocs)) delete mockDocs[key]
  mockDocs['hosts/site-1'] = { memberRoles: { 'owner-uid': 'admin' } }
  mockList.state = { rows: [], ready: true, error: null, hasMore: false, loadMore: jest.fn() }
  mockFolders.rows = []
  mockUpload.mockReset().mockResolvedValue({ mediaId: 'm-new', url: '/api/media/cdn/site-1/m-new' })
  mockReplace.mockReset().mockResolvedValue(undefined)
  picker.requestCameraPermissionsAsync.mockResolvedValue({ granted: true, canAskAgain: true } as never)
  picker.requestMediaLibraryPermissionsAsync.mockResolvedValue({ granted: true, canAskAgain: true } as never)
  picker.launchImageLibraryAsync.mockResolvedValue(PICKED as never)
  picker.launchCameraAsync.mockResolvedValue(PICKED as never)
})

afterEach(() => jest.restoreAllMocks())

describe('the media library query', () => {
  it("is the console's: an org-wide reader's carries no scope clause", () => {
    const plan = mediaViewQuery({ type: 'image', folder: 'root', sort: 'newest', search: [] }, null)
    expect(plan.filters).toEqual(
      expect.arrayContaining([
        { path: 'folderId', op: '==', value: null },
        { path: 'kind', op: '==', value: 'image' },
      ]),
    )
    expect(plan.filters.some((filter) => filter.path === 'visibleTo')).toBe(false)
    expect(plan.orderBy).toEqual(expect.objectContaining({ path: 'createdAt', direction: 'desc' }))
  })

  it("a scoped reader's carries the scope clause, and searches by name", () => {
    const plan = mediaViewQuery({ type: 'all', folder: 'f1', sort: 'name', search: ['store'] }, ['host:site-1'])
    expect(plan.filters).toEqual(
      expect.arrayContaining([
        { path: 'folderId', op: '==', value: 'f1' },
        { path: 'visibleTo', op: 'array-contains-any', value: ['host:site-1'] },
      ]),
    )
    expect(plan.notices[0]).toMatch(/starts with/)
  })

  it('lets a site writer and a workspace editor upload, never a viewer', () => {
    expect(canWriteLibrary({ kind: 'site', hostId: 's' }, { orgRole: 'viewer', hostRole: 'author' })).toBe(true)
    expect(canWriteLibrary({ kind: 'site', hostId: 's' }, { orgRole: 'owner', hostRole: 'viewer' })).toBe(false)
    expect(canWriteLibrary({ kind: 'org', orgId: 'o' }, { orgRole: 'editor', hostRole: null })).toBe(true)
    expect(canWriteLibrary({ kind: 'org', orgId: 'o' }, { orgRole: 'viewer', hostRole: null })).toBe(false)
  })

  it("picks the library a link names, else the picked site's", () => {
    const context = { hostId: 'site-1', orgId: 'org-1' }
    expect(libraryFor({}, context)).toEqual({ kind: 'site', hostId: 'site-1' })
    expect(libraryFor({ orgSlug: 'acme' }, context)).toEqual({ kind: 'org', orgId: 'org-1' })
    expect(libraryFor({ orgSlug: 'acme', hostSlug: 'shop' }, context)).toEqual({ kind: 'site', hostId: 'site-1' })
    expect(libraryFor({ library: 'org', scopeId: 'org-9' }, context)).toEqual({ kind: 'org', orgId: 'org-9' })
  })

  it('serves a thumbnail from the CDN path at a width, else the stored URL', () => {
    expect(mediaImageUrl({ cdnPath: '/api/media/cdn/s/m' }, 'https://app.aglyn.com/', 320)).toBe(
      'https://app.aglyn.com/api/media/cdn/s/m?w=320',
    )
    expect(mediaImageUrl({ url: 'https://storage.example/m.jpg' }, 'https://app.aglyn.com', 320)).toBe(
      'https://storage.example/m.jpg',
    )
  })
})

describe('MediaScreen', () => {
  it('shows loading, error and empty states', async () => {
    mockList.state = { ...mockList.state, ready: false }
    const view = await render(<MediaScreen params={{}} context={fakeContext()} />)
    expect(screen.getByTestId('media-loading')).toBeTruthy()
    mockList.state = { ...mockList.state, ready: true, error: new Error('denied') }
    await view.rerender(<MediaScreen params={{}} context={fakeContext()} />)
    expect(screen.getByText('This library could not be loaded')).toBeTruthy()
    mockList.state = { ...mockList.state, error: null }
    await view.rerender(<MediaScreen params={{}} context={fakeContext()} />)
    expect(screen.getByText('No files yet')).toBeTruthy()
  })

  it("reads the picked site's library, filters by type, and switches to the workspace's", async () => {
    await render(<MediaScreen params={{}} context={fakeContext()} />)
    expect(mockList.options.path).toEqual(['hosts', 'site-1', 'media'])
    await fireEvent.press(screen.getByTestId('media-type-pdf'))
    expect(mockList.options.plan.filters).toEqual(expect.arrayContaining([{ path: 'kind', op: '==', value: 'pdf' }]))
    await fireEvent.press(screen.getByTestId('media-library-org:org-1'))
    expect(mockList.options.path).toEqual(['orgs', 'org-1', 'media'])
    expect(mockFolders.options.path).toEqual(['orgs', 'org-1', 'mediaFolders'])
  })

  it('holds a scoped reader to their scope and waits for it', async () => {
    mockAccess.value = { ...mockAccess.value, role: 'editor', orgWide: false, tokens: ['host:site-1'], loaded: false }
    const view = await render(<MediaScreen params={{ library: 'org', scopeId: 'org-1' }} context={fakeContext()} />)
    expect(mockList.options.enabled).toBe(false)
    mockAccess.value = { ...mockAccess.value, loaded: true }
    await view.rerender(<MediaScreen params={{ library: 'org', scopeId: 'org-1' }} context={fakeContext()} />)
    expect(mockList.options.enabled).toBe(true)
    expect(mockList.options.plan.filters).toEqual(
      expect.arrayContaining([{ path: 'visibleTo', op: 'array-contains-any', value: ['host:site-1'] }]),
    )
  })

  it('pushes a file on a phone and shows it beside the grid on a tablet', async () => {
    mockList.state = { ...mockList.state, rows: [PHOTO] }
    mockDocs['hosts/site-1/media/m1'] = PHOTO
    const context = fakeContext()
    const view = await render(<MediaScreen params={{}} context={context} />)
    await fireEvent.press(screen.getByTestId('media-m1'))
    expect(context.navigate).toHaveBeenCalledWith('workspace.mediaItem', { mediaId: 'm1', library: 'site', scopeId: 'site-1' })
    await view.unmount()

    mockWindow.size = TABLET
    const tablet = fakeContext()
    await render(<MediaScreen params={{}} context={tablet} />)
    expect(screen.getByTestId('split-view')).toBeTruthy()
    await fireEvent.press(screen.getByTestId('media-m1'))
    expect(tablet.navigate).not.toHaveBeenCalled()
    expect(screen.getByText('1.2 MB')).toBeTruthy()
  })

  it('offers no upload to a viewer', async () => {
    mockDocs['hosts/site-1'] = { memberRoles: { 'owner-uid': 'viewer' } }
    await render(<MediaScreen params={{}} context={fakeContext()} />)
    expect(screen.queryByTestId('media-upload')).toBeNull()
  })

  it('uploads a photo from the library through the DAM routes, into the open folder', async () => {
    mockFolders.rows = [{ $id: 'f1', name: 'Storefront' }]
    const context = fakeContext()
    await render(<MediaScreen params={{}} context={context} />)
    await fireEvent.press(screen.getByTestId('media-folder-f1'))
    await fireEvent.press(screen.getByTestId('media-upload'))
    await fireEvent.press(screen.getByTestId('photo-source-library'))
    await waitFor(() => expect(mockUpload).toHaveBeenCalled(), { timeout: 2000 })
    expect(picker.requestMediaLibraryPermissionsAsync).toHaveBeenCalled()
    expect(picker.launchImageLibraryAsync).toHaveBeenCalledWith(expect.objectContaining({ mediaTypes: ['images'] }))
    const [transport, firestore, input] = mockUpload.mock.calls[0]
    expect(transport.api).toBe(context.api)
    expect(firestore).toBe(context.firestore)
    expect(input).toEqual({
      scope: { hostId: 'site-1' },
      folderId: 'f1',
      file: { uri: 'file:///tmp/IMG_0001.jpg', fileName: 'IMG_0001.jpg', contentType: 'image/jpeg', sizeBytes: 204_800 },
    })
  })

  it('takes a photo with the camera', async () => {
    await render(<MediaScreen params={{}} context={fakeContext()} />)
    await fireEvent.press(screen.getByTestId('media-upload'))
    await fireEvent.press(screen.getByTestId('photo-source-camera'))
    await waitFor(() => expect(mockUpload).toHaveBeenCalled(), { timeout: 2000 })
    expect(picker.requestCameraPermissionsAsync).toHaveBeenCalled()
    expect(mockUpload.mock.calls[0][2].folderId).toBeNull()
  })

  it('says when photo access is off, and offers Settings once the system will not ask', async () => {
    const alerts = captureAlerts()
    const settings = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined)
    picker.requestMediaLibraryPermissionsAsync.mockResolvedValue({ granted: false, canAskAgain: false } as never)
    await render(<MediaScreen params={{}} context={fakeContext()} />)
    await fireEvent.press(screen.getByTestId('media-upload'))
    await fireEvent.press(screen.getByTestId('photo-source-library'))
    await waitFor(() => expect(alerts.shown).toHaveLength(1), { timeout: 2000 })
    expect(alerts.last().title).toBe('Photo access is off')
    alerts.press('Open Settings')
    expect(settings).toHaveBeenCalled()
    expect(picker.launchImageLibraryAsync).not.toHaveBeenCalled()
    expect(mockUpload).not.toHaveBeenCalled()
  })

  it("shows the route's refusal when an upload is refused", async () => {
    const alerts = captureAlerts()
    mockUpload.mockRejectedValue(new Error('Your plan does not include more storage'))
    await render(<MediaScreen params={{}} context={fakeContext()} />)
    await fireEvent.press(screen.getByTestId('media-upload'))
    await fireEvent.press(screen.getByTestId('photo-source-library'))
    await waitFor(() => expect(alerts.shown).toHaveLength(1), { timeout: 2000 })
    expect(alerts.last()).toEqual(
      expect.objectContaining({ title: 'Could not upload the photo', message: 'Your plan does not include more storage' }),
    )
  })
})

describe('the media detail', () => {
  const open = () =>
    render(<MediaItemScreen params={{ mediaId: 'm1', library: 'site', scopeId: 'site-1' }} context={context} />)
  let context = fakeContext()
  beforeEach(() => {
    context = fakeContext()
    mockDocs['hosts/site-1/media/m1'] = PHOTO
  })

  it('shows the preview, size, dimensions and alt text', async () => {
    await open()
    expect(screen.getByTestId('media-preview').props.source).toEqual({
      uri: 'https://app.aglyn.com/api/media/cdn/site-1/m1?w=1280',
    })
    expect(screen.getByText('1.2 MB')).toBeTruthy()
    expect(screen.getByText('1600 × 1067')).toBeTruthy()
    expect(screen.getByText('The bakery storefront at dawn')).toBeTruthy()
  })

  it("falls back to the file's icon when the preview will not load", async () => {
    await open()
    await fireEvent(screen.getByTestId('media-preview'), 'error')
    expect(screen.queryByTestId('media-preview')).toBeNull()
  })

  it('replaces the file in place, asking first and carrying the revision it read', async () => {
    const alerts = captureAlerts()
    await open()
    await fireEvent.press(screen.getByTestId('media-replace'))
    await fireEvent.press(screen.getByTestId('photo-source-library'))
    await waitFor(() => expect(alerts.shown).toHaveLength(1), { timeout: 2000 })
    expect(alerts.last().title).toBe('Replace this file?')
    expect(mockReplace).not.toHaveBeenCalled()
    alerts.press('Replace')
    await waitFor(() => expect(mockReplace).toHaveBeenCalled())
    const [transport, input] = mockReplace.mock.calls[0]
    expect(transport.api).toBe(context.api)
    expect(input).toEqual({
      scope: { hostId: 'site-1' },
      mediaId: 'm1',
      expectedUpdatedAtMs: 1_790_000_000_000,
      file: expect.objectContaining({ uri: 'file:///tmp/IMG_0001.jpg', contentType: 'image/jpeg' }),
    })
  })

  it('does not replace when the person cancels, and shows a refusal', async () => {
    const alerts = captureAlerts()
    await open()
    await fireEvent.press(screen.getByTestId('media-replace'))
    await fireEvent.press(screen.getByTestId('photo-source-camera'))
    await waitFor(() => expect(alerts.shown).toHaveLength(1), { timeout: 2000 })
    alerts.press('Cancel')
    expect(mockReplace).not.toHaveBeenCalled()

    mockReplace.mockRejectedValue(new Error('This file changed since you opened it'))
    await fireEvent.press(screen.getByTestId('media-replace'))
    await fireEvent.press(screen.getByTestId('photo-source-camera'))
    await waitFor(() => expect(alerts.shown).toHaveLength(2), { timeout: 2000 })
    alerts.press('Replace')
    await waitFor(() => expect(alerts.shown).toHaveLength(3))
    expect(alerts.last().message).toBe('This file changed since you opened it')
  })

  it('offers no replace for a file that is not an image, or to a reader who cannot write', async () => {
    mockDocs['hosts/site-1/media/m1'] = { ...PHOTO, kind: 'pdf', contentType: 'application/pdf' }
    const first = await open()
    expect(screen.queryByTestId('media-replace')).toBeNull()
    await first.unmount()
    mockDocs['hosts/site-1/media/m1'] = PHOTO
    mockDocs['hosts/site-1'] = { memberRoles: { 'owner-uid': 'viewer' } }
    await open()
    expect(screen.queryByTestId('media-replace')).toBeNull()
    expect(screen.queryByTestId('media-usage')).toBeNull()
  })

  it("asks the console's reference scan where it is used", async () => {
    context.api.request.mockResolvedValue({
      references: [{ kind: 'screen', id: 'home', name: 'Home', hostSubdomain: 'shop', live: true }],
      coverage: 'full',
    })
    await open()
    await fireEvent.press(screen.getByTestId('media-usage'))
    expect(context.api.request).toHaveBeenCalledWith('/api/media/references', {
      method: 'POST',
      body: { hostId: 'site-1', mediaId: 'm1' },
    })
    await waitFor(() => expect(screen.getByText('Home')).toBeTruthy())
    expect(screen.getByText('Page · shop · Published')).toBeTruthy()
  })
})

describe('the device file transport', () => {
  const blob = { size: 9, type: 'image/png' }
  beforeEach(() => {
    ;(global as any).fetch = jest.fn(async (url: string, init?: { method?: string }) =>
      init?.method === 'PUT' ? { ok: true, status: 200 } : { ok: true, blob: async () => blob },
    )
    ;(global as any).FileReader = class {
      result: string | null = null
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      readAsDataURL() {
        this.result = 'data:image/png;base64,aGVsbG8='
        this.onload?.()
      }
    }
  })

  it('reads a file as base64 from its own bytes, without the data: prefix', async () => {
    await expect(readBase64('file:///a.png')).resolves.toBe('aGVsbG8=')
    expect((global as any).fetch).toHaveBeenCalledWith('file:///a.png')
  })

  it('PUTs a file to its signed URL with the content type it was minted for', async () => {
    await putFile('https://storage.example/signed', 'file:///a.png', 'image/png')
    expect((global as any).fetch).toHaveBeenLastCalledWith('https://storage.example/signed', {
      method: 'PUT',
      headers: { 'Content-Type': 'image/png' },
      body: blob,
    })
    const transport = damTransport({ request: jest.fn() })
    expect(transport.putFile).toBe(putFile)
    expect(transport.readBase64).toBe(readBase64)
  })

  it('says when the signed upload is refused', async () => {
    ;(global as any).fetch = jest.fn(async (_url: string, init?: { method?: string }) =>
      init?.method === 'PUT' ? { ok: false, status: 403 } : { ok: true, blob: async () => blob },
    )
    await expect(putFile('https://storage.example/signed', 'file:///a.png', 'image/png')).rejects.toThrow('(403)')
  })
})
