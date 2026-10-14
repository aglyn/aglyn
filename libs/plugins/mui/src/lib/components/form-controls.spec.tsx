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
 * MUI's form elements, each its own Besigner element. Placed together they
 * must still behave as one field: a label names its input, a form receives
 * every answer under its name, and nothing authoring-only reaches the page.
 */

import { render, screen } from '@testing-library/react'
import {
  AglynCheckbox,
  AglynChoiceLabel,
  AglynFormControl,
  AglynFormHelperText,
  AglynFormLabel,
  AglynInput,
  AglynRadio,
  AglynRadioGroup,
  AglynSelect,
  AglynSelectOption,
} from './form-controls'

const formData = (form: HTMLFormElement) =>
  Object.fromEntries(new FormData(form).entries())

describe('a field built from separate elements', () => {
  it('names its input by the Form Label beside it', () => {
    render(
      <AglynFormControl>
        <AglynFormLabel>Work email</AglynFormLabel>
        <AglynInput name="email" type="email" placeholder="you@company.com" />
        <AglynFormHelperText>We never share it.</AglynFormHelperText>
      </AglynFormControl>,
    )
    const input = screen.getByRole('textbox', { name: 'Work email' })
    expect(input.getAttribute('type')).toBe('email')
    expect(input.getAttribute('name')).toBe('email')
    expect(input.getAttribute('placeholder')).toBe('you@company.com')
  })

  it('names a label-less input by its accessible label', () => {
    render(<AglynInput name="email" ariaLabel="Email address" />)
    expect(screen.getByRole('textbox', { name: 'Email address' })).toBeTruthy()
  })

  it('keeps the dataset mapping off the page', () => {
    const { container } = render(
      <AglynInput name="email" datasetFieldId="f_email" />,
    )
    expect(container.innerHTML).not.toContain('f_email')
  })

  it('sends every answer under its name from inside a form', () => {
    const { container } = render(
      <form>
        <AglynInput name="message" multiline />
        <AglynSelect name="topic" placeholder="Choose…">
          <AglynSelectOption>Sales</AglynSelectOption>
          <AglynSelectOption value="help">Support</AglynSelectOption>
        </AglynSelect>
        <AglynRadioGroup name="plan" defaultValue="pro">
          <AglynChoiceLabel label="Free">
            <AglynRadio value="free" />
          </AglynChoiceLabel>
          <AglynChoiceLabel label="Pro">
            <AglynRadio value="pro" />
          </AglynChoiceLabel>
        </AglynRadioGroup>
        <AglynChoiceLabel label="Email me news">
          <AglynCheckbox name="marketingConsent" value="Yes" defaultChecked />
        </AglynChoiceLabel>
      </form>,
    )
    const form = container.querySelector('form') as HTMLFormElement
    ;(screen.getByRole('textbox') as HTMLTextAreaElement).value = 'Hello'
    ;(screen.getByRole('combobox') as HTMLSelectElement).value = 'help'
    expect(formData(form)).toEqual({
      message: 'Hello',
      topic: 'help',
      plan: 'pro',
      marketingConsent: 'Yes',
    })
    // The Choice Label's words name the box it holds.
    expect(
      (screen.getByRole('checkbox', { name: 'Email me news' }) as HTMLInputElement).checked,
    ).toBe(true)
  })

  it('puts its outline on its own box, where the Styles panel reaches it', () => {
    const { container } = render(
      <AglynInput
        name="email"
        sx={{ borderColor: 'rgb(255, 0, 0)', borderRadius: '12px' }}
      />,
    )
    const box = container.firstElementChild as HTMLElement
    // jsdom's cascade ignores specificity (the last matching rule wins), so
    // the rules are read as written rather than through getComputedStyle.
    const classes = [...box.classList].filter((name) => name.startsWith('css-'))
    const rules = Array.from(document.styleSheets)
      .flatMap((sheet) => Array.from(sheet.cssRules) as CSSStyleRule[])
      .filter((rule) => classes.some((name) => rule.selectorText?.includes(name)))
      .map((rule) => ({ selector: rule.selectorText.trim(), css: rule.cssText }))
    const own = rules.filter(({ selector }) => classes.some((name) => selector === `.${name}`))
    expect(own.some(({ css }) => css.includes('border-color: rgb(255, 0, 0)'))).toBe(true)
    expect(own.some(({ css }) => css.includes('border-radius: 12px'))).toBe(true)
    // The resting outline weighs nothing (`*:where()`), so the node's styles
    // and the site theme's input border color both outrank it.
    const resting = rules.find(({ selector }) => selector.startsWith('*:where('))
    expect(resting?.css).toContain('border: 1px solid')
    expect(resting?.css).toContain('border-color: rgba(0, 0, 0, 0.23)')
    // MUI's inner outline would draw a second border over it.
    const fieldset = box.querySelector('fieldset') as HTMLElement
    expect(getComputedStyle(fieldset).display).toBe('none')
  })
})

describe("an input under the site theme's Input style", () => {
  const { ThemeProvider, createTheme } = jest.requireActual(
    '@mui/material/styles',
  ) as typeof import('@mui/material/styles')

  it('draws the filled box when the theme sets text fields filled', () => {
    const { container } = render(
      <ThemeProvider
        theme={createTheme({ components: { MuiTextField: { defaultProps: { variant: 'filled' } } } })}
      >
        <AglynInput name="email" ariaLabel="Email" />
        <AglynSelect name="size" ariaLabel="Size">
          <AglynSelectOption value="s">Small</AglynSelectOption>
        </AglynSelect>
      </ThemeProvider>,
    )
    expect(container.querySelectorAll('.MuiFilledInput-root')).toHaveLength(2)
    expect(container.querySelector('.MuiOutlinedInput-root')).toBeNull()
  })

  it('draws the outlined box otherwise', () => {
    const { container } = render(<AglynInput name="email" ariaLabel="Email" />)
    expect(container.querySelector('.MuiOutlinedInput-root')).toBeTruthy()
    expect(container.querySelector('.MuiFilledInput-root')).toBeNull()
  })
})
