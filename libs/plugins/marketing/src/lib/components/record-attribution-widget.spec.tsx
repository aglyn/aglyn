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
 */

import { render, screen } from '@testing-library/react'
import { RecordAttributionWidget } from './record-attribution-widget'

/** What the attribution component was asked to read. */
const mockAsked: Array<Record<string, unknown>> = []
jest.mock('./conversion-attribution.component', () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => {
    mockAsked.push(props)
    return <p>{'attribution'}</p>
  },
}))

beforeEach(() => {
  mockAsked.length = 0
})

describe('the widget marketing draws in another plugin’s attribution zone', () => {
  it('reads the host’s own word for the record as the identify moment', () => {
    render(<RecordAttributionWidget hostId="site1" recordKind="lead" recordId="p1" />)
    expect(screen.getByText('attribution')).toBeTruthy()
    expect(mockAsked).toEqual([{ hostId: 'site1', kind: 'lead', refId: 'p1' }])
  })

  it.each(['contact', 'form', 'booking'])('credits a %s', (recordKind) => {
    render(<RecordAttributionWidget hostId="site1" recordKind={recordKind} recordId="r1" />)
    expect(mockAsked[0]?.['kind']).toBe(recordKind)
  })

  it('draws nothing, and reads nothing, for a kind it never credits', () => {
    const { container } = render(
      <RecordAttributionWidget hostId="site1" recordKind="invoice" recordId="r1" />,
    )
    expect(container.textContent).toBe('')
    expect(mockAsked).toEqual([])
  })

  it('draws nothing without a site or a record', () => {
    render(<RecordAttributionWidget hostId={null} recordKind="lead" recordId="r1" />)
    render(<RecordAttributionWidget hostId="site1" recordKind="lead" />)
    expect(mockAsked).toEqual([])
  })

  it('THE CONTROL: the same render does draw for a kind it credits', () => {
    // Otherwise the two absences above pass on a widget that never draws.
    const { container } = render(
      <RecordAttributionWidget hostId="site1" recordKind="lead" recordId="r1" />,
    )
    expect(container.textContent).toBe('attribution')
  })
})
