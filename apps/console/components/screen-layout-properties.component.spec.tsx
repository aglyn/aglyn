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

const mockGetDoc = jest.fn()
jest.mock('firebase/firestore', () => ({
  ...jest.requireActual('firebase/firestore'),
  doc: (_firestore: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
  getDoc: (ref: { path: string }) => mockGetDoc(ref.path),
}))

import type * as Aglyn from '@aglyn/aglyn'
import {
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from '@testing-library/react'

import ScreenLayoutProperties, {
  cleanLayoutPropValues,
  useLayoutChainProperties,
} from './screen-layout-properties.component'

/**
 * A screen sets the properties of the layouts it renders inside, in Screen
 * Properties (AGL-2893), with the controls the Attributes panel uses.
 */

const BANNER_PROPS: Aglyn.ReusableComponentProp[] = [
  { name: 'showBanner', type: 'boolean', label: 'Show the banner' },
  {
    name: 'bannerText',
    type: 'text',
    label: 'Banner text',
    defaultValue: 'We are hiring',
    condition: { when: 'showBanner', is: true },
  },
]

/** One Firestore for the whole suite, as a page holds one. */
const FIRESTORE = {} as never

const snapshot = (data: Record<string, unknown>) => ({
  get: (key: string) => data[key],
})

describe('cleanLayoutPropValues (AGL-2893)', () => {
  it('keeps what the screen set, and nothing it left to the default', () => {
    expect(
      cleanLayoutPropValues({
        showBanner: false,
        count: 0,
        bannerText: '',
        tags: [],
        tone: undefined,
        cleared: null,
        topics: ['crm'],
        icon: { iconId: 'mdiStar', iconPath: undefined },
      }),
    ).toEqual({
      showBanner: false,
      count: 0,
      topics: ['crm'],
      icon: { iconId: 'mdiStar' },
    })
  })
})

describe('useLayoutChainProperties (AGL-2893)', () => {
  beforeEach(() => mockGetDoc.mockReset())

  it('lists the layout the screen names, then each outer layout that declares any', async () => {
    mockGetDoc.mockImplementation(async (path: string) => {
      switch (path) {
        case 'hosts/h1/layouts/brand':
          return snapshot({ versionId: 'bv1', displayName: 'Brand', layoutId: 'root' })
        case 'hosts/h1/layouts/brand/versions/bv1':
          return snapshot({ props: [{ name: 'footerNote', type: 'text' }] })
        case 'hosts/h1/layouts/root':
          return snapshot({ versionId: 'rv1', displayName: 'Root' })
        case 'hosts/h1/layouts/root/versions/rv1':
          // Declares nothing, so it offers nothing.
          return snapshot({})
        default:
          throw new Error(`unexpected read ${path}`)
      }
    })
    const { result } = renderHook(() =>
      useLayoutChainProperties({
        firestore: FIRESTORE,
        hostId: 'h1',
        layoutId: 'site',
        layout: { displayName: 'Site', layoutId: 'brand' },
        layoutVersion: { props: BANNER_PROPS },
        enabled: true,
      }),
    )
    await waitFor(() => expect(result.current).toHaveLength(2))
    expect(result.current.map((link) => [link.layoutId, link.displayName])).toEqual([
      ['site', 'Site'],
      ['brand', 'Brand'],
    ])
  })

  it('reads no outer layout while the list is not wanted', () => {
    const { result } = renderHook(() =>
      useLayoutChainProperties({
        firestore: FIRESTORE,
        hostId: 'h1',
        layoutId: 'site',
        layout: { displayName: 'Site', layoutId: 'brand' },
        layoutVersion: { props: BANNER_PROPS },
        enabled: false,
      }),
    )
    expect(result.current.map((link) => link.layoutId)).toEqual(['site'])
    expect(mockGetDoc).not.toHaveBeenCalled()
  })
})

describe('ScreenLayoutProperties (AGL-2893)', () => {
  it("edits a layout's Yes / no with a switch, shows what depends on it, and saves the values", async () => {
    const onSave = jest.fn().mockResolvedValue(undefined)
    render(
      <ScreenLayoutProperties
        links={[{ layoutId: 'site', displayName: 'Site chrome', props: BANNER_PROPS }]}
        stored={{ site: {} }}
        onSave={onSave}
      />,
    )
    expect(screen.getByText('Site chrome properties')).toBeTruthy()
    const toggle = await screen.findByRole(
      'switch',
      { name: 'Show the banner' },
      { timeout: 10000 },
    )
    // The banner text applies only while the banner shows.
    expect(screen.queryByText('Banner text')).toBeNull()
    const save = screen.getByRole('button', { name: 'Save layout values' })
    expect(save).toHaveProperty('disabled', true)

    fireEvent.click(toggle)
    expect(
      (await screen.findAllByText('Banner text', undefined, { timeout: 10000 })).length,
    ).toBeGreaterThan(0)
    await waitFor(() => expect(save).toHaveProperty('disabled', false))
    fireEvent.click(save)
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    expect(onSave).toHaveBeenCalledWith('site', { showBanner: true })
  }, 60000)

  it('renders nothing for a screen whose layouts declare no properties', () => {
    const { container } = render(
      <ScreenLayoutProperties links={[]} stored={undefined} onSave={jest.fn()} />,
    )
    expect(container.textContent).toBe('')
  })
})
