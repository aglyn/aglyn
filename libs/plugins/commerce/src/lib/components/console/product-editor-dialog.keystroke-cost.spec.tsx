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

import { within } from '@testing-library/dom'
import {
  type FiberRenderCounter,
  installFiberRenderCounter,
} from '@aglyn/shared-ui-jsx/testing/fiber-render-counter'

/**
 * What one keystroke costs in the product editor (AGL-3423).
 *
 * Every field in the editor writes one draft, and one letter typed anywhere
 * used to redraw every input in the dialog: 39 inputs and some 1,200
 * components for a product with two options and four variants. When each
 * keystroke costs that much, typed input queues and is processed back to
 * back, and a chip list redrawn by every one of them leaves React's
 * nested-update count climbing until it throws #185. A keystroke now redraws
 * the field it lands in, and the zones only when they are handed what was
 * typed. Counted off React's own commits, so the budget is what actually
 * rendered, not what a reading of the code expects to.
 *
 * The input budget is two, not one: a field typed into from empty draws once
 * for the keystroke and once more when its `FormControl` notices it is
 * filled.
 */

jest.mock('@aglyn/tenant-feature-instance/hooks/helpers/site-wide-change', () => ({
  writeSiteWideChange: async () => undefined,
}))
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useUser: () => mockUser,
  useFirestore: () => mockFirestore,
  // The same rows on every render, as a live listener hands them on.
  useFirestoreCollection: (build: () => unknown) => ({
    data: mockCollections[String(build())] ?? null,
    status: 'success',
    fromCache: false,
  }),
  useHostResourceApi: () => mockCreate,
  writeGuardedBySeed: async () => ({ ok: true }),
  collectionCeiling: (name: string) => name,
  ceilingedWindow: (read: unknown[] | undefined) => ({
    rows: read ?? [],
    truncated: false,
  }),
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
// Named, so the counter can say whether a keystroke beside them drew them.
jest.mock('./paid-media', () => ({
  MembersVideosField: function MembersVideosField() {
    return null
  },
  PaidDownloadAddButton: function PaidDownloadAddButton() {
    return null
  },
  PaidMediaProtection: function PaidMediaProtection() {
    return null
  },
}))

const mockUser = { data: null }
const mockFirestore = {}
const mockCreate = jest.fn()
const mockPicker = { pickMedia: async () => null }
const mockEntitled = { ready: true, entitled: true, upgradeHref: '/x', planLabel: 'Pro' }
const mockSnackbar = { enqueueSnackbar: () => undefined }
const mockCollections: Record<string, unknown[]> = {
  productCategories: [
    { $id: 'cat-lighting', name: 'Lighting' },
    { $id: 'cat-office', name: 'Home office' },
  ],
  products: [
    { $id: 'prod-1', name: 'Desk lamp' },
    { $id: 'prod-2', name: 'Shade' },
  ],
  suppliers: [{ $id: 'sup-1', name: 'Lamps Inc' }],
}

/** A product with all four chip lists filled, and a matrix to type into. */
const lamp = {
  $id: 'prod-1',
  name: 'Desk lamp',
  slug: 'desk-lamp',
  description: 'A lamp.',
  status: 'active',
  type: 'physical',
  tags: ['lamp'],
  categoryIds: ['cat-lighting'],
  relatedProductIds: ['prod-2'],
  mediaUrls: ['media:host-1/lamp'],
  options: [
    { name: 'finish', values: ['Brass', 'Black'] },
    { name: 'size', values: ['S', 'L'] },
  ],
  variants: [
    { id: 'v1', options: { finish: 'Brass', size: 'S' }, priceUsd: 40, sku: 'L-BS', inventory: 3 },
    { id: 'v2', options: { finish: 'Brass', size: 'L' }, priceUsd: 41, sku: 'L-BL', inventory: 3 },
    { id: 'v3', options: { finish: 'Black', size: 'S' }, priceUsd: 42, sku: 'L-KS', inventory: 0 },
    { id: 'v4', options: { finish: 'Black', size: 'L' }, priceUsd: 43, sku: 'L-KL', inventory: 0 },
  ],
  seo: { title: 'Desk lamp', description: 'A lamp.', imageUrl: 'media:host-1/share' },
}

/** A digital product with a file and a members video. */
const course = {
  $id: 'prod-3',
  name: 'Lighting course',
  slug: 'lighting-course',
  status: 'active',
  type: 'digital',
  tags: ['course'],
  variants: [{ id: 'default', priceUsd: 90 }],
  digitalFiles: [{ url: 'media:host-1/workbook', fileName: 'workbook.pdf', version: '1' }],
  downloadLimit: 3,
  gatedVideos: [{ url: 'media:host-1/lesson', title: 'Lesson one' }],
}

describe('one keystroke in the product editor (AGL-3423)', () => {
  let counter: FiberRenderCounter
  let react: typeof import('react')
  let unmount: () => Promise<void>
  let dialog: HTMLElement

  const mount = async (product: unknown) => {
    counter = installFiberRenderCounter()
    jest.resetModules()
    react = jest.requireActual<typeof import('react')>('react')
    const client = jest.requireActual<typeof import('react-dom/client')>('react-dom/client')
    const Dialog = jest.requireActual<typeof import('./product-editor-dialog.component')>(
      './product-editor-dialog.component',
    ).default
    const { ConsoleWidgetSlotContext } = jest.requireActual<
      typeof import('@aglyn/aglyn/app-utils/console-widget-slot-context')
    >('@aglyn/aglyn/app-utils/console-widget-slot-context')
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
    /** The shell's zone renderer, drawing nothing, so the counter can see it draw. */
    function ShellSlot() {
      return null
    }
    const onClose = () => undefined
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = client.createRoot(host)
    await react.act(async () => {
      root.render(
        react.createElement(
          ConsoleWidgetSlotContext.Provider,
          { value: ShellSlot as never },
          react.createElement(Dialog, {
            hostId: 'host-1',
            product: product as never,
            seedFromCache: false,
            open: true,
            onClose,
          }),
        ),
      )
    })
    dialog = document.querySelector('[role="dialog"]') as HTMLElement
    unmount = async () => {
      await react.act(async () => root.unmount())
      host.remove()
    }
  }

  afterEach(async () => {
    await unmount()
    counter.uninstall()
    jest.restoreAllMocks()
  })

  /** Types one letter's worth into `field` the way the browser delivers it. */
  const type = async (field: HTMLElement, value: string) => {
    const prototype =
      field instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype
    const setValue = Object.getOwnPropertyDescriptor(prototype, 'value')?.set
    counter.reset()
    await react.act(async () => {
      setValue?.call(field, value)
      field.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect((field as HTMLInputElement).value).toBe(value)
  }

  const textbox = (name: string) => within(dialog).getByRole('textbox', { name })

  it('draws every chip list it is about to leave alone', async () => {
    await mount(lamp)
    // Premise: tags, categories, each option's values and related products,
    // so a zero below is five lists left alone.
    expect(dialog.querySelectorAll('.MuiAutocomplete-root')).toHaveLength(5)
  })

  it('redraws only the Name typed into, and the zones it hands the name to', async () => {
    await mount(lamp)
    await type(textbox('Name'), 'Desk lamps')
    expect(counter.rendered('Autocomplete')).toBe(0)
    expect(counter.rendered('InputBase')).toBeLessThanOrEqual(2)
    // Both zones are handed the name: the product zone and the listing zone.
    expect(counter.rendered('ShellSlot')).toBe(2)
  })

  it('redraws only the Description typed into', async () => {
    await mount(lamp)
    await type(textbox('Description'), 'A brass lamp.')
    expect(counter.rendered('Autocomplete')).toBe(0)
    expect(counter.rendered('InputBase')).toBeLessThanOrEqual(2)
  })

  it('redraws only the SEO title typed into', async () => {
    await mount(lamp)
    await type(textbox('SEO title'), 'Brass desk lamp')
    expect(counter.rendered('Autocomplete')).toBe(0)
    expect(counter.rendered('InputBase')).toBeLessThanOrEqual(2)
  })

  it('redraws only the SKU typed into, and neither zone', async () => {
    await mount(lamp)
    await type(within(dialog).getByDisplayValue('L-BS'), 'L-BS2')
    expect(counter.rendered('Autocomplete')).toBe(0)
    expect(counter.rendered('InputBase')).toBeLessThanOrEqual(2)
    // Neither zone reads a SKU.
    expect(counter.rendered('ShellSlot')).toBe(0)
  })

  it('redraws only the Download limit typed into, not the files or videos beside it', async () => {
    await mount(course)
    await type(textbox('Download limit'), '5')
    expect(counter.rendered('Autocomplete')).toBe(0)
    expect(counter.rendered('InputBase')).toBeLessThanOrEqual(2)
    expect(counter.rendered('MembersVideosField')).toBe(0)
    expect(counter.rendered('PaidMediaProtection')).toBe(0)
  })
})
