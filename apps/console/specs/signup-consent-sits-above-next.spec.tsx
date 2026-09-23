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
 * The sign-up checkboxes sit above the button they gate (AGL-3291).
 *
 * They used to render after the form, so a person met the required terms box
 * only after pressing Next and being refused below it. The page now hands
 * them to the template, which draws them between the fields and the button;
 * these pin both halves — the order, and the error wiring each row carries.
 */
import { AuthCheckboxRow } from '../components/auth-checkbox-row.component'
import AuthFormTemplateComponent from '../components/auth-form-template.component'
import { FormRenderer } from '@aglyn/shared-ui-jsx-forms'
import { fireEvent, render, screen } from '@testing-library/react'

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useSigninCheck: () => ({ status: 'success', data: { signedIn: false } }),
}))
jest.mock('../components/auth-error-alert.component', () => ({
  __esModule: true,
  default: () => null,
}))

function renderForm(beforeSubmit?: JSX.Element) {
  return render(
    <FormRenderer
      FormTemplate={AuthFormTemplateComponent}
      FormTemplateProps={beforeSubmit ? { beforeSubmit } : {}}
      componentMapper={{}}
      onSubmit={() => undefined}
      schema={{ fields: [] }}
    />,
  )
}

describe('the sign-up checkboxes sit above the button they gate (AGL-3291)', () => {
  it('draws the before-submit block ahead of the submit button', () => {
    renderForm(<span>{'consent rows'}</span>)
    const block = screen.getByText('consent rows')
    const next = screen.getByRole('button', { name: 'Next' })
    expect(
      block.compareDocumentPosition(next) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    // Inside the form, so the order a keyboard walks is the order it reads.
    expect(block.closest('form')).toBe(next.closest('form'))
  })

  it('adds nothing on a page that passes no block', () => {
    const { container } = renderForm()
    expect(container.querySelector('form')?.textContent).toBe('Next')
  })
})

describe('one checkbox row (AGL-3291)', () => {
  it('ties its error to the input, and clears both when ticked', () => {
    const onChange = jest.fn()
    const { rerender } = render(
      <AuthCheckboxRow
        checked={false}
        onChange={onChange}
        inputLabel="Agree"
        error="Please accept to continue."
      >
        {'I agree.'}
      </AuthCheckboxRow>,
    )
    const box = screen.getByRole('checkbox', { name: 'Agree' })
    expect(box.getAttribute('aria-invalid')).toBe('true')
    const describedBy = box.getAttribute('aria-describedby') ?? ''
    expect(document.getElementById(describedBy)?.textContent).toBe(
      'Please accept to continue.',
    )
    fireEvent.click(box)
    expect(onChange).toHaveBeenCalledWith(true)

    rerender(
      <AuthCheckboxRow checked onChange={onChange} inputLabel="Agree">
        {'I agree.'}
      </AuthCheckboxRow>,
    )
    expect(box.hasAttribute('aria-invalid')).toBe(false)
    expect(screen.queryByText('Please accept to continue.')).toBeNull()
  })

  it('puts only phrasing content inside the label', () => {
    render(
      <AuthCheckboxRow checked={false} onChange={() => undefined} inputLabel="Agree" error="No.">
        {'I agree.'}
      </AuthCheckboxRow>,
    )
    const label = screen.getByRole('checkbox', { name: 'Agree' }).closest('label')
    expect(label?.querySelector('p, div')).toBeNull()
  })
})
