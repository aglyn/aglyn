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

import type * as Aglyn from '@aglyn/aglyn'
import { fireEvent, render, screen } from '@testing-library/react'
import FunctionWidget, {
  parseFunctionWidgetOutputs,
  schema,
} from './function-widget'

/**
 * WHAT A REAL CALCULATOR NEEDED (AGL-3202).
 *
 * The first page built on this widget compared five platforms and could ask
 * for nothing but free text and answer with nothing but one line. These are
 * the four things it lacked, each driven the way a visitor drives it — and,
 * first, the proof that a widget which opts into none of them is unchanged.
 */
const sum: Aglyn.HostFunction = {
  name: 'sum',
  parameters: [
    { name: 'P1', type: 'number', required: true },
    { name: 'P2', type: 'number' },
  ],
  variables: [{ name: 'total', type: 'number' }],
  operations: [
    {
      if: { left: '1', comparator: '==', right: '1' },
      then: [{ set: 'total', expression: 'P1 + P2' }],
      otherwise: [],
    },
  ],
  returnValue: 'total',
}

const compare: Aglyn.HostFunction = {
  name: 'compare',
  parameters: [
    {
      name: 'sites',
      type: 'number',
      required: true,
      label: 'Client sites you run',
      defaultValue: '25',
    },
    {
      name: 'tier',
      type: 'text',
      label: 'Each client site needs',
      options: [
        { value: 'cms', label: 'A CMS and room to grow' },
        { value: 'entry', label: 'The entry plan only' },
      ],
    },
    { name: 'annual', type: 'boolean', label: 'Billed yearly' },
  ],
  variables: [
    { name: 'rate', type: 'number' },
    { name: 'webflow', type: 'text' },
    { name: 'each', type: 'text' },
    { name: 'verdict', type: 'text' },
  ],
  operations: [
    {
      if: { left: 'tier', comparator: '==', right: "'cms'" },
      then: [{ set: 'rate', expression: 'webflow_premium_site' }],
      otherwise: [{ set: 'rate', expression: 'webflow_basic_site' }],
    },
    {
      if: { left: '1', comparator: '==', right: '1' },
      then: [
        { set: 'webflow', expression: "'$' + format(sites * rate)" },
        { set: 'each', expression: "'$' + format(rate, 2)" },
        { set: 'verdict', expression: "sites + ' sites on ' + tier" },
      ],
      otherwise: [],
    },
  ],
  returnValue: 'verdict',
}
const prices = { webflow_premium_site: 25, webflow_basic_site: 15 }

describe('Function Widget, as it always was', () => {
  it('asks in text boxes named by identifier and answers on the button', () => {
    render(<FunctionWidget functionName="sum" definition={sum} />)
    fireEvent.change(screen.getByLabelText(/^P1/), { target: { value: '2' } })
    fireEvent.change(screen.getByLabelText(/^P2/), { target: { value: '5' } })
    expect(screen.queryByRole('alert')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Calculate' }))
    expect(screen.getByRole('alert').textContent).toBe('Result: 7')
  })

  it('holds the answer still while the visitor edits', () => {
    render(<FunctionWidget functionName="sum" definition={sum} />)
    fireEvent.change(screen.getByLabelText(/^P1/), { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Calculate' }))
    fireEvent.change(screen.getByLabelText(/^P1/), { target: { value: '9' } })
    expect(screen.getByRole('alert').textContent).toBe('Result: 2')
  })

  it('reports a missing required value once asked', () => {
    render(<FunctionWidget functionName="sum" definition={sum} />)
    fireEvent.click(screen.getByRole('button', { name: 'Calculate' }))
    expect(screen.getByRole('alert').textContent).toContain('required')
  })

  it('renders the bare element on a published page with no definition', () => {
    const { container } = render(<FunctionWidget functionName="gone" />)
    expect(container.textContent).toBe('')
  })
})

describe('Function Widget: what a calculator needed (AGL-3202)', () => {
  const widget = (
    <FunctionWidget
      functionName="compare"
      definition={compare}
      globals={prices}
      autoRun
      outputs={'webflow | Webflow, per month\neach | Webflow, per site'}
    />
  )

  it('labels each input as its author wrote it, and starts from the default', () => {
    render(widget)
    const sites = screen.getByLabelText(
      /Client sites you run/,
    ) as HTMLInputElement
    expect(sites.type).toBe('number')
    expect(sites.value).toBe('25')
    expect(screen.queryByLabelText(/^sites/)).toBeNull()
  })

  it('asks a choice as a choice, and a yes/no as a switch', () => {
    render(widget)
    const tier = screen.getByLabelText(
      /Each client site needs/,
    ) as HTMLSelectElement
    expect(tier.tagName).toBe('SELECT')
    expect([...tier.options].map((option) => option.textContent)).toEqual([
      'A CMS and room to grow',
      'The entry plan only',
    ])
    // The function receives the choice on screen, not an empty string.
    expect(tier.value).toBe('cms')
    expect(screen.getByRole('switch', { name: 'Billed yearly' })).toBeTruthy()
  })

  it('answers with several named results, from the site variables', () => {
    const { container } = render(widget)
    const read = (name: string) =>
      container.querySelector(`[data-aglyn-function-output="${name}"]`)
        ?.textContent
    expect(read('webflow')).toBe('$625')
    expect(read('each')).toBe('$25.00')
    expect(read('returnValue')).toBe('25 sites on cms')
    expect(screen.getByText('Webflow, per month')).toBeTruthy()
  })

  it('recomputes as the visitor types, with no button', () => {
    const { container } = render(widget)
    expect(screen.queryByRole('button')).toBeNull()
    fireEvent.change(screen.getByLabelText(/Client sites you run/), {
      target: { value: '100' },
    })
    fireEvent.change(screen.getByLabelText(/Each client site needs/), {
      target: { value: 'entry' },
    })
    expect(
      container.querySelector('[data-aglyn-function-output="webflow"]')
        ?.textContent,
    ).toBe('$1,500')
  })

  it('says nothing while a required input is still empty', () => {
    const noDefault: Aglyn.HostFunction = {
      ...compare,
      parameters: compare.parameters.map((parameter) =>
        parameter.name === 'sites'
          ? { ...parameter, defaultValue: undefined }
          : parameter,
      ),
    }
    render(
      <FunctionWidget
        functionName="compare"
        definition={noDefault}
        globals={prices}
        autoRun
      />,
    )
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('still says so when the function itself is wrong', () => {
    // No globals: the function names a variable nobody supplied.
    render(
      <FunctionWidget functionName="compare" definition={compare} autoRun />,
    )
    expect(screen.getByRole('alert').textContent).toContain(
      'webflow_premium_site',
    )
  })
})

describe('parseFunctionWidgetOutputs', () => {
  it('reads one row per line and labels a bare name with itself', () => {
    expect(
      parseFunctionWidgetOutputs('total | Per month\n\n each \ntotal | Again'),
    ).toEqual([
      { name: 'total', label: 'Per month' },
      { name: 'each', label: 'each' },
    ])
    expect(parseFunctionWidgetOutputs(undefined)).toEqual([])
  })

  it('is what the schema offers the author', () => {
    const names = (schema.attributes ?? []).map((attribute) => attribute.name)
    expect(names).toEqual(
      expect.arrayContaining(['functionName', 'outputs', 'autoRun']),
    )
  })
})
