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
 * THE CRM CONTROLS ARE ON THE FORM (AGL-2603).
 *
 * The round-trip spec beside this one proves the DRAFT carries the four new
 * dimensions. It cannot prove a reader can reach them: a dimension the model
 * evaluates and the form has no control for is unreachable, which is the
 * exact defect that spec was written against. So this one renders the form
 * and drives each control — the team as owners, the stages by name, a
 * company found by typing, a field condition typed by its definition — and
 * reads what the parent is handed.
 */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import DynamicListRuleFields, {
  describeDynamicListRule,
  draftToRule,
  EMPTY_RULE_DRAFT,
  type DynamicListRuleDraft,
} from './dynamic-list-rule-fields'

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useFirestoreCollection: () => ({ data: [], status: 'success', fromCache: false }),
  useScopeTokens: () => ({ tokens: ['org'], orgWide: true, loaded: true }),
  useHostCampaigns: () => ({ options: [], truncated: false, ready: true }),
  useOrgMemberOptions: () => ({
    options: [
      { uid: 'uid-a', label: 'Ada Lovelace', email: 'ada@example.com' },
      { uid: 'uid-b', label: 'bea@example.com', email: 'bea@example.com' },
    ],
    ready: true,
    error: null,
  }),
}))
jest.mock('../hooks/use-org-contact-segments', () => ({
  useOrgContactSegments: () => [],
}))
// The saved-view picker beside the segment picker (AGL-2617); none here.
jest.mock('../hooks/use-org-crm-views', () => ({
  useOrgCrmViews: () => [],
}))
jest.mock('../hooks/use-org-lists', () => ({ useOrgLists: () => [] }))
jest.mock('../hooks/use-org-contact-fields', () => ({
  useOrgContactFields: () => ({
    fields: [
      {
        $id: 'f1',
        key: 'plan',
        label: 'Plan',
        type: 'select',
        options: ['starter', 'enterprise'],
        order: 0,
      },
      { $id: 'f2', key: 'seats', label: 'Seats', type: 'number', order: 1 },
    ],
    ready: true,
  }),
}))
/** Every search the company control ran. */
const searches: string[] = []
jest.mock('../hooks/use-org-company-options', () => ({
  useOrgCompanyOptions: ({ search }: { search: string }) => {
    searches.push(search)
    return {
      hits: search ? [{ id: 'co_acme', label: 'Acme' }] : [],
      names: { co_acme: 'Acme' },
      searching: false,
    }
  },
}))
jest.mock(
  '@aglyn/shared-ui-email-campaigns/components/campaign-picker.component',
  () => ({ __esModule: true, default: () => null }),
)

/** The form as its page holds it: controlled, with the parent seeing every draft. */
function Harness(props: {
  initial?: Partial<DynamicListRuleDraft>
  onDraft: (draft: DynamicListRuleDraft) => void
}) {
  const [draft, setDraft] = useState<DynamicListRuleDraft>({
    ...EMPTY_RULE_DRAFT,
    ...props.initial,
  })
  return (
    <DynamicListRuleFields
      scope={['orgs', 'org-1']}
      hostId="host-1"
      draft={draft}
      onChange={(next) => {
        setDraft(next)
        props.onDraft(next)
      }}
    />
  )
}

const last = (spy: jest.Mock): DynamicListRuleDraft =>
  spy.mock.calls[spy.mock.calls.length - 1][0]

beforeEach(() => {
  searches.length = 0
})

describe('the CRM controls on the rule form', () => {
  /*
   * THE RE-ENGAGEMENT WINDOW (AGL-2616): typed as days, stored as the
   * facet-read dimension, and read back in the sentence that tells it apart
   * from the address-level "one of your emails" arms.
   */
  it('takes a re-engagement window in days and reads it back as one of your campaigns', () => {
    const onDraft = jest.fn()
    render(<Harness onDraft={onDraft} />)
    fireEvent.change(
      screen.getByLabelText('Engaged with a campaign within (days)'),
      { target: { value: '30' } },
    )
    expect(last(onDraft).engagedWithinDays).toBe('30')
    const rule = draftToRule(last(onDraft))
    expect(rule.engagedWithinDays).toBe(30)
    expect(rule.engagement).toBeUndefined()
    expect(describeDynamicListRule(rule)).toContain(
      'Opened or clicked one of your campaigns in the last 30 days.',
    )
    // An emptied box is no filter at all.
    fireEvent.change(
      screen.getByLabelText('Engaged with a campaign within (days)'),
      { target: { value: '' } },
    )
    expect(draftToRule(last(onDraft)).engagedWithinDays).toBeUndefined()
  })

  it('offers the team as owners and stores the chosen uid', () => {
    const onDraft = jest.fn()
    render(<Harness onDraft={onDraft} />)
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Owned by' }))
    const menu = screen.getByRole('listbox')
    expect(within(menu).getByText('bea@example.com')).toBeTruthy()
    fireEvent.click(within(menu).getByText('Ada Lovelace'))
    expect(last(onDraft).ownerUids).toEqual(['uid-a'])
  })

  it('offers every lifecycle stage by name and stores the id', () => {
    const onDraft = jest.fn()
    render(<Harness onDraft={onDraft} />)
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Lifecycle stage' }))
    const menu = screen.getByRole('listbox')
    expect(within(menu).getByText('Marketing qualified')).toBeTruthy()
    expect(within(menu).getByText('Evangelist')).toBeTruthy()
    fireEvent.click(within(menu).getByText('Customer'))
    expect(last(onDraft).lifecycleStages).toEqual(['customer'])
  })

  it('finds a company by what is typed and stores its id', async () => {
    const onDraft = jest.fn()
    render(<Harness onDraft={onDraft} />)
    const input = screen.getByLabelText('At company')
    fireEvent.change(input, { target: { value: 'ac' } })
    await waitFor(() => expect(searches).toContain('ac'))
    fireEvent.click(await screen.findByRole('option', { name: 'Acme' }))
    expect(last(onDraft).companyIds).toEqual(['co_acme'])
  })

  it('shows a stored company by name, not by id', () => {
    render(<Harness onDraft={jest.fn()} initial={{ companyIds: ['co_acme'] }} />)
    expect(screen.getByText('Acme')).toBeTruthy()
    expect(screen.queryByText('co_acme')).toBeNull()
  })

  it('adds a field condition from the org’s definitions', () => {
    const onDraft = jest.fn()
    render(<Harness onDraft={onDraft} />)
    fireEvent.click(screen.getByText('Add a field condition'))
    expect(last(onDraft).custom).toEqual([{ key: 'plan', op: 'eq', value: '' }])
    // The field picker offers the definitions by LABEL.
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Field' }))
    const menu = screen.getByRole('listbox')
    expect(within(menu).getByText('Seats')).toBeTruthy()
    fireEvent.click(within(menu).getByText('Seats'))
    expect(last(onDraft).custom).toEqual([{ key: 'seats', op: 'eq', value: '' }])
  })

  it('types the value by the field’s definition — a number field stores a number', () => {
    const onDraft = jest.fn()
    render(
      <Harness
        onDraft={onDraft}
        initial={{ custom: [{ key: 'seats', op: 'gt', value: '' }] }}
      />,
    )
    fireEvent.change(screen.getByLabelText('Value'), { target: { value: '10' } })
    expect(last(onDraft).custom).toEqual([{ key: 'seats', op: 'gt', value: 10 }])
  })

  it('offers a select field’s own options as the value', () => {
    const onDraft = jest.fn()
    render(
      <Harness
        onDraft={onDraft}
        initial={{ custom: [{ key: 'plan', op: 'eq', value: '' }] }}
      />,
    )
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Value' }))
    const menu = screen.getByRole('listbox')
    fireEvent.click(within(menu).getByText('enterprise'))
    expect(last(onDraft).custom).toEqual([{ key: 'plan', op: 'eq', value: 'enterprise' }])
  })

  it('asks for no value when the condition is about presence', () => {
    render(
      <Harness
        onDraft={jest.fn()}
        initial={{ custom: [{ key: 'plan', op: 'unset' }] }}
      />,
    )
    // Anti-vacuity: the row itself is on screen, so the missing value control
    // is a decision and not an unrendered form.
    expect(screen.getByRole('combobox', { name: 'Field' })).toBeTruthy()
    expect(screen.queryByLabelText('Value')).toBeNull()
    expect(screen.queryByRole('combobox', { name: 'Value' })).toBeNull()
  })
})
