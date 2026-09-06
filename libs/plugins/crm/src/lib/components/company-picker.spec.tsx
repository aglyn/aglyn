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
 * The company picker SUGGESTS from an email address and never links on
 * its own (AGL-2597).
 *
 * The contact record drops this control into its properties card. What it
 * owes the reader: the stored value is what is selected, a company the list
 * does not carry still reads as selected rather than as "No company", and a
 * matching domain is offered as one click — not applied, because the person
 * who wrote from `@acme.com` may be a contractor or a customer of Acme's.
 */

import { fireEvent, render, screen } from '@testing-library/react'
import { CompanyPicker, useCompanyOptions } from './company-picker'

/** The options listen, as the hook builds it. */
let builtQuery: { path: string; clauses: unknown[] } | null = null

jest.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...segments: string[]) => ({
    path: segments.join('/'),
    clauses: [] as unknown[],
  }),
  query: (base: { path: string; clauses: unknown[] }, ...clauses: unknown[]) => ({
    ...base,
    clauses: [...base.clauses, ...clauses],
  }),
  where: (...args: unknown[]) => ({ kind: 'where', args }),
  orderBy: (...args: unknown[]) => ({ kind: 'orderBy', args }),
  limit: (...args: unknown[]) => ({ kind: 'limit', args }),
}))

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useOrgDataScope: () => ({ scope: ['orgs', 'org-1'], orgId: 'org-1', ready: true }),
  useFirestoreCollection: (build: () => typeof builtQuery) => {
    builtQuery = build()
    return {
      data: builtQuery
        ? [
            { $id: 'c-acme', name: 'Acme', domain: 'acme.com', nameLower: 'acme' },
            { $id: 'c-globex', name: 'Globex', nameLower: 'globex' },
          ]
        : [],
      status: 'success',
      fromCache: false,
    }
  },
}))

const OPTIONS = [
  { id: 'c-acme', name: 'Acme', domain: 'acme.com' },
  { id: 'c-globex', name: 'Globex', domain: null },
]

describe('CompanyPicker (AGL-2597)', () => {
  it('offers the company whose domain matches the email, as one click', () => {
    const onChange = jest.fn()
    render(
      <CompanyPicker
        options={OPTIONS}
        value={null}
        onChange={onChange}
        email="jane@ACME.com"
      />,
    )

    expect(screen.getByText(/Suggested from the email address: Acme/)).toBeTruthy()
    fireEvent.click(screen.getByText('Use'))
    expect(onChange).toHaveBeenCalledWith('c-acme')
  })

  it('suggests nothing for a public mailbox or when already linked there', () => {
    const { rerender } = render(
      <CompanyPicker options={OPTIONS} value={null} onChange={jest.fn()} email="jane@gmail.com" />,
    )
    expect(screen.queryByText(/Suggested/)).toBeNull()

    rerender(
      <CompanyPicker options={OPTIONS} value="c-acme" onChange={jest.fn()} email="jane@acme.com" />,
    )
    expect(screen.queryByText(/Suggested/)).toBeNull()
  })

  it('keeps a stored company the list does not carry selected', () => {
    render(<CompanyPicker options={OPTIONS} value="c-unknown-123456" onChange={jest.fn()} />)
    // Not "No company": a save from here would otherwise unlink them.
    expect(screen.getByText('Company 123456')).toBeTruthy()
  })
})

describe('useCompanyOptions (AGL-2597)', () => {
  function Probe() {
    const { options, ready, truncated } = useCompanyOptions({ hostId: 'host-1' })
    return (
      <div>
        <span>{ready ? 'ready' : 'loading'}</span>
        <span>{truncated ? 'truncated' : 'complete'}</span>
        <ul>
          {options.map((option) => (
            <li key={option.id}>{`${option.name}:${option.domain ?? ''}`}</li>
          ))}
        </ul>
      </div>
    )
  }

  it('listens under the scope predicate, by name, bounded', () => {
    builtQuery = null
    render(<Probe />)

    expect(builtQuery?.path).toBe('orgs/org-1/companies')
    expect(builtQuery?.clauses).toContainEqual({
      kind: 'where',
      args: ['visibleTo', 'array-contains-any', ['org', 'host:host-1']],
    })
    expect(builtQuery?.clauses).toContainEqual({ kind: 'orderBy', args: ['nameLower'] })
    // One past the ceiling, so `truncated` is a fact and not a guess.
    expect(builtQuery?.clauses).toContainEqual({ kind: 'limit', args: [201] })
    expect(screen.getByText('ready')).toBeTruthy()
    expect(screen.getByText('complete')).toBeTruthy()
    expect(screen.getByText('Acme:acme.com')).toBeTruthy()
    expect(screen.getByText('Globex:')).toBeTruthy()
  })
})
