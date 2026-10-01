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

// A registry of its own in production mode re-evaluates React, MUI and the
// whole component graph before the first keystroke. On a loaded two-worker CI
// shard that ran past the 30 s default (the sequence editor's spec of the same
// failure, 2026-09-30), so the budget is set for that load; the keystrokes
// themselves are a fraction of it.
const TYPING_BURST_TIMEOUT_MS = 120_000

/**
 * A multi-select beside a field being typed in, in a form that re-renders
 * its fields on every change (AGL-3423).
 *
 * A form with a `values` subscription re-renders every field on every
 * keystroke, and a form can put multi-selects beside a text field: the
 * campaign drawer has two under its name. (The create drawer's own form
 * subscribes to nothing; `create-artifact-drawer.keystroke-cost.spec.tsx`
 * holds it there.) A multi-select is a multiple Autocomplete, which leaves a
 * state update pending after every commit it takes part in
 * (MUI's `InputBase` copies each render's new chip array into its
 * `FormControl` from a passive effect); React 19 counts each such commit as
 * a nested update, and keystrokes delivered back to back commit one after
 * another with nothing in between to clear the count, so the fifty-first
 * throws "Maximum update depth exceeded" (#185).
 *
 * Run against the PRODUCTION builds of React and MUI, in a registry of their
 * own, as the sequence editor's spec of the same failure is: in development
 * MUI's `FormControl` hands its inputs a new context on every render and
 * would measure the development build. The keystrokes are dispatched in one
 * task and outside `act`, which is how a browser delivers queued input.
 */
describe('a multi-select beside a field being typed in (AGL-3423)', () => {
  it('takes a burst of keystrokes without exceeding React’s update depth', async () => {
    const scope = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
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
      const forms = jest.requireActual<typeof import('../vendor/data-driven-forms')>(
        '../vendor/data-driven-forms',
      )
      const { FIELD_MAP_SELECT } = jest.requireActual<
        typeof import('../constants/field-configurations')
      >('../constants/field-configurations')
      const Select = jest.requireActual<typeof import('./select')>('./select').default
      const TextField = jest.requireActual<typeof import('./text-field')>('./text-field').default
      const h = react.createElement
      const FormTemplate = ({ formFields }: { formFields: unknown }) =>
        h('form', null, formFields as never)
      const root = client.createRoot(host)
      unmount = () => root.unmount()
      root.render(
        h(forms.FormRenderer, {
          FormTemplate,
          // The production mapper config, minus the next/dynamic wrapper
          // jest cannot resolve: the components under it are these.
          componentMapper: {
            select: { ...FIELD_MAP_SELECT, component: Select },
            'text-field': TextField,
          },
          onSubmit: () => undefined,
          // Every field on every change: the shape this select must survive.
          subscription: { values: true },
          initialValues: { topics: ['design', 'build'] },
          schema: {
            fields: [
              { component: 'text-field', name: 'title', label: 'Title' },
              {
                component: 'select',
                name: 'topics',
                label: 'Topics',
                isMulti: true,
                options: [
                  { value: 'design', label: 'Design' },
                  { value: 'build', label: 'Build' },
                ],
              },
            ],
          },
        } as never),
      )
      await new Promise((resolve) => setTimeout(resolve, 100))
      // The answers are chips: the field that held the update.
      expect(within(host).getByText('Design')).toBeTruthy()
      const title = within(host).getByRole('textbox', { name: 'Title' }) as HTMLInputElement
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      for (let typed = 1; typed <= 80; typed += 1) {
        setValue?.call(title, 'x'.repeat(typed))
        title.dispatchEvent(new Event('input', { bubbles: true }))
      }
      await new Promise((resolve) => setTimeout(resolve, 100))
      expect(errors).toEqual([])
      expect(title.value).toHaveLength(80)
    } finally {
      unmount()
      window.removeEventListener('error', onError)
      host.remove()
      env['NODE_ENV'] = environment
      scope.IS_REACT_ACT_ENVIRONMENT = actEnvironment
    }
  }, TYPING_BURST_TIMEOUT_MS)
})
