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
 *
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { LIST_CONSENT_STEP_ID, LIST_EXISTING_STEP_ID, LIST_MEMBERS_RESOURCE } from './email-transfer-catalog'

/**
 * The native list import steps (AGL-3671) ask what the console's two steps ask and answer under the same keys. They are spec
 * screens in the import wizard's `transferStep` zone; the flow is replayed by both renderers (ScreenImportStepsTests,
 * ScreenImportStepsTest). This holds their resource, keys, route and sentences to the console's steps and server readers.
 */
interface Screen {
  id: string
  requires?: string
  zones?: string[]
  load?: { screening?: { url: string; body: Record<string, string> } }
  blocks: Array<{
    id?: string
    type: string
    text?: string
    tone?: string
    fields?: Array<{ key: string; label: string; help?: string }>
    items?: Array<{ id: string; label: string; confirm?: string }>
    footer?: string
    submit?: unknown
    title?: string
    filter?: string
  }>
}

const root = join(__dirname, '../../../../../..')
const read = (path: string) => readFileSync(join(root, path), 'utf8')
const screens = (JSON.parse(read('libs/plugins/email/src/ios/Sources/AglynEmailPlugin/Resources/email-import.screens.json')) as { screens: Screen[] }).screens
const screen = (id: string) => screens.find((one) => one.id === id) as Screen
const steps = read('libs/plugins/email/src/lib/transfer/list-import-steps.tsx')
const flat = (source: string) => source.replace(/\s+/g, ' ').replace(/[`'"] \+ [`'"]/g, '')

describe('native list import steps', () => {
  it('belong to the list members resource, in the zone the review draws', () => {
    const steps = screens.filter((one) => one.id !== 'email.list.transfer')
    for (const one of steps) {
      expect(one.zones).toEqual(['transferStep'])
      expect(one.requires).toBe(`stash.importResource ~= ${LIST_MEMBERS_RESOURCE}`)
    }
    expect(steps.map((one) => one.id)).toEqual(['email.import.existing', 'email.import.consent'])
  })

  it('answer under the keys the server reads', () => {
    expect(JSON.stringify(screen('email.import.existing').blocks)).toContain(`"key":"${LIST_EXISTING_STEP_ID}"`)
    expect(JSON.stringify(screen('email.import.existing').blocks)).toContain('"updateContacts":"{form.update}"')
    const consent = JSON.stringify(screen('email.import.consent').blocks)
    expect(consent).toContain(`"key":"${LIST_CONSENT_STEP_ID}"`)
    // The statement is a literal yes or a literal no: the server treats anything but a boolean as no statement at all.
    expect(consent).toContain('"attest":true')
    expect(consent).toContain('"attest":false')
  })

  it('reads what the file holds from the route the console reads, for this list and job', () => {
    const load = screen('email.import.consent').load?.screening
    expect(load?.url).toBe('/api/email/list-import-screening')
    expect(Object.keys(load?.body ?? {}).sort()).toEqual(['hostId', 'jobId', 'listId'])
    expect(load?.body['listId']).toBe('{params.resource:instance}')
    expect(steps).toContain("'/api/email/list-import-screening'")
    expect(steps).toContain('body: JSON.stringify({ hostId, listId, jobId })')
  })

  it('say what the console says', () => {
    const statement =
      'I have these people’s permission to send them marketing email, and I can produce the record of it if asked. ' +
      'This statement is stored against my account, with today’s date, on every address it admits.'
    expect(flat(steps).includes(statement)).toBe(true)
    const attest = screen('email.import.consent').blocks.flatMap((block) => block.items ?? []).find((item) => item.id === 'attest')
    expect(attest?.confirm).toBe(statement)
    for (const sentence of [
      'Only add the people who already have an opt-in on record. Nobody else is added, and nothing is deleted.',
      'Whichever you choose, people who unsubscribed, bounced, marked a message as spam or said no are never added, and an import never sends a confirmation email.',
      'Nobody new is added by this file.',
      'Purchased, rented and appended lists are not allowed',
      'They are a common sign of a list built by collecting addresses rather than by people signing up.',
    ]) {
      expect(flat(steps).includes(sentence)).toBe(true)
    }
    const consent = JSON.stringify(screen('email.import.consent'))
    for (const sentence of [
      'Whichever you choose, people who unsubscribed, bounced, marked a message as spam or said no are never added, and an import never sends a confirmation email.',
      'Nobody new is added by this file.',
      'Purchased, rented and appended lists are not allowed',
      'They are a common sign of a list built by collecting addresses rather than by people signing up.',
    ]) {
      expect(consent).toContain(sentence)
    }
    const existing = JSON.stringify(screen('email.import.existing'))
    for (const sentence of [
      'Somebody already on this list stays on it exactly as they are: the import never re-adds them or rewrites their membership.',
      'A blank cell never empties one.',
    ]) {
      expect(flat(steps).includes(sentence)).toBe(true)
      expect(existing).toContain(sentence)
    }
  })

  it('opens the records wizard and export on one list, and resumes its unfinished imports, as the list page does', () => {
    const transfer = screen('email.list.transfer') as Screen & { scope?: string }
    const card = read('libs/plugins/email/src/lib/components/list-detail-card.tsx')
    const resume = read('libs/aglyn/src/lib/app-utils/transfer-resume-import.tsx')
    const items = transfer.blocks.find((block) => block.type === 'actions')?.items as unknown as Array<{
      id: string
      label: string
      navigate?: { screen: string; params: Record<string, string> }
      export?: Record<string, string>
    }>
    // The wizard and the dialog are opened on `email.list-members:<listId>`, worked as the site, titled by the list's name.
    expect(items.map((item) => [item.id, item.label])).toEqual([
      ['import', 'Import'],
      ['export', 'Export'],
    ])
    expect(items[0]?.navigate?.params['title']).toBe('Import into {params.name}')
    expect(items[1]?.export?.['title']).toBe('Export {params.name}')
    expect(flat(card).includes('`Import into ${listName}`')).toBe(true)
    expect(flat(card).includes('`Export ${listName}`')).toBe(true)
    expect(flat(card).includes("{'Import'}")).toBe(true)
    expect(flat(card).includes("{'Export'}")).toBe(true)
    // Resume: the unfinished imports of this resource, each reopened where it stopped, or thrown away.
    const list = transfer.blocks.find((block) => block.title === 'Resume import')
    expect(list?.filter).toBe('item.resource == @params.resource')
    expect(flat(resume).includes("'Resume import'")).toBe(true)
    expect(flat(resume).includes("{'Discard'}")).toBe(true)
    expect(transfer.load).toBeDefined()
  })
})
