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

/**
 * What one keystroke costs in the Properties dialog (AGL-3423).
 *
 * The dialog keeps every row in one draft, and one letter typed anywhere
 * used to redraw every input in every row: 17 inputs and some 800 components
 * in a three-property dialog. When each keystroke costs that much, typed
 * input queues and is processed back to back, and a multi-answer Choice
 * redrawn by every one of them left React's nested-update count climbing
 * until it threw #185 (see `component-props-dialog.typing.spec.tsx`). A
 * keystroke now redraws the field it lands in. Counted off React's own
 * commits, so the budget is what actually rendered, not what a reading of the
 * code expects to.
 */
describe('one keystroke in the Properties dialog (AGL-3423)', () => {
  let counter: FiberRenderCounter
  let react: typeof import('react')
  let unmount: () => Promise<void>
  let dialog: HTMLElement

  beforeEach(async () => {
    counter = installFiberRenderCounter()
    jest.resetModules()
    react = jest.requireActual<typeof import('react')>('react')
    const client = jest.requireActual<typeof import('react-dom/client')>('react-dom/client')
    const Dialog = jest.requireActual<typeof import('./component-props-dialog.component')>(
      './component-props-dialog.component',
    ).default
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = client.createRoot(host)
    await react.act(async () => {
      root.render(
        react.createElement(Dialog, {
          open: true,
          value: [
            { name: 'intro', type: 'richText' },
            { name: 'headline', type: 'text', label: 'Headline' },
            {
              name: 'topics',
              type: 'choice',
              settings: { isMulti: true },
              options: [
                { value: 'design', label: 'Design' },
                { value: 'build', label: 'Build' },
              ],
              defaultValue: ['design'],
            },
          ],
          onClose: () => undefined,
          onSave: () => undefined,
        }),
      )
    })
    dialog = document.querySelector('[role="dialog"]') as HTMLElement
    unmount = async () => {
      await react.act(async () => root.unmount())
      host.remove()
    }
  })

  afterEach(async () => {
    await unmount()
    counter.uninstall()
    jest.restoreAllMocks()
  })

  it('redraws only the Help typed into, and never the chips', async () => {
    const help = within(dialog).getAllByRole('textbox', { name: 'Help' })[0] as HTMLInputElement
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    counter.reset()
    await react.act(async () => {
      setValue?.call(help, 'a')
      help.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(help.value).toBe('a')
    expect(counter.rendered('Autocomplete')).toBe(0)
    // The field typed in, and nothing else.
    expect(counter.rendered('InputBase')).toBeLessThanOrEqual(2)
  })

  it('redraws only the Default typed into, and never the chips', async () => {
    const field = within(dialog)
      .getAllByRole('textbox')
      .find((box) => box.getAttribute('contenteditable') === 'true') as HTMLElement
    counter.reset()
    await react.act(async () => {
      field.textContent = 'a'
      field.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(counter.rendered('Autocomplete')).toBe(0)
    expect(counter.rendered('InputBase')).toBeLessThanOrEqual(2)
  })
})
