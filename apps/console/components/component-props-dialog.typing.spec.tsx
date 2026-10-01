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

/**
 * "Maximum update depth exceeded" while editing a component's properties
 * (AGL-3423).
 *
 * The component editor reported minified React error #185. The Properties
 * dialog keeps its rows in state, so every keystroke in any row re-renders
 * every row, and each row built its fields inline, so every field in every
 * row re-rendered with it. A Choice that takes several answers draws its
 * Default as a multiple Autocomplete, which leaves a state update pending
 * after every commit it takes part in: MUI's `InputBase` copies each
 * render's new chip array into its `FormControl` from a passive effect.
 * React 19 counts each such commit as a nested update, and keystrokes
 * delivered back to back commit one after another with nothing in between
 * to clear the count. Without the multi-answer Choice the same typing is
 * clean, which is what pins it on that field.
 *
 * Run against the PRODUCTION builds of React and MUI, as the sequence
 * editor's spec of the same failure is: in development MUI's `FormControl`
 * hands its inputs a new context on every render and would measure the
 * development build. In a registry of its own and not a scoped one, because
 * the dialog's fields load parts of themselves as they render, after an
 * `isolateModules` scope would have closed, and those must resolve to the
 * same React. The keystrokes are dispatched in one task and outside `act`,
 * which is how a browser delivers queued input, and which `act` would batch
 * into a single commit.
 */
describe('typing in the Properties dialog beside a multi-answer Choice (AGL-3423)', () => {
  it('takes a burst of keystrokes without exceeding React’s update depth', async () => {
    const scope = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    // Widened: the Next typings declare `NODE_ENV` read-only.
    const env = process.env as Record<string, string | undefined>
    const environment = env['NODE_ENV']
    const actEnvironment = scope.IS_REACT_ACT_ENVIRONMENT
    const errors: string[] = []
    const onError = (event: ErrorEvent) => {
      errors.push(String(event.error?.message ?? event.message))
      event.preventDefault()
    }
    const host = document.createElement('div')
    document.body.appendChild(host)
    env['NODE_ENV'] = 'production'
    scope.IS_REACT_ACT_ENVIRONMENT = false
    window.addEventListener('error', onError)
    let unmount: () => void = () => undefined
    try {
      jest.resetModules()
      const react = jest.requireActual<typeof import('react')>('react')
      const client = jest.requireActual<typeof import('react-dom/client')>('react-dom/client')
      const Dialog = jest.requireActual<typeof import('./component-props-dialog.component')>(
        './component-props-dialog.component',
      ).default
      const root = client.createRoot(host)
      unmount = () => root.unmount()
      root.render(
        react.createElement(Dialog, {
          open: true,
          value: [
            { name: 'intro', type: 'richText' },
            {
              name: 'topics',
              type: 'choice',
              settings: { isMulti: true },
              options: [
                { value: 'design', label: 'Design' },
                { value: 'build', label: 'Build' },
              ],
              defaultValue: ['design', 'build'],
            },
          ],
          onClose: () => undefined,
          onSave: () => undefined,
        }),
      )
      await new Promise((resolve) => setTimeout(resolve, 100))
      const dialog = document.querySelector('[role="dialog"]') as HTMLElement
      // The multi-answer Default draws its answers as chips: the field that
      // held the update.
      expect(within(dialog).getAllByText('Design').length).toBeGreaterThan(0)
      const help = within(dialog).getAllByRole('textbox', {
        name: 'Help',
      })[0] as HTMLInputElement
      const setValue = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )?.set
      for (let typed = 1; typed <= 80; typed += 1) {
        setValue?.call(help, 'x'.repeat(typed))
        help.dispatchEvent(new Event('input', { bubbles: true }))
      }
      await new Promise((resolve) => setTimeout(resolve, 100))
      expect(errors).toEqual([])
      expect(help.value).toHaveLength(80)
    } finally {
      unmount()
      window.removeEventListener('error', onError)
      host.remove()
      env['NODE_ENV'] = environment
      scope.IS_REACT_ACT_ENVIRONMENT = actEnvironment
    }
  }, 60000)
})
