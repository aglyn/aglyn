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
 * The company picker SEARCHES, CREATES, and SUGGESTS — and never links on
 * its own (AGL-2597, AGL-2613).
 *
 * The contact record and the create drawer drop this control into their
 * forms. What it owes the reader: the stored value is what is selected, a
 * company the list does not carry still reads as selected rather than as
 * empty, a typed name nobody has filed becomes a "Create" row that makes the
 * company and selects it, a matching domain is offered as one click — not
 * applied, because the person who wrote from `@acme.com` may be a contractor
 * or a customer of Acme's — and a name the record already carries with no
 * link is offered as the company to link or create.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
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
  useUser: () => ({ data: { uid: 'uid-1' } }),
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

const input = () => screen.getByRole('combobox', { name: 'Company' })
/**
 * Type into the field the way a person does: focused first. The control
 * resets what an unfocused input holds to the selected value's label, so a
 * change event without the focus reads as nothing typed.
 */
const type = (text: string) => {
  fireEvent.focus(input())
  fireEvent.change(input(), { target: { value: text } })
}

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
    expect(onChange).toHaveBeenCalledWith('c-acme', OPTIONS[0])
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
    // Not empty: a save from here would otherwise unlink them.
    expect(screen.getByDisplayValue('Company 123456')).toBeTruthy()
  })

  it('searches the list by name and hands back the option behind the choice', async () => {
    const onChange = jest.fn()
    render(<CompanyPicker options={OPTIONS} value={null} onChange={onChange} />)
    type('glo')
    // Narrowed: the other company is not offered for a name it does not match.
    expect(screen.queryByText('Acme · acme.com')).toBeNull()
    fireEvent.click(await screen.findByText('Globex'))
    expect(onChange).toHaveBeenCalledWith('c-globex', OPTIONS[1])
  })
})

describe('CompanyPicker creates inline (AGL-2613)', () => {
  it('offers to create a name nobody has filed, and selects the company once made', async () => {
    const onChange = jest.fn()
    const onCreate = jest.fn(async (name: string) => ({ id: 'c-new', name, domain: null }))
    render(<CompanyPicker options={OPTIONS} value={null} onChange={onChange} onCreate={onCreate} />)

    type('Initech')
    fireEvent.click(await screen.findByText('Create “Initech”'))

    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith('c-new', { id: 'c-new', name: 'Initech', domain: null }),
    )
    expect(onCreate).toHaveBeenCalledWith('Initech')
  })

  it('offers no create row for a name a company already has, and none without a creator', async () => {
    const { rerender } = render(
      <CompanyPicker options={OPTIONS} value={null} onChange={jest.fn()} onCreate={jest.fn()} />,
    )
    type('acme')
    expect(await screen.findByText('Acme · acme.com')).toBeTruthy()
    expect(screen.queryByText(/^Create “/)).toBeNull()

    rerender(<CompanyPicker options={OPTIONS} value={null} onChange={jest.fn()} />)
    type('Initech')
    expect(screen.queryByText(/^Create “/)).toBeNull()
  })

  it('says why when the company could not be created, and links nothing', async () => {
    const onChange = jest.fn()
    const onCreate = jest.fn(async () => {
      throw new Error('A company needs a name.')
    })
    render(<CompanyPicker options={OPTIONS} value={null} onChange={onChange} onCreate={onCreate} />)
    type('Initech')
    fireEvent.click(await screen.findByText('Create “Initech”'))
    expect(await screen.findByText('A company needs a name.')).toBeTruthy()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('offers a recorded name with no link as the company to link, or to create', () => {
    const onChange = jest.fn()
    const onCreate = jest.fn(async (name: string) => ({ id: 'c-new', name, domain: null }))
    const { rerender } = render(
      <CompanyPicker
        options={OPTIONS}
        value={null}
        onChange={onChange}
        onCreate={onCreate}
        fallbackName="  acme "
      />,
    )
    // A company by that name exists: one click links it.
    expect(screen.getByText(/Recorded as “acme” — a company by that name exists/)).toBeTruthy()
    fireEvent.click(screen.getByText('Use'))
    expect(onChange).toHaveBeenCalledWith('c-acme', OPTIONS[0])

    rerender(
      <CompanyPicker
        options={OPTIONS}
        value={null}
        onChange={onChange}
        onCreate={onCreate}
        fallbackName="Initech"
      />,
    )
    fireEvent.click(screen.getByText('Create “Initech”'))
    expect(onCreate).toHaveBeenCalledWith('Initech')

    // Once linked, the note is gone: the name is no longer a loose label.
    rerender(
      <CompanyPicker
        options={OPTIONS}
        value="c-acme"
        onChange={onChange}
        onCreate={onCreate}
        fallbackName="Acme"
      />,
    )
    expect(screen.queryByText(/Recorded as/)).toBeNull()
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
