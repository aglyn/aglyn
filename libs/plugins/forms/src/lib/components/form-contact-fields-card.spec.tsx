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
 * The form's page decides where each field saves on the contact (AGL-2601).
 *
 * What has to hold is the WRITE: one `fields` array back onto the form
 * document, with the picked key on the field the author changed and every
 * other field exactly as it was — the declaration is what a submission is
 * judged against, and a save that dropped a field or left an `undefined` in
 * the array would be refused by Firestore on the field the author never
 * touched. The rest is that the control shows the stored mapping, names a
 * retired one so it can be cleared, and offers nothing when the org has
 * defined nothing.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ContactFieldDefinition } from '@aglyn/aglyn'

/** The org's definitions, as the hook would hand them over. */
let mockDefinitions: (ContactFieldDefinition & { $id: string })[] = []
/** Every `updateDoc` the card made: `[ref, payload]`. */
let mockWrites: [unknown, Record<string, unknown>][] = []

jest.mock('firebase/firestore', () => ({
  __esModule: true,
  doc: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
  updateDoc: async (ref: unknown, payload: Record<string, unknown>) => {
    mockWrites.push([ref, payload])
  },
}))

jest.mock('@aglyn/tenant-feature-instance', () => ({
  __esModule: true,
  useFirestore: () => ({}),
  useOrgDataScope: () => ({ orgId: 'org1', ready: true, scope: ['orgs', 'org1'] }),
}))

jest.mock('@aglyn/plugins-crm/hooks/use-contact-field-definitions', () => ({
  __esModule: true,
  useContactFieldDefinitions: () => ({
    definitions: mockDefinitions,
    active: mockDefinitions.filter((definition) => !definition.retiredAt),
    ready: true,
    fromCache: false,
  }),
}))

jest.mock('@aglyn/shared-ui-jsx', () => ({
  __esModule: true,
  CardDisplay: (props: any) => (
    <section aria-label="card">
      {props.header ? <h2>{props.header}</h2> : null}
      {props.children}
    </section>
  ),
}))

jest.mock('@aglyn/shared-ui-snackstack', () => ({
  __esModule: true,
  useSnackbar: () => ({ enqueueSnackbar: () => undefined }),
}))

jest.mock('@aglyn/shared-util-timestamp', () => ({
  __esModule: true,
  Timestamp: { now: () => ({ __now: true }) },
}))

import FormContactFieldsCard from './form-contact-fields-card'

const definition = (
  overrides: Partial<ContactFieldDefinition> & Pick<ContactFieldDefinition, 'key' | 'type'>,
): ContactFieldDefinition & { $id: string } => ({
  $id: `id_${overrides.key}`,
  label: overrides.key,
  order: 0,
  visibleTo: ['org'],
  hostId: 'h1',
  ...overrides,
})

const DEFINITIONS = [
  definition({ key: 'annual_revenue', label: 'Annual revenue', type: 'number', order: 0 }),
  definition({ key: 'tier', label: 'Tier', type: 'select', options: ['Gold', 'Silver'], order: 1 }),
  definition({ key: 'legacy', label: 'Legacy', type: 'text', order: 2, retiredAt: 1 }),
]

const FIELDS = [
  { fieldName: 'email', fieldType: 'email' as const },
  { fieldName: 'revenue', fieldType: 'text' as const, label: 'Revenue', contactFieldKey: 'annual_revenue' },
  { fieldName: 'plan', fieldType: 'select' as const, label: 'Plan', options: ['Gold', 'Silver'] },
]

/** Opens a MUI select by its accessible name and picks the named option. */
function pick(control: RegExp, option: RegExp) {
  fireEvent.mouseDown(screen.getByRole('combobox', { name: control }))
  fireEvent.click(screen.getByRole('option', { name: option }))
}

const saveButton = () => screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement

/** What a MUI select shows, by its accessible name. */
const shown = (control: RegExp) => screen.getByRole('combobox', { name: control }).textContent

describe('FormContactFieldsCard', () => {
  beforeEach(() => {
    mockDefinitions = DEFINITIONS
    mockWrites = []
  })

  it('draws one choice per declared field, showing the stored mapping, with nothing to save', () => {
    render(<FormContactFieldsCard hostId="h1" formId="f1" fields={FIELDS} />)
    expect(screen.getAllByRole('combobox')).toHaveLength(3)
    expect(shown(/Revenue \(revenue\)/)).toBe('Annual revenue · Number')
    expect(shown(/^email/)).toBe('Not saved to a contact field')
    expect(saveButton().disabled).toBe(true)
  })

  it('offers only the ACTIVE definitions as destinations', () => {
    render(<FormContactFieldsCard hostId="h1" formId="f1" fields={FIELDS} />)
    fireEvent.mouseDown(screen.getByRole('combobox', { name: /Plan \(plan\)/ }))
    const options = screen.getAllByRole('option').map((option) => option.textContent)
    expect(options).toEqual([
      'Not saved to a contact field',
      'Annual revenue · Number',
      'Tier · Choice',
    ])
  })

  it('saves the picked key onto that field and writes every other field back as it was', async () => {
    render(<FormContactFieldsCard hostId="h1" formId="f1" fields={FIELDS} />)
    pick(/Plan \(plan\)/, /Tier · Choice/)
    expect(saveButton().disabled).toBe(false)
    fireEvent.click(saveButton())
    await waitFor(() => expect(mockWrites).toHaveLength(1))
    const [ref, payload] = mockWrites[0]
    expect(ref).toEqual({ path: 'hosts/h1/forms/f1' })
    expect(payload.fields).toEqual([
      { fieldName: 'email', fieldType: 'email' },
      { fieldName: 'revenue', fieldType: 'text', label: 'Revenue', contactFieldKey: 'annual_revenue' },
      { fieldName: 'plan', fieldType: 'select', label: 'Plan', options: ['Gold', 'Silver'], contactFieldKey: 'tier' },
    ])
    expect(payload.updatedAt).toEqual({ __now: true })
  })

  it('clearing a mapping removes the key from that field rather than writing undefined', async () => {
    render(<FormContactFieldsCard hostId="h1" formId="f1" fields={FIELDS} />)
    pick(/Revenue \(revenue\)/, /Not saved to a contact field/)
    fireEvent.click(saveButton())
    await waitFor(() => expect(mockWrites).toHaveLength(1))
    const written = mockWrites[0][1].fields as Record<string, unknown>[]
    expect(written[1]).toEqual({ fieldName: 'revenue', fieldType: 'text', label: 'Revenue' })
    expect(written[1]).not.toHaveProperty('contactFieldKey')
  })

  it('shows a mapping onto a retired field, and says so, so it can be cleared', () => {
    render(
      <FormContactFieldsCard
        hostId="h1"
        formId="f1"
        fields={[{ fieldName: 'old', fieldType: 'text', contactFieldKey: 'legacy' }]}
      />,
    )
    expect(shown(/^old/)).toBe('legacy — retired field')
    expect(screen.getByText(/This field is retired/)).toBeTruthy()
  })

  it('offers nothing when the org has defined no fields and none is mapped, and says where to define them', () => {
    mockDefinitions = []
    render(
      <FormContactFieldsCard
        hostId="h1"
        formId="f1"
        fields={[
          { fieldName: 'email', fieldType: 'email' },
          { fieldName: 'plan', fieldType: 'select', label: 'Plan' },
        ]}
      />,
    )
    expect(screen.queryAllByRole('combobox')).toHaveLength(0)
    expect(screen.getByText(/No custom contact fields are defined yet/)).toBeTruthy()
  })

  it('keeps showing a mapping onto a field that no longer exists, so it can be cleared', () => {
    mockDefinitions = []
    render(<FormContactFieldsCard hostId="h1" formId="f1" fields={FIELDS} />)
    expect(shown(/Revenue \(revenue\)/)).toBe('annual_revenue — no such field')
    expect(screen.getByText(/This field no longer exists/)).toBeTruthy()
  })
})
