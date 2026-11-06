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
  FRESH_REGISTRY_TIMEOUT_MS,
  installFiberRenderCounter,
} from '@aglyn/shared-ui-jsx/testing/fiber-render-counter'

jest.setTimeout(FRESH_REGISTRY_TIMEOUT_MS)

// The media picker reaches Firestore and the DAM; the draft contract is what
// is under test here, and the image field's own spec covers the picker.
jest.mock('./screen-social-image-field.component', () => ({
  __esModule: true,
  default: function ScreenSocialImageField() {
    return null
  },
}))

type Panel = typeof import('./screen-seo-draft-fields.component')

/**
 * What one keystroke in the Besigner's Search title or Search description
 * costs (2026-11-06).
 *
 * The drafts were state on the Besigner page, so a letter redrew the whole
 * editor. A burst of about a hundred typed characters queued those redraws
 * back to back until React threw #185 and dropped a letter, in production.
 * The page here stands in for the Besigner: it owns the store and renders
 * the panel the way the page does, and it must not redraw while typing.
 */
describe('Besigner SEO fields: one keystroke redraws the fields, not the page', () => {
  let counter: FiberRenderCounter
  let react: typeof import('react')
  let panel: Panel
  let unmount: () => Promise<void>
  let container: HTMLElement
  let store: ReturnType<Panel['createScreenSeoDraftStore']>
  let saved: Array<ReturnType<Panel['screenSeoDraftEdits']>>

  beforeEach(async () => {
    counter = installFiberRenderCounter()
    jest.resetModules()
    react = jest.requireActual<typeof import('react')>('react')
    const client = jest.requireActual<typeof import('react-dom/client')>('react-dom/client')
    panel = jest.requireActual<Panel>('./screen-seo-draft-fields.component')
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
    saved = []
    store = panel.createScreenSeoDraftStore()
    const seo = { title: 'Saved title', description: 'Saved description' }

    function BesignerPageStandIn() {
      const onSave = react.useCallback(() => {
        saved.push(panel.screenSeoDraftEdits(store.get()))
        store.reset()
      }, [])
      return react.createElement(panel.ScreenSeoDraftFields, {
        store,
        hostId: 'host-1',
        saved: seo,
        onSave,
      })
    }

    container = document.createElement('div')
    document.body.appendChild(container)
    const root = client.createRoot(container)
    await react.act(async () => {
      root.render(react.createElement(BesignerPageStandIn))
    })
    unmount = async () => {
      await react.act(async () => root.unmount())
      container.remove()
    }
  })

  afterEach(async () => {
    await unmount()
    counter.uninstall()
    jest.restoreAllMocks()
  })

  const description = () =>
    within(container).getByRole('textbox', { name: 'Search description' }) as HTMLTextAreaElement
  const title = () =>
    within(container).getByRole('textbox', { name: 'Search title' }) as HTMLInputElement
  const saveButton = () =>
    within(container).getByRole('button', { name: 'Save SEO' }) as HTMLButtonElement

  async function type(field: HTMLInputElement | HTMLTextAreaElement, value: string) {
    const proto =
      field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    const setValue = Object.getOwnPropertyDescriptor(proto, 'value')?.set
    await react.act(async () => {
      setValue?.call(field, value)
      field.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }

  it('shows what the document holds until something is typed', () => {
    expect(title().value).toBe('Saved title')
    expect(description().value).toBe('Saved description')
    expect(saveButton().disabled).toBe(true)
  })

  it('a letter in Search description never redraws the page', async () => {
    counter.reset()
    await type(description(), 'C')
    expect(description().value).toBe('C')
    expect(counter.rendered('BesignerPageStandIn')).toBe(0)
    expect(counter.rendered('ScreenSeoDraftFields')).toBe(1)
  })

  it('a letter in Search title never redraws the page', async () => {
    counter.reset()
    await type(title(), 'C')
    expect(title().value).toBe('C')
    expect(counter.rendered('BesignerPageStandIn')).toBe(0)
  })

  it('a hundred-letter burst lands every letter and redraws no page', async () => {
    const text =
      'Card readers and accessories for Aglyn POS, set up for your store before they ship. For business use.'
    counter.reset()
    for (let i = 1; i <= text.length; i += 1) await type(description(), text.slice(0, i))
    expect(description().value).toBe(text)
    expect(store.get().description).toBe(text)
    expect(counter.rendered('BesignerPageStandIn')).toBe(0)
  })

  it('a field staged from outside (an editor-session plugin) shows in the panel', async () => {
    await react.act(async () => store.set('title', 'Staged by a plugin'))
    expect(title().value).toBe('Staged by a plugin')
    expect(saveButton().disabled).toBe(false)
  })

  it('Save SEO hands over the staged edits, and a reset shows the document again', async () => {
    await type(description(), 'New description')
    expect(saveButton().disabled).toBe(false)
    await react.act(async () => saveButton().click())
    expect(saved).toEqual([{ title: null, description: 'New description', image: null }])
    expect(description().value).toBe('Saved description')
    expect(saveButton().disabled).toBe(true)
  })
})
