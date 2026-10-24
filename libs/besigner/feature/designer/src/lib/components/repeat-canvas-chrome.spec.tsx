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

import { createTheme } from '@mui/material/styles'
import { render } from '@testing-library/react'
import { itemTokensAsChips } from '../hooks/use-repeat-preview'
import { repeatBadgeText } from './node-leaf'
import { tokenPillStyle } from './token-pill.component'

const theme = createTheme({
  palette: { grey: { 700: '#123456' }, warning: { main: '#654321' } },
})

describe('the repeat badge says what is wrong and where to fix it (AGL-3111)', () => {
  it('names the source and the record count when it repeats', () => {
    expect(repeatBadgeText({ label: 'Team', count: 3 }).text).toBe(
      '⟳ Repeats Team · 3 records',
    )
  })

  it('says a missing dataset shows nothing, and that the badge leads to the fix', () => {
    const { text, explanation } = repeatBadgeText({
      label: 'Dataset',
      count: 0,
      missing: true,
    })
    expect(text).toBe('⟳ Dataset not available · not shown on your site')
    expect(explanation).toMatch(/deleted, or it isn’t shared with this site/)
    expect(explanation).toMatch(/Click this badge/)
    expect(explanation).toMatch(/Repeat over dataset/)
  })

  it('says when no record matches', () => {
    expect(repeatBadgeText({ label: 'Team', count: 0 }).text).toBe(
      '⟳ Repeats Team · no records match · not shown on your site',
    )
  })
})

describe('itemTokensAsChips', () => {
  it('draws each item token as a named chip in the theme’s pill colours', () => {
    const { container } = render(
      <p>{itemTokensAsChips('By {{item.author_name}} on {{ item.date }}', theme)}</p>,
    )
    const chips = container.querySelectorAll('[data-aglyn-token-chip]')
    expect([...chips].map((chip) => chip.textContent)).toEqual([
      'Author name',
      'Date',
    ])
    expect(chips[0].getAttribute('title')).toBe('{{item.author_name}}')
    expect(container.textContent).toBe('By Author name on Date')
    expect((chips[0] as HTMLElement).style.backgroundColor).toBe(
      'rgb(18, 52, 86)',
    )
  })

  it('leaves text with no item token exactly as it was', () => {
    expect(itemTokensAsChips('Plain {{host.name}}', theme)).toBe(
      'Plain {{host.name}}',
    )
  })
})

describe('tokenPillStyle', () => {
  it('reads every value off the theme, never a literal', () => {
    const style = tokenPillStyle(theme, 'unknown')
    expect(style.backgroundColor).toBe('#654321')
    expect(style.borderRadius).toBe(`${theme.shape.borderRadius}px`)
    expect(style.padding).toBe(theme.spacing(0, 0.75))
    expect(style.fontWeight).toBe(theme.typography.fontWeightMedium)
  })
})
