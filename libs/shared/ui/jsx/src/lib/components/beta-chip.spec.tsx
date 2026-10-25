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

import { render, screen } from '@testing-library/react'
import {
  BETA_CHIP_DESCRIPTION,
  BETA_CHIP_LABEL,
  BetaChip,
} from './beta-chip.component'
import { StatusChip } from './status-chip.component'

/** The Beta label a released, still-changing feature wears (AGL-4052). */
describe('BetaChip', () => {
  it('reads Beta, inline, and is described rather than renamed', () => {
    render(
      <h1>
        Automation
        <BetaChip data-testid="beta" />
      </h1>,
    )
    const chip = screen.getByTestId('beta')
    expect(chip.tagName).toBe('SPAN')
    expect(chip.textContent).toBe(BETA_CHIP_LABEL)
    expect(chip.getAttribute('data-release-stage')).toBe('beta')
    // The heading keeps "Beta" in its name; the sentence is a description.
    expect(chip.getAttribute('aria-label')).toBeNull()
    expect(screen.getByRole('heading').textContent).toBe('AutomationBeta')
    expect(chip.querySelector('.MuiChip-root')?.tagName).toBe('SPAN')
    expect(chip.querySelector('.MuiChip-root')?.className).toMatch(
      /colorInfo/,
    )
    expect(BETA_CHIP_DESCRIPTION).toMatch(/still changing/)
  })
})

describe('StatusChip component', () => {
  it('renders a span root where it is asked to', () => {
    render(<StatusChip label="On" component="span" data-testid="chip" />)
    expect(screen.getByTestId('chip').tagName).toBe('SPAN')
  })

  it('keeps the div root by default', () => {
    render(<StatusChip label="On" data-testid="chip" />)
    expect(screen.getByTestId('chip').tagName).toBe('DIV')
  })
})
