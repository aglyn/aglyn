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

import { render, screen } from '@testing-library/react'
import { ConsoleWidgetSlotContext } from '@aglyn/aglyn/app-utils/console-widget-slot-context'
import { MEDIA_CDN_ROUTE, resolveMediaSrc } from '@aglyn/aglyn/app-utils/media-ref'

/*
 * The Edit product dialog's Media thumbnails (AGL-4246). A product stores
 * each picture as a library reference, `media:org:<orgId>/<mediaId>`, which
 * a browser cannot load: handed to `<img src>` as it is, every photo drew as
 * a broken image while the site and the POS grid showed it. The dialog now
 * draws each one through the shared `resolveMediaSrc` with its host, and
 * leaves what is stored alone.
 */

jest.mock('@aglyn/tenant-feature-instance/hooks/helpers/site-wide-change', () => ({
  writeSiteWideChange: async () => undefined,
}))
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useUser: () => mockUser,
  // The editor's product traffic card (AGL-4253) asks the plan; unknown, it draws nothing.
  useOrgPlan: () => ({ org: null, ready: false }),
  useFirestore: () => mockFirestore,
  useFirestoreCollection: () => ({ data: [], status: 'success', fromCache: false }),
  useHostResourceApi: () => mockCreate,
  writeGuardedBySeed: async () => ({ ok: true }),
  collectionCeiling: (name: string) => name,
  ceilingedWindow: (read: unknown[] | undefined) => ({ rows: read ?? [], truncated: false }),
}))
jest.mock('./smart-collections', () => ({
  productCollectionFields: async () => ({ collectionIds: [] }),
}))
jest.mock('firebase/firestore', () => ({
  collection: (_db: unknown, _a: string, _b: string, name: string) => name,
  doc: () => ({}),
  getDoc: async () => ({ get: () => undefined }),
}))
jest.mock('@aglyn/aglyn', () => ({
  useMediaPicker: () => mockPicker,
}))
jest.mock('./entitlement-gate.component', () => ({
  EntitlementUpsell: () => null,
  useCommerceEntitlement: () => mockEntitled,
}))
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => mockSnackbar,
}))
jest.mock('./paid-media', () => ({
  MembersVideosField: () => null,
  PaidDownloadAddButton: () => null,
  PaidMediaProtection: () => null,
}))

const mockUser = { data: null }
const mockFirestore = {}
const mockCreate = jest.fn()
const mockPicker = { pickMedia: async () => null }
const mockEntitled = { ready: true, entitled: true, upgradeHref: '/x', planLabel: 'Pro' }
const mockSnackbar = { enqueueSnackbar: () => undefined }

const stored = [
  'media:org:org-1/clamp-front',
  'media:host-1/clamp-side',
  'https://images.example.com/clamp-box.jpg',
]

const clamp = {
  $id: 'prod-1',
  name: 'Triple clamp',
  slug: 'triple-clamp',
  status: 'active',
  type: 'physical',
  mediaUrls: stored,
  variants: [{ id: 'v1', options: {}, priceUsd: 120, inventory: 2 }],
}

import ProductEditorDialog from './product-editor-dialog.component'

const thumbnails = () =>
  screen
    .getAllByRole('button', { name: 'Remove image' })
    .map((remove) => remove.parentElement?.querySelector('img')?.getAttribute('src'))

describe('the Edit product dialog draws its photos (AGL-4246)', () => {
  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
    render(
      <ConsoleWidgetSlotContext.Provider value={(() => null) as never}>
        <ProductEditorDialog hostId="host-1" product={clamp as never} seedFromCache={false} open onClose={() => undefined} />
      </ConsoleWidgetSlotContext.Provider>,
    )
  })

  it('never hands a media: reference to an image', () => {
    const srcs = thumbnails()
    expect(srcs).toHaveLength(3)
    for (const src of srcs) expect(src).not.toMatch(/^media:/)
  })

  it('resolves each reference the way the site and the POS grid do', () => {
    expect(thumbnails()).toEqual(stored.map((value) => resolveMediaSrc(value, { hostId: 'host-1' })))
    const [orgPhoto, hostPhoto] = thumbnails()
    expect(orgPhoto?.startsWith(`${MEDIA_CDN_ROUTE}/`)).toBe(true)
    expect(orgPhoto).toContain('clamp-front')
    expect(hostPhoto?.startsWith(`${MEDIA_CDN_ROUTE}/`)).toBe(true)
  })

  it('passes an external picture through untouched', () => {
    expect(thumbnails()[2]).toBe('https://images.example.com/clamp-box.jpg')
  })
})
