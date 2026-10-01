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

import { within } from '@testing-library/dom'
import {
  type FiberRenderCounter,
  FRESH_REGISTRY_TIMEOUT_MS,
  installFiberRenderCounter,
} from '@aglyn/shared-ui-jsx/testing/fiber-render-counter'

jest.setTimeout(FRESH_REGISTRY_TIMEOUT_MS)

/*
 * The reads, answered with values that keep their identity from render to
 * render, as the hooks' own memoized results do.
 */
jest.mock('@aglyn/tenant-feature-instance', () => {
  const campaigns = {
    options: [{ value: 'spring', label: 'Spring push' }],
    truncated: false,
    ready: true,
  }
  const team = {
    options: [{ uid: 'uid-a', label: 'Ada Lovelace', email: 'ada@example.com' }],
    ready: true,
    error: null,
  }
  return {
    useHostCampaigns: () => campaigns,
    useOrgMemberOptions: () => team,
  }
})
jest.mock('../hooks/use-org-contact-segments', () => {
  const segments = [{ $id: 'seg-1', name: 'Returning' }]
  return { useOrgContactSegments: () => segments }
})
jest.mock('../hooks/use-org-crm-views', () => {
  const views: unknown[] = []
  return { useOrgCrmViews: () => views }
})
jest.mock('../hooks/use-org-lists', () => {
  const lists = [{ $id: 'list-1', name: 'Customers' }]
  return { useOrgLists: () => lists }
})
jest.mock('../hooks/use-org-contact-fields', () => {
  const definitions = {
    fields: [{ $id: 'f1', key: 'plan', label: 'Plan', type: 'text', order: 0 }],
    ready: true,
  }
  return { useOrgContactFields: () => definitions }
})
jest.mock('../hooks/use-org-company-options', () => {
  const companies = { hits: [], names: { co_acme: 'Acme' }, searching: false }
  return { useOrgCompanyOptions: () => companies }
})

/**
 * What one keystroke costs on the audience rule form (AGL-3423).
 *
 * Every control writes one draft, held by the page, so each keystroke renders
 * the form again — and drawn inline, that redrew every control on it: 27
 * inputs and some thousand components for one letter. A keystroke that costs
 * that much lets typed input queue, which is what turns a chip field's
 * per-commit update into React #185 (the companies chips sit on this form).
 * It now draws the field typed into. Counted off React's own commits, so the
 * budget is what actually rendered.
 */
describe('one keystroke on the audience rule form (AGL-3423)', () => {
  let counter: FiberRenderCounter
  let react: typeof import('react')
  let unmount: () => Promise<void>

  // Each test loads React and MUI afresh, in a registry of its own: the
  // setup is given the time a cold load takes.
  beforeEach(async () => {
    counter = installFiberRenderCounter()
    jest.resetModules()
    react = jest.requireActual<typeof import('react')>('react')
    const client = jest.requireActual<typeof import('react-dom/client')>('react-dom/client')
    const rules = jest.requireActual<typeof import('./dynamic-list-rule-fields')>(
      './dynamic-list-rule-fields',
    )
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
    const scope = ['orgs', 'org-1'] as const
    const initial: import('./dynamic-list-rule-fields').DynamicListRuleDraft = {
      ...rules.EMPTY_RULE_DRAFT,
      campaignIds: ['spring'],
      companyIds: ['co_acme'],
      custom: [{ key: 'plan', op: 'eq', value: 'pro' }],
    }
    // The form as its page holds it: the draft in state, the setter as the
    // handler.
    function Page() {
      const [draft, setDraft] = react.useState(initial)
      return react.createElement(rules.default, {
        scope,
        hostId: 'host-1',
        draft,
        onChange: setDraft,
      })
    }
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = client.createRoot(host)
    await react.act(async () => {
      root.render(react.createElement(Page))
    })
    unmount = async () => {
      await react.act(async () => root.unmount())
      host.remove()
    }
  })

  afterEach(async () => {
    await unmount()
    counter.uninstall()
    jest.restoreAllMocks()
  })

  async function type(label: string, text: string) {
    const box = within(document.body).getByRole(
      label === 'Orders at least' ? 'spinbutton' : 'textbox',
      { name: label },
    ) as HTMLInputElement
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    counter.reset()
    await react.act(async () => {
      setValue?.call(box, text)
      box.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(box.value).toBe(text)
  }

  /** Nothing but the field typed in: no chips, no picker, no other row. */
  const expectOnlyTheFieldTypedIn = () => {
    expect(counter.rendered('Autocomplete')).toBe(0)
    expect(counter.rendered('RuleCompaniesField')).toBe(0)
    expect(counter.rendered('CampaignPicker')).toBe(0)
  }

  it('draws only the tags typed into, and never the company chips', async () => {
    expect(within(document.body).getByText('Acme')).toBeTruthy()
    await type('Tagged', 'v')
    expectOnlyTheFieldTypedIn()
    expect(counter.rendered('CustomClauseRow')).toBe(0)
    // The tags, drawn again as MUI marks them filled.
    expect(counter.rendered('InputBase')).toBeLessThanOrEqual(2)
    await type('Tagged', 'vi')
    expect(counter.rendered('InputBase')).toBeLessThanOrEqual(1)
  })

  it('draws only the number typed into', async () => {
    await type('Orders at least', '3')
    expectOnlyTheFieldTypedIn()
    expect(counter.rendered('CustomClauseRow')).toBe(0)
    expect(counter.rendered('InputBase')).toBeLessThanOrEqual(2)
  })

  it('draws only the condition value typed into, not its field or operator', async () => {
    await type('Value', 'prox')
    expectOnlyTheFieldTypedIn()
    expect(counter.rendered('CustomClauseRow')).toBe(1)
    expect(counter.rendered('InputBase')).toBeLessThanOrEqual(1)
  })
})
