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
 * A schema validator reaches the field and is DISPLAYED (AGL-2486).
 *
 * The host setup page's Tracking tab rejects a malformed GA or GTM id at the
 * field, because the tenant refuses anything that is not the exact shape
 * before it reaches an inline script — and without a message at the field that
 * refusal reads as "I saved it and nothing happened".
 *
 * Written because I could not make an inline error appear by driving the live
 * page with synthetic input, and could not make the SEPARATOR's long-standing
 * `max-length` appear either. Two very different causes — the stack not
 * surfacing schema validators at all, or synthetic input never marking a field
 * touched — so this settles it here, against the real `TextField`, rather than
 * leaving a validator in the tree that nobody has seen fire.
 *
 * `PATTERN` had no other user in the repo when it was added, which is the
 * other reason this exists: the first user of a validator type is the one that
 * finds out whether it works.
 *
 * The production mapper's components are `next/dynamic` wrappers that jest
 * cannot resolve — they render nothing, and a form of nothing passes every
 * "no error is shown" assertion. The real component is substituted here, the
 * same way `select.spec.tsx` does it, and the last case is the control that
 * would catch a form that had silently rendered no fields at all.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import { FIELD_MAP_TEXT_FIELD } from '../constants/field-configurations'
import { FormRenderer, useFormApi } from '../vendor/data-driven-forms'
import TextField from './text-field'

const FormTemplate = ({ formFields }: any) => {
  const { handleSubmit } = useFormApi()
  return (
    <form onSubmit={handleSubmit}>
      {formFields}
      <button type="submit">{'Save'}</button>
    </form>
  )
}

/** The shape a GTM container id has, as the setup page spells it. */
const GTM_SOURCE = '^GTM-[A-Z0-9]{5,10}$'

const renderForm = () =>
  render(
    <FormRenderer
      FormTemplate={FormTemplate}
      componentMapper={{
        'text-field': { ...FIELD_MAP_TEXT_FIELD, component: TextField },
      }}
      onSubmit={jest.fn()}
      schema={{
        fields: [
          {
            component: 'text-field',
            name: 'analytics.gtmContainerId',
            label: 'Container',
            type: 'text',
            helperText: 'Optional — e.g. GTM-XXXXXXX.',
            validate: [
              {
                type: 'pattern',
                pattern: GTM_SOURCE,
                message: 'Looks like GTM-XXXXXXX',
              },
            ],
          },
          {
            component: 'text-field',
            name: 'seo.separator',
            label: 'Separator',
            type: 'text',
            validate: [
              {
                type: 'max-length',
                threshold: 3,
                message: 'Please enter a shorter title separator',
              },
            ],
          },
        ],
      }}
    />,
  )

/** Type a value and leave the field — `touched` is what reveals an error. */
const typeAndBlur = (label: RegExp, value: string) => {
  const field = screen.getByLabelText(label)
  fireEvent.change(field, { target: { value } })
  fireEvent.blur(field)
}

describe('schema validators are shown at the field (AGL-2486)', () => {
  it('THE CONTROL: the fields render at all', () => {
    // Without this, every "no error is shown" case below passes on an empty
    // form — which is exactly how the first version of this file went green
    // while asserting nothing.
    renderForm()
    expect(screen.getByLabelText(/Container/i)).toBeTruthy()
    expect(screen.getByLabelText(/Separator/i)).toBeTruthy()
  })

  it('shows a PATTERN message for a malformed container id', async () => {
    renderForm()
    typeAndBlur(/Container/i, 'not-a-container')
    await waitFor(() =>
      expect(screen.getByText(/Looks like GTM-XXXXXXX/i)).toBeTruthy(),
    )
  })

  it('clears once the value is the right shape, and restores the helper', async () => {
    renderForm()
    typeAndBlur(/Container/i, 'nope')
    await waitFor(() =>
      expect(screen.getByText(/Looks like GTM-XXXXXXX/i)).toBeTruthy(),
    )
    typeAndBlur(/Container/i, 'GTM-ABCDE12')
    await waitFor(() =>
      expect(screen.queryByText(/Looks like GTM-XXXXXXX/i)).toBeNull(),
    )
    // An error REPLACES the helper text; it does not consume the slot.
    expect(screen.getByText(/Optional — e.g. GTM-XXXXXXX/i)).toBeTruthy()
  })

  it('accepts an EMPTY value — the field is optional', async () => {
    // A site with no container must not be told it typed something wrong.
    renderForm()
    typeAndBlur(/Container/i, '')
    await waitFor(() =>
      expect(screen.queryByText(/Looks like GTM-XXXXXXX/i)).toBeNull(),
    )
  })

  it('says nothing until the field is TOUCHED', () => {
    // The rule `validationError` implements, and the likeliest explanation
    // for an error that "does not appear": nothing is wrong until somebody
    // has been given a chance to type it.
    renderForm()
    const field = screen.getByLabelText(/Container/i)
    fireEvent.change(field, { target: { value: 'nope' } })
    expect(screen.queryByText(/Looks like GTM-XXXXXXX/i)).toBeNull()
    fireEvent.blur(field)
    expect(screen.getByText(/Looks like GTM-XXXXXXX/i)).toBeTruthy()
  })

  it('max-length surfaces the same way', async () => {
    renderForm()
    typeAndBlur(/Separator/i, 'far too long')
    await waitFor(() =>
      expect(screen.getByText(/shorter title separator/i)).toBeTruthy(),
    )
  })
})
