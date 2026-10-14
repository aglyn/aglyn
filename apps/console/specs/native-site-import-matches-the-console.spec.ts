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
import {
  INITIAL_PACKAGE_BULK_DEFAULTS,
  PACKAGE_BULK_CHOICES,
  PACKAGE_DECISION_WORDS,
  PACKAGE_STATUS_WORDS,
  SITE_PACKAGE_COMPARE_MAX,
  packageAcknowledgements,
  packageDecisions,
  packageDependencyOptions,
} from '@aglyn/aglyn-transfer-ui'

/**
 * The native site package import walks the console's wizard (`PackageImportWizard`) and speaks its words: the
 * status and decision labels, the defaults for each kind of change, the answers to a missing item and the
 * things to acknowledge before it writes. The decisions themselves are replayed against the console's own
 * `packageDecisions` (`site-import-cases.json`, by both renderers).
 */
interface Block {
  type: string
  id?: string
  title?: string
  items?: unknown
  actions?: Array<{ id: string; label: string; prompt?: Array<{ key: string; options?: Array<{ value: string; label: string }> }> }>
  submit?: { stash?: { bulk?: Record<string, string> } }
}
interface Screen {
  id: string
  constants?: Record<string, unknown>
  blocks: Block[]
}

const text = readFileSync(join(__dirname, '../../../libs/native/screens/site-import.screens.json'), 'utf8')
const screens = (JSON.parse(text) as { screens: Screen[] }).screens
const screen = (id: string) => screens.find((one) => one.id === id) as Screen
const constants = (id: string) => (screen(id).constants ?? {}) as Record<string, unknown>
const actions = (id: string) =>
  screen(id).blocks.flatMap((block) => [...(block.actions ?? []), ...(Array.isArray(block.items) ? (block.items as Block['actions']) ?? [] : [])])

describe('native site package import', () => {
  it('says what the console says about an item and what may be done with it', () => {
    const review = constants('core.site.import.review') as { status: Record<string, string>; decision: Record<string, string> }
    expect(review.status).toEqual(
      Object.fromEntries(Object.entries(PACKAGE_STATUS_WORDS).map(([status, words]) => [status, words.label])),
    )
    expect(review.decision).toEqual(
      Object.fromEntries(Object.entries(PACKAGE_DECISION_WORDS).map(([decision, words]) => [decision, words.label])),
    )
    const choose = screen('core.site.import.review')
      .blocks.flatMap((block) => block.actions ?? [])
      .find((action) => action.id === 'choose')
    const help = (choose?.prompt?.[0] as { help?: string } | undefined)?.help ?? ''
    for (const words of Object.values(PACKAGE_DECISION_WORDS)) expect(help).toContain(`${words.label}: ${words.description}`)
  })

  it('offers the defaults the console offers, from the same start', () => {
    const upload = screen('core.site.import').blocks.find((block) => block.id === 'package')
    expect(upload?.submit?.stash?.bulk).toEqual(INITIAL_PACKAGE_BULK_DEFAULTS)
    const bulk = actions('core.site.import.review').find((action) => action.id === 'bulk')
    for (const [comparison, choices] of Object.entries(PACKAGE_BULK_CHOICES)) {
      const field = bulk?.prompt?.find((one) => one.key === comparison)
      expect(field?.options?.map((option) => option.value)).toEqual(['', ...choices])
      expect(field?.options?.slice(1).map((option) => option.label)).toEqual(
        choices.map((choice) => PACKAGE_DECISION_WORDS[choice].label),
      )
    }
  })

  it('answers a missing item with the console choices, in its words', () => {
    const answers = packageDependencyOptions({ key: 'layout/x', kind: 'layout', id: 'x', inPackage: {} as never, neededBy: [] })
    const label = (value: string) => answers.find((answer) => answer.value === value)?.label
    expect(constants('core.site.import.deps').answer).toEqual({
      import: label('import'),
      drop: label('drop'),
      keep: label('keep'),
    })
    const row = actions('core.site.import.deps')
    expect(row.map((action) => action.label)).toEqual(
      expect.arrayContaining([label('import'), label('mapTo'), label('drop'), label('keep')]),
    )
    // The file's own copy is offered only when the file carries it.
    expect(packageDependencyOptions({ key: 'layout/x', kind: 'layout', id: 'x', neededBy: [] }).map((answer) => answer.value)).toEqual([
      'mapTo',
      'drop',
      'keep',
    ])
  })

  it('asks for the acknowledgements the console asks for, in its words', () => {
    const warning = (code: string) => ({ code, item: 'page/a', dependency: 'layout/x', message: code })
    const asked = packageAcknowledgements(
      {
        warnings: ['droppedReference', 'mappedReference', 'danglingReference'].map(warning) as never,
        warningsTotal: 9,
        unknownKinds: [],
        notSent: [],
      },
      { 'page/a': 'replace' },
      (key) => key,
    )
    const native = constants('core.site.import.apply').ack as Array<{ id: string; title: string; description: string }>
    expect(native).toEqual(asked.map(({ id, title, description }) => ({ id, title, description })))
    // What is told, not asked, is shown as a notice beside the list.
    const told = packageAcknowledgements(
      { warnings: [], warningsTotal: 0, unknownKinds: ['x'], notSent: ['y'] },
      {},
      (key) => key,
    )
    expect(told.map((item) => item.required)).toEqual([false, false])
    expect(text).toContain('Items this site cannot read')
    expect(text).toContain('Emails this platform does not send')
  })

  it('decides every item as the console does', () => {
    const file = readFileSync(join(__dirname, '../../../libs/native/screens/site-import-cases.json'), 'utf8')
    const cases = (JSON.parse(file) as { decisions: Array<Record<string, any>> }).decisions
    expect(cases.length).toBeGreaterThan(5)
    for (const one of cases) {
      const answer = packageDecisions({ items: one.items } as never, one.overrides, one.bulk)
      expect({ name: one.name, ...answer, undecided: [...answer.undecided].sort() }).toEqual({
        name: one.name,
        decisions: one.expect.decisions,
        undecided: one.expect.undecided,
      })
    }
  })

  it('calls the routes the package client calls, one compared item at a time', () => {
    for (const action of ['plan', 'compare', 'apply']) expect(text).toContain(`"action": "${action}"`)
    expect(text).toContain('"url": "/api/hosts/import"')
    expect(text).toContain('"url": "/api/hosts/export"')
    expect(SITE_PACKAGE_COMPARE_MAX).toBeGreaterThanOrEqual(1)
    const compare = screen('core.site.import.item') as Screen & { load?: { cmp?: { body?: { keys?: string[] } } } }
    expect(compare.load?.cmp?.body?.keys).toHaveLength(1)
  })
})
