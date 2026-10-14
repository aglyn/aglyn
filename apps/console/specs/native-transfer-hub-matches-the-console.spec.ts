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
import { TRANSFER_API_ROUTES, transferResourceImports } from '@aglyn/aglyn/data-transfer'
import { FIRST_PARTY_PLUGINS } from '@aglyn/aglyn/plugin-manager/first-party-plugins.generated'
import { listDeclaredTransferResources } from '@aglyn/aglyn/plugin-manager/plugin-transfer-resources'
import {
  DECISION_WORDS,
  DEPENDENCY_WORDS,
  JOB_STATUS_WORDS,
  PACKAGE_WARNING_WORDS,
  REASON_WORDS,
  STATUS_WORDS,
  VERDICT_WORDS,
} from '../components/transfer-hub/hub-words'

/**
 * The native Imports and exports hub speaks the console's words and calls
 * its routes: the package review's choices, statuses, verdicts, reasons and
 * warnings are the sentences `hub-words.ts` holds, and the actions it sends
 * to `/api/transfer/package` are the ones the hub client sends.
 */
interface Screen {
  id: string
  constants?: Record<string, Record<string, unknown>>
}

const screens = (
  JSON.parse(readFileSync(join(__dirname, '../../../libs/native/screens/transfer.screens.json'), 'utf8')) as {
    screens: Screen[]
  }
).screens
const text = readFileSync(join(__dirname, '../../../libs/native/screens/transfer.screens.json'), 'utf8')
const constants = (id: string) => screens.find((screen) => screen.id === id)?.constants ?? {}

describe('native imports and exports hub', () => {
  it('shows the package review in the console words', () => {
    const review = constants('core.settings.data.packageReview')
    expect(review['decision']).toEqual(DECISION_WORDS)
    expect(review['status']).toEqual(STATUS_WORDS)
    expect(review['verdict']).toEqual(VERDICT_WORDS)
    expect(review['reason']).toEqual(REASON_WORDS)
    expect(review['dep']).toEqual(DEPENDENCY_WORDS)
    expect(review['warning']).toEqual(PACKAGE_WARNING_WORDS)
  })

  it('names each job status as the history does', () => {
    const labels = Object.fromEntries(Object.entries(JOB_STATUS_WORDS).map(([status, word]) => [status, word.label]))
    expect(constants('core.settings.data')['status']).toEqual(labels)
  })

  it('tones the history badges by the console colors', () => {
    const tones = Object.fromEntries(
      Object.values(JOB_STATUS_WORDS)
        .filter((word) => word.color !== 'default')
        .map((word) => [word.label, word.color === 'warning' || word.color === 'error' || word.color === 'success' ? word.color : 'info']),
    )
    const hub = screens.find((screen) => screen.id === 'core.settings.data') as unknown as {
      blocks: Array<{ title?: string; badges?: Array<{ tones: Record<string, string> }> }>
    }
    const history = hub.blocks.find((block) => block.title === 'History')
    expect(history?.badges?.[0]?.tones).toMatchObject(tones)
  })

  it('sends the package actions the hub client sends', () => {
    for (const action of ['list', 'export', 'plan', 'apply', 'undoPlan', 'undo']) {
      expect(text).toContain(`"action": "${action}"`)
    }
    for (const route of [TRANSFER_API_ROUTES.package, TRANSFER_API_ROUTES.jobs, TRANSFER_API_ROUTES.status]) {
      expect(text).toContain(`"${route}"`)
    }
  })

  it('discards an unfinished import and downloads a result file through the console routes', () => {
    expect(text).toContain('"action": "discard"')
    expect(text).toContain('"download": "results"')
    expect(text).toContain('"unfinished": true')
    expect(text).toContain('"sitePackages": true')
  })

  it('lists every resource the plugins declare, once, where the console lists it', () => {
    const generated = JSON.parse(
      readFileSync(join(__dirname, '../../../libs/native/screens/transfer-resources.screens.json'), 'utf8'),
    ) as { screens: Array<{ id: string; constants: Record<string, Array<{ key: string; imports: boolean; kind: string }>> }> }
    const listed = (id: string) =>
      Object.values(generated.screens.find((screen) => screen.id === id)?.constants ?? {}).flat()
    const org = listed('core.settings.data.records')
    const site = listed('core.site.data')
    const declared = listDeclaredTransferResources().filter((resource) => !resource.instances)
    expect(org.map((row) => row.key).sort()).toEqual(
      declared.filter((resource) => resource.scope === 'org').map((resource) => resource.key).sort(),
    )
    expect(site.map((row) => row.key).sort()).toEqual(
      declared.filter((resource) => resource.scope === 'host').map((resource) => resource.key).sort(),
    )
    for (const row of [...org, ...site]) {
      const resource = declared.find((one) => one.key === row.key)
      expect(row.imports).toBe(transferResourceImports(resource ?? {}))
      expect(row.kind).toBe(resource?.kinds.includes('package') ? 'package' : 'records')
    }
  })

  it('asks the switchboard about plugins the app knows', () => {
    const generated = readFileSync(join(__dirname, '../../../libs/native/screens/transfer-resources.screens.json'), 'utf8')
    const asked = [...generated.matchAll(/data\.sw\.rows\[id='([^']+)'\]/g)].map((match) => match[1])
    expect(asked.length).toBeGreaterThan(0)
    const known = new Set(FIRST_PARTY_PLUGINS.map((plugin) => plugin.id))
    for (const id of asked) expect(known.has(id)).toBe(true)
  })
})
