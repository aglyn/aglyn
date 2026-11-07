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
 * A sharing rule's "Shared with" (AGL-4047): all sites, the sites, or all
 * sites except the ones left out, as radios and a visible list, sent to
 * `rule-save` as the choice.
 */

import { fireEvent, render, screen } from '@testing-library/react'
import type { CrmSharingRule } from '../model/crm-sharing'
import { ruleSharingChoice, SharingRuleDrawer } from './sharing-rule-drawer'

const SITES = [
  { id: 'site-a', name: 'Brand A' },
  { id: 'site-b', name: 'Brand B' },
  { id: 'site-c', name: 'Brand C' },
]

function rule(overrides: Partial<CrmSharingRule> = {}): CrmSharingRule {
  return {
    id: 'r1',
    name: 'Not Brand C',
    object: 'leads',
    enabled: true,
    sourceHostIds: [],
    criteria: {},
    targets: ['host:site-a', 'host:site-b'],
    except: ['host:site-c'],
    access: 'read',
    createdAtMs: 1,
    updatedAtMs: 1,
    ...overrides,
  }
}

const drawer = (props: Partial<Parameters<typeof SharingRuleDrawer>[0]> = {}) => (
  <SharingRuleDrawer
    open
    onClose={() => undefined}
    rule={null}
    sites={SITES}
    sitesReady
    members={[]}
    campaigns={[]}
    busy={false}
    onSubmit={() => undefined}
    {...props}
  />
)

describe('a sharing rule shared with all sites except some (AGL-4047)', () => {
  it('reads a stored rule back as the choice it was saved with', () => {
    expect(ruleSharingChoice(rule())).toEqual({ mode: 'allExcept', exceptHostIds: ['site-c'] })
    expect(ruleSharingChoice(rule({ except: undefined, targets: ['org'] }))).toEqual({ mode: 'all' })
    expect(ruleSharingChoice(rule({ except: undefined, targets: ['host:site-b'] }))).toEqual({
      mode: 'selected',
      hostIds: ['site-b'],
    })
    expect(ruleSharingChoice(null)).toEqual({ mode: 'all' })
  })

  it('sends the sites left out', () => {
    const onSubmit = jest.fn()
    render(drawer({ onSubmit }))
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: 'Not Brand C' } })
    fireEvent.click(screen.getByRole('radio', { name: /^All sites except/ }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Brand C' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add rule' }))
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ targets: { mode: 'allExcept', exceptHostIds: ['site-c'] } }),
    )
  })

  it('opens a stored rule on its choice, the site left out ticked', () => {
    render(drawer({ rule: rule() }))
    expect(screen.getByRole<HTMLInputElement>('radio', { name: /^All sites except/ }).checked).toBe(true)
    expect(screen.getByRole<HTMLInputElement>('checkbox', { name: 'Brand C' }).checked).toBe(true)
  })

  it('won’t save a choice that leaves nothing out', () => {
    render(drawer())
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: 'x' } })
    fireEvent.click(screen.getByRole('radio', { name: /^All sites except/ }))
    expect(screen.getByText('Choose at least one site to leave out, or share with All sites.')).toBeTruthy()
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Add rule' }).disabled).toBe(true)
  })

  it('switches the choice off, with the reason, in a workspace with one site', () => {
    render(drawer({ sites: [SITES[0]] }))
    expect(screen.getByRole<HTMLInputElement>('radio', { name: /^All sites except/ }).disabled).toBe(true)
    expect(screen.getByText('This workspace has one site, so there is nothing to leave out.')).toBeTruthy()
  })
})
