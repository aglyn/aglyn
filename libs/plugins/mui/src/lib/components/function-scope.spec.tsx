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

import * as Aglyn from '@aglyn/aglyn'
import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import FunctionScope, {
  FunctionInput,
  FunctionOutput,
  FunctionShow,
  functionInputSchema,
  functionOutputSchema,
  functionShowSchema,
  renderFunctionEmphasis,
  schema,
} from './function-scope'

/**
 * A CALCULATOR AN AUTHOR LAYS OUT (AGL-3202).
 *
 * The page that prompted these elements has a number box and quick picks on
 * the SAME value, two questions asked as lists, a table whose rows a filter
 * removes, and a sentence under it. This spec builds that shape from the
 * pieces and drives it the way a visitor does.
 */
const compare: Aglyn.HostFunction = {
  name: 'compare',
  parameters: [
    { name: 'sites', type: 'number', required: true, label: 'Client sites you run', defaultValue: '25' },
    {
      name: 'platform',
      type: 'text',
      label: 'Compare against',
      defaultValue: 'all',
      options: [
        { value: 'all', label: 'All platforms' },
        { value: 'webflow', label: 'Webflow' },
        { value: 'duda', label: 'Duda' },
      ],
    },
  ],
  variables: [
    { name: 'month_webflow', type: 'text' },
    { name: 'month_duda', type: 'text' },
    { name: 'show_webflow', type: 'boolean' },
    { name: 'show_duda', type: 'boolean' },
    { name: 'verdict', type: 'text' },
    { name: 'note', type: 'text' },
  ],
  operations: [
    {
      if: { left: '1', comparator: '==', right: '1' },
      then: [
        { set: 'month_webflow', expression: "'$' + format(sites * webflow_site)" },
        { set: 'month_duda', expression: "'$' + format(52 + max(0, sites - 4) * 14)" },
        { set: 'show_webflow', expression: 'true' },
        { set: 'show_duda', expression: 'true' },
        { set: 'verdict', expression: "'Aglyn is **$' + format(sites) + ' less**, for ' + sites + ' sites.'" },
      ],
      otherwise: [],
    },
    { if: { left: 'platform', comparator: '==', right: "'webflow'" }, then: [{ set: 'show_duda', expression: 'false' }], otherwise: [] },
    { if: { left: 'platform', comparator: '==', right: "'duda'" }, then: [{ set: 'show_webflow', expression: 'false' }, { set: 'note', expression: "'Duda charges upfront.'" }], otherwise: [] },
  ],
  returnValue: 'verdict',
}
const prices = { webflow_site: 25 }

const Calculator = (props: { children?: ReactNode; bound?: boolean }) => (
  <FunctionScope
    functionName="compare"
    {...(props.bound === false ? {} : { definition: compare, globals: prices })}
  >
    {props.children}
  </FunctionScope>
)
const layout = (
  <>
    <FunctionInput parameter="sites" />
    <FunctionInput parameter="sites" control="chips" choices="10, 25, 50, 100" label="Quick pick" />
    <FunctionInput parameter="platform" />
    <FunctionShow when="show_webflow">
      <span>{'Webflow row'}</span>
      <FunctionOutput name="month_webflow" />
    </FunctionShow>
    <FunctionShow when="show_duda">
      <span>{'Duda row'}</span>
      <FunctionOutput name="month_duda" />
    </FunctionShow>
    <FunctionOutput announce />
    <FunctionOutput name="note" />
  </>
)

describe('Calculator elements (AGL-3202)', () => {
  it('computes from the defaults before anyone touches it', () => {
    render(<Calculator>{layout}</Calculator>)
    expect(screen.getByText('$625')).toBeTruthy()
    expect(screen.getByText('$346')).toBeTruthy()
  })

  it('keeps two inputs on one parameter in step', () => {
    render(<Calculator>{layout}</Calculator>)
    const box = screen.getByLabelText(/Client sites you run/) as HTMLInputElement
    expect(box.value).toBe('25')
    expect(screen.getByRole('button', { name: '25' }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: '100' }))
    expect(box.value).toBe('100')
    expect(screen.getByText('$2,500')).toBeTruthy()
    fireEvent.change(box, { target: { value: '50' } })
    expect(screen.getByRole('button', { name: '50' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: '100' }).getAttribute('aria-pressed')).toBe('false')
  })

  it('removes the rows a filter turns off, and brings them back', () => {
    render(<Calculator>{layout}</Calculator>)
    const filter = screen.getByLabelText(/Compare against/) as HTMLSelectElement
    fireEvent.change(filter, { target: { value: 'webflow' } })
    expect(screen.queryByText('Duda row')).toBeNull()
    expect(screen.getByText('Webflow row')).toBeTruthy()
    fireEvent.change(filter, { target: { value: 'all' } })
    expect(screen.getByText('Duda row')).toBeTruthy()
  })

  it('shows nothing for an empty value, and the value once there is one', () => {
    render(<Calculator>{layout}</Calculator>)
    expect(screen.queryByText('Duda charges upfront.')).toBeNull()
    fireEvent.change(screen.getByLabelText(/Compare against/), { target: { value: 'duda' } })
    expect(screen.getByText('Duda charges upfront.')).toBeTruthy()
  })

  it('emphasizes what the function wrapped in asterisks, as text and never as markup', () => {
    const { container } = render(<Calculator>{layout}</Calculator>)
    const strong = container.querySelector('strong')
    expect(strong?.textContent).toBe('$25 less')
    expect(container.querySelector('[aria-live="polite"]')?.textContent).toBe(
      'Aglyn is $25 less, for 25 sites.',
    )
    const hostile = render(<>{renderFunctionEmphasis('**<img src=x onerror=alert(1)>** & <b>bold</b>')}</>)
    expect(hostile.container.querySelector('img')).toBeNull()
    expect(hostile.container.querySelector('b')).toBeNull()
    expect(hostile.container.textContent).toBe('<img src=x onerror=alert(1)> & <b>bold</b>')
  })

  it('inverts a condition', () => {
    render(
      <Calculator>
        <FunctionShow when="note" invert>
          <span>{'no note yet'}</span>
        </FunctionShow>
      </Calculator>,
    )
    expect(screen.getByText('no note yet')).toBeTruthy()
  })
})

describe('Calculator elements with no function behind them', () => {
  const inEditor = (children: ReactNode) => (
    <Aglyn.ScreenLinkContext.Provider
      value={{ screens: {}, suppressNavigation: true, editorInert: true } as never}
    >
      {children}
    </Aglyn.ScreenLinkContext.Provider>
  )

  it('shows a visitor nothing that only an author could act on', () => {
    const { container } = render(<Calculator bound={false}>{layout}</Calculator>)
    // The static labels an author placed are content; the unbound inputs and
    // results are not, and none of them is drawn.
    expect(container.querySelector('input, select, button')).toBeNull()
    expect(container.textContent).toBe('Webflow rowDuda row')
  })

  it('draws the design in the besigner so it can be laid out', () => {
    render(
      inEditor(
        <Calculator bound={false}>
          <FunctionInput parameter="sites" control="chips" choices="10, 25" label="Quick pick" />
          <FunctionOutput name="month_webflow" placeholder="$625" />
          <FunctionOutput />
          <FunctionShow when="show_webflow">
            <span>{'row'}</span>
          </FunctionShow>
        </Calculator>,
      ),
    )
    // Drawn, and inert: a quick pick in the besigner is a shape, not a button.
    expect(screen.getByText('10')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '10' })).toBeNull()
    expect(screen.getByText('$625')).toBeTruthy()
    expect(screen.getByText('{result}')).toBeTruthy()
    expect(screen.getByText('row')).toBeTruthy()
  })

  it('outside a Calculator, an input and a result are nothing', () => {
    const { container } = render(
      <>
        <FunctionInput parameter="sites" />
        <FunctionOutput name="verdict" />
      </>,
    )
    expect(container.textContent).toBe('')
  })
})

describe('the schemas', () => {
  it('declares which pieces hold children and which do not', () => {
    expect(schema.flags?.selfClosing).toBeUndefined()
    expect(functionShowSchema.flags?.selfClosing).toBeUndefined()
    expect(functionInputSchema.flags?.selfClosing).toBe(Aglyn.FEATURE_FLAG.ENABLED)
    expect(functionOutputSchema.flags?.selfClosing).toBe(Aglyn.FEATURE_FLAG.ENABLED)
  })

  it('offers every control kind the renderer draws', () => {
    const control = (functionInputSchema.attributes ?? []).find((a) => a.name === 'control')
    const values = (control as unknown as { options: { value: string }[] }).options.map((o) => o.value)
    expect(values).toEqual(['auto', 'number', 'text', 'select', 'chips', 'switch'])
  })
})
