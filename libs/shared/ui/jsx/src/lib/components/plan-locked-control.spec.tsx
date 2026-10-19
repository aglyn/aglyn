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
 * The two shared pieces a plan-gated control is drawn with (AGL-3977): the
 * notice that sells the feature and links the plan grid, and the control that
 * stays on screen, disabled, with the plan named beside it.
 */

import { Button } from '@mui/material'
import { fireEvent, render, screen } from '@testing-library/react'
import { PlanLockedControl } from './plan-locked-control.component'
import { PlanUpsellNotice } from './plan-upsell-notice.component'

jest.mock('next/navigation', () => ({
  usePathname: () => '/acme/hosts/site',
}))

describe('PlanUpsellNotice', () => {
  it('says what the feature does, which plan includes it, and links the plan grid', () => {
    render(
      <PlanUpsellNotice planLabel="Business" upgradeHref="/acme/billing#plans">
        {'Schedule a version to go live at a set time.'}
      </PlanUpsellNotice>,
    )
    expect(screen.getByRole('alert').textContent).toContain(
      'Schedule a version to go live at a set time. Included from Business.',
    )
    expect(screen.getByRole('button', { name: 'Upgrade' }).getAttribute('href')).toBe(
      '/acme/billing#plans',
    )
  })

  it('names no plan when none includes it', () => {
    render(
      <PlanUpsellNotice planLabel={undefined} upgradeHref="/acme/billing#addons">
        {'A paid add-on.'}
      </PlanUpsellNotice>,
    )
    expect(screen.getByRole('alert').textContent).not.toContain('Included from')
  })
})

describe('PlanLockedControl', () => {
  it('locked: the control stays, disabled with the reason, and the plan links beside it', () => {
    const onClick = jest.fn()
    render(
      <PlanLockedControl
        locked
        reason="Writing with AI is included from Starter."
        planLabel="Starter"
        upgradeHref="/acme/billing#plans"
      >
        <Button onClick={onClick}>{'Write with AI'}</Button>
      </PlanLockedControl>,
    )
    const button = screen.getByRole('button', { name: 'Write with AI' }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    fireEvent.click(button)
    expect(onClick).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Writing with AI is included from Starter.')).toBeTruthy()
    expect(screen.getByText('Included from Starter').getAttribute('href')).toBe(
      '/acme/billing#plans',
    )
  })

  it('open: the control passes through untouched, with no link', () => {
    const onClick = jest.fn()
    render(
      <PlanLockedControl
        locked={false}
        reason="Writing with AI is included from Starter."
        planLabel="Starter"
        upgradeHref="/acme/billing#plans"
      >
        <Button onClick={onClick}>{'Write with AI'}</Button>
      </PlanLockedControl>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Write with AI' }))
    expect(onClick).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('Included from Starter')).toBeNull()
  })
})
