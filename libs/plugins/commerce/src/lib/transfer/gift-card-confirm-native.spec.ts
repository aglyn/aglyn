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

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { typedDollarsToCents } from './records-transfer'
import { GIFT_CARD_CONFIRM_STEP_ID, COMMERCE_GIFT_CARDS_TRANSFER } from './transfer-keys'

/**
 * The native gift card Confirm step (AGL-3671) asks what the console's step asks and answers under the same key. The step is a
 * spec screen in the import wizard's `transferStep` zone; the flow is replayed by both renderers (ScreenImportStepsTests,
 * ScreenImportStepsTest). This holds its resource, key, route and sentences to the console's component and server reader.
 */
interface Screen {
  id: string
  requires?: string
  zones?: string[]
  load?: { cards?: { url: string; body: Record<string, unknown> } }
  blocks: Array<{
    id?: string
    type: string
    text?: string
    fields?: Array<{ key: string; label: string; help?: string; mustMatch?: string; mustMatchAs?: string; mismatch?: string }>
    submit?: { url: string; body: unknown; success?: string }
  }>
}

const root = join(__dirname, '../../../../../..')
const read = (path: string) => readFileSync(join(root, path), 'utf8')
const screen = (JSON.parse(read('libs/plugins/commerce/src/ios/Sources/AglynCommercePlugin/Resources/commerce-import.screens.json')) as { screens: Screen[] }).screens[0] as Screen
const component = read('libs/plugins/commerce/src/lib/transfer/gift-card-confirm-step.component.tsx')
const flat = (source: string) => source.replace(/\s+/g, ' ').replace(/[`'"] \+ [`'"]/g, '')

describe('native gift card import step', () => {
  it('belongs to the gift card resource and answers under the key the server reads', () => {
    expect(screen.requires).toBe(`stash.importResource == ${COMMERCE_GIFT_CARDS_TRANSFER}`)
    expect(screen.zones).toEqual(['transferStep'])
    const submit = JSON.stringify(screen.blocks.find((block) => block.id === 'confirm')?.submit)
    expect(submit).toContain(`"key":"${GIFT_CARD_CONFIRM_STEP_ID}"`)
    // The answer: what was typed, the total in cents, and whether recipients are emailed.
    for (const key of ['typed', 'totalCents', 'email']) expect(submit).toContain(`"${key}"`)
    expect(component).toContain('totalCents')
    expect(component).toContain('email: merged.email')
  })

  it('reads the cards the way the console does, a page at a time from the stored plan', () => {
    expect(screen.load?.cards?.url).toBe('/api/transfer/plan')
    expect(screen.load?.cards?.body).toMatchObject({ action: 'rows', limit: 200, verdicts: ['create'] })
    expect(component).toContain("action: 'rows'")
    expect(component).toContain('const ROWS_PAGE = 200')
    expect(component).toContain("verdicts: ['create']")
  })

  it('says what the console says', () => {
    const texts = screen.blocks.map((block) => block.text).filter(Boolean) as string[]
    const sentence = 'Each card is spendable money the moment it is issued. Check every code and value, then type the total to issue them.'
    expect(flat(component).includes(sentence)).toBe(true)
    expect(texts.every((text) => text.includes(sentence) || !text.includes('gift card'))).toBe(true)
    expect(texts.some((text) => text.includes(sentence))).toBe(true)
    const fields = screen.blocks.find((block) => block.id === 'confirm')?.fields ?? []
    expect(fields.map((field) => field.label)).toEqual([
      'Type the total value to issue these cards',
      'Email each recipient their code as the card is issued',
    ])
    for (const label of ['Type the total value to issue these cards', 'Email each recipient their code as the card is issued']) {
      expect(flat(component).includes(label.replace('Email each recipient their code as the card is issued', 'Email each recipient their code as the card is issued.'))).toBe(true)
    }
    expect(flat(component).includes('Leave this off when the shoppers already hold these codes.')).toBe(true)
    expect(fields[1]?.help).toBe('Leave this off when the shoppers already hold these codes.')
    expect(flat(component).includes('No card in this file can be issued. The review lists every row with the reason.')).toBe(true)
  })

  it('reads the typed total as dollars, as the console does, and says what it says when it is not the total', () => {
    const typed = (screen.blocks.find((block) => block.id === 'confirm')?.fields ?? [])[0]
    expect(typed?.mustMatchAs).toBe('dollars')
    expect(typed?.help).toBe('Type {data.cards.rows.rows.0.giftCard.totalCents:cents}.')
    expect(typed?.mismatch).toBe('That is not the total. These cards add up to {data.cards.rows.rows.0.giftCard.totalCents:cents}.')
    expect(flat(component).includes('That is not the total. These cards add up to ${giftCardMoney(totalCents)}.')).toBe(true)
    expect(flat(component).includes('`Type ${giftCardMoney(totalCents)}.`')).toBe(true)
    // Both renderers replay these cases against their own port (template-cases.json).
    const cases = (JSON.parse(read('libs/native/screens/template-cases.json')) as { dollars: Array<{ typed: string; cents: number | null }> }).dollars
    expect(cases.length).toBeGreaterThan(5)
    for (const entry of cases) expect([entry.typed, typedDollarsToCents(entry.typed)]).toEqual([entry.typed, entry.cents])
  })
})
