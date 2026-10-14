/**
 * @license
 * Copyright 2022 Aglyn LLC
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

import React from 'react'
import {render} from '@testing-library/react'
import {Button, Chip, IconButton} from '@mui/material'
import CardDisplay from './card-display'

/**
 * A header action stays top right when it is a lone icon button or status
 * chip, and only a wider action wraps under the title (AGL-3311). jsdom
 * performs no layout, so these pin the rules the card EMITS and the elements
 * their selectors pick out.
 */
describe('CardDisplay · header action', () => {
  const COMPACT_ACTION =
    ':has(> .MuiCardHeader-action > :is(.MuiIconButton-root, .MuiChip-root):only-child)'

  /** Every emitted rule that names the element's generated class. */
  const rulesNaming = (element: Element) => {
    const generated = element.className
      .split(' ')
      .find((name) => name.startsWith('css-') || name.startsWith('mui-'))
    // Guard the guard: with no generated class the search runs over nothing.
    expect(generated).toBeTruthy()
    return Array.from(document.styleSheets)
      .flatMap((sheet) => {
        try {
          return Array.from(sheet.cssRules).map((rule) => rule.cssText)
        } catch {
          return []
        }
      })
      .filter((rule) => rule.includes(generated as string))
  }

  const draw = (action: React.ReactNode, props: Record<string, unknown> = {}) => {
    const {container} = render(
      <CardDisplay header="Aglyn LLC" subheader="aglyn-org" HeaderProps={{action}} {...props} />,
    )
    const card = container.firstElementChild as HTMLElement
    const header = card.querySelector('.MuiCardHeader-root') as HTMLElement
    return {card, header}
  }

  it('keeps a lone icon button beside the title, never wrapped under it', () => {
    const {card, header} = draw(<IconButton aria-label="Pin Aglyn LLC">P</IconButton>)
    expect(header.matches(COMPACT_ACTION)).toBe(true)
    const rules = rulesNaming(card).filter((rule) => rule.includes(COMPACT_ACTION))
    expect(rules.some((rule) => rule.includes('flex-wrap: nowrap'))).toBe(true)
    // The title gives way beside the button rather than holding its floor.
    expect(
      rules.some(
        (rule) =>
          rule.includes('.MuiCardHeader-content') &&
          rule.includes('flex-basis: 0'),
      ),
    ).toBe(true)
  })

  it('keeps a lone status chip ("Live") beside the title too', () => {
    const {header} = draw(<Chip size="small" label="Live" />)
    expect(header.matches(COMPACT_ACTION)).toBe(true)
  })

  it('lets a long title shorten instead of pushing the avatar onto its own row', () => {
    const {card} = draw(<Chip size="small" label="Live" />)
    expect(
      rulesNaming(card).some(
        (rule) =>
          rule.includes('.MuiCardHeader-content') &&
          !rule.includes(':has(') &&
          rule.includes('min-width: 0'),
      ),
    ).toBe(true)
  })

  it('keeps the help beside a long title, the title being what gives way', () => {
    const {container} = render(
      <CardDisplay
        header="Panadería Sol de Oaxaca Panadería Sol de Oaxaca"
        help={{excerpt: 'A site card', href: '/docs/getting-started/console-tour'}}
      />,
    )
    const title = container.querySelector('.MuiCardHeader-title') as HTMLElement
    const wrapper = title.firstElementChild as HTMLElement
    const [name, help] = Array.from(wrapper.children) as HTMLElement[]
    expect(name.textContent).toBe('Panadería Sol de Oaxaca Panadería Sol de Oaxaca')
    expect(getComputedStyle(wrapper).maxWidth).toBe('100%')
    expect(getComputedStyle(name).minWidth).toBe('0')
    expect(getComputedStyle(name).textOverflow).toBe('ellipsis')
    expect(help).toBeTruthy()
  })

  it('makes a fullHeight card fill its cell with the actions along the bottom', () => {
    const {card} = draw(<Chip size="small" label="Live" />, {
      fullHeight: true,
      children: 'Domains',
      actions: <Button>Visit</Button>,
    })
    const style = getComputedStyle(card)
    expect(style.height).toBe('100%')
    expect(style.display).toBe('flex')
    expect(style.flexDirection).toBe('column')
    expect(
      rulesNaming(card).some(
        (rule) => rule.includes('.MuiCardContent-root') && rule.includes('flex-grow: 1'),
      ),
    ).toBe(true)
  })

  it('leaves a card without fullHeight at its natural height', () => {
    const {card} = draw(<Chip size="small" label="Live" />)
    expect(getComputedStyle(card).height).not.toBe('100%')
  })

  it('still lets a wider action wrap under the title', () => {
    const {card, header} = draw(<Button>Create lead</Button>)
    expect(header.matches(COMPACT_ACTION)).toBe(false)
    expect(
      rulesNaming(card).some(
        (rule) => rule.includes('.MuiCardHeader-root') && rule.includes('flex-wrap: wrap'),
      ),
    ).toBe(true)
  })
})
