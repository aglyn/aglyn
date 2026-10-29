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

import React, { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { ThemeProvider, alpha, createTheme, decomposeColor, getContrastRatio, type Theme } from '@mui/material/styles'
import { OptionCardGrid, optionCardLabel, optionCardSx, type OptionCard } from './option-card-grid.component'

/**
 * The option card grid (AGL-3985): every card a surface with an outline that
 * reads on a gray dialog, its words at AA on that surface in light and dark
 * mode, and the picked card unmistakable — a 2px primary outline and a check.
 */

const OPTIONS: OptionCard[] = [
  { id: 'auto', title: 'Pick for me', description: 'From your answer: Portfolio', icon: 'M0 0h24v24H0z' },
  { id: 'portfolio', title: 'Portfolio', description: 'Minimal, image-led pages', image: { src: '/portfolio.webp', alt: 'A portfolio', width: 800, height: 800 } },
  { id: 'blog', title: 'Blog & writing', description: 'Reading-first pages', image: { src: '/blog.webp', alt: 'A blog', width: 800, height: 800 } },
]

function Grid({ initial = 'portfolio', theme = createTheme() }: { initial?: string; theme?: Theme }) {
  const [value, setValue] = useState<string>(initial)
  return (
    <ThemeProvider theme={theme}>
      <OptionCardGrid label="Style of site" options={OPTIONS} value={value} onChange={setValue} />
    </ThemeProvider>
  )
}

const cardOf = (radio: HTMLElement) => radio.closest('.MuiCard-root') as HTMLElement
const checks = (container: HTMLElement) => container.querySelectorAll('[data-option-card-check]')

describe('OptionCardGrid', () => {
  it('marks the picked card checked, with one check in its corner', () => {
    const { container } = render(<Grid />)
    const picked = screen.getByRole('radio', { name: 'Portfolio: Minimal, image-led pages' })
    expect(picked.getAttribute('aria-checked')).toBe('true')
    expect(checks(container)).toHaveLength(1)
    expect(cardOf(picked).contains(checks(container)[0])).toBe(true)
  })

  it('moves the check to the card clicked, an icon card as well as a picture card', () => {
    const { container } = render(<Grid />)
    const auto = screen.getByRole('radio', { name: 'Pick for me: From your answer: Portfolio' })
    fireEvent.click(auto)
    expect(auto.getAttribute('aria-checked')).toBe('true')
    expect(checks(container)).toHaveLength(1)
    expect(cardOf(auto).contains(checks(container)[0])).toBe(true)
  })

  it('keeps only the picked card in the tab order, and the arrow keys pick the next', () => {
    render(<Grid />)
    const picked = screen.getByRole('radio', { name: /^Portfolio/ })
    const next = screen.getByRole('radio', { name: /^Blog/ })
    expect(picked.tabIndex).toBe(0)
    expect(next.tabIndex).toBe(-1)
    fireEvent.keyDown(picked, { key: 'ArrowRight' })
    expect(next.getAttribute('aria-checked')).toBe('true')
    expect(document.activeElement).toBe(next)
  })

  it('draws each card on the paper surface with an outline as strong as a field’s, never transparent', () => {
    render(<Grid />)
    const theme = createTheme()
    const other = getComputedStyle(cardOf(screen.getByRole('radio', { name: /^Blog/ })))
    expect(other.backgroundColor).not.toBe('transparent')
    const paper = getComputedStyle(cardOf(screen.getByRole('radio', { name: /^Pick for me/ }))).backgroundColor
    expect(paper).toBe(other.backgroundColor)
    const sx = optionCardSx(false)(theme)
    expect(sx.bgcolor).toBe('background.paper')
    expect(sx.borderColor).toBe(alpha(theme.palette.text.primary, 0.23))
  })

  it('outlines the picked card 2px in the primary color: its border and a ring outside it', () => {
    const theme = createTheme()
    const sx = optionCardSx(true)(theme)
    expect(sx.borderColor).toBe(theme.palette.primary.main)
    expect(sx.boxShadow).toBe(`0 0 0 1px ${theme.palette.primary.main}`)
    expect(optionCardSx(false)(theme).boxShadow).toBe('none')
  })

  it('rings a card with the keyboard’s focus in the primary color', () => {
    const theme = createTheme()
    expect(optionCardSx(false)(theme)['&:has(.Mui-focusVisible)']).toEqual({ outline: `2px solid ${theme.palette.primary.main}`, outlineOffset: '2px' })
  })

  it('draws a card’s facts as chips under its line, and reads them in its name (AGL-4049)', () => {
    const options: OptionCard[] = [
      {
        id: 'bistro',
        title: 'Corner bistro',
        description: 'By Aglyn',
        icon: 'M0 0h24v24H0z',
        chips: [{ label: '$12', color: 'primary', variant: 'filled' }, { label: '4 pages' }],
      },
      { id: 'plain', title: 'Plain', description: 'No facts' },
    ]
    const { container } = render(
      <OptionCardGrid label="Starters" options={options} value={null} onChange={() => undefined} />,
    )
    const card = screen.getByRole('radio', { name: 'Corner bistro: By Aglyn ($12, 4 pages)' })
    const chips = card.querySelectorAll('[data-option-card-chips] .MuiChip-root')
    expect([...chips].map((chip) => chip.textContent)).toEqual(['$12', '4 pages'])
    expect(chips[0].className).toContain('MuiChip-filled')
    expect(chips[0].className).toContain('MuiChip-colorPrimary')
    expect(chips[1].className).toContain('MuiChip-outlined')
    expect(chips[1].className).toContain('MuiChip-colorDefault')
    // A card with none draws no chip row, and its name is as it always was.
    expect(screen.getByRole('radio', { name: 'Plain: No facts' }).querySelector('[data-option-card-chips]')).toBeNull()
    expect(container.querySelectorAll('[data-option-card-chips]')).toHaveLength(1)
    expect(optionCardLabel({ title: 'Only a title' })).toBe('Only a title')
  })

  it.each(['light', 'dark'] as const)('keeps the title and the line at AA on the card in %s mode', (mode) => {
    const theme = createTheme({ palette: { mode } })
    const paper = theme.palette.background.paper
    // A translucent text color as it shows over the paper it sits on.
    const over = (color: string) => {
      const text = decomposeColor(color).values
      const base = decomposeColor(paper).values
      const a = text[3] ?? 1
      const mix = [0, 1, 2].map((index) => Math.round(text[index] * a + base[index] * (1 - a)))
      return `rgb(${mix.join(', ')})`
    }
    expect(getContrastRatio(over(theme.palette.text.primary), paper)).toBeGreaterThanOrEqual(4.5)
    expect(getContrastRatio(over(theme.palette.text.secondary), paper)).toBeGreaterThanOrEqual(4.5)
  })
})
