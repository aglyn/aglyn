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
 * @jest-environment node
 */

import { pluginResourceDraftWriter } from '@aglyn/aglyn/plugin-manager/plugin-resource-drafts'
import { resetPluginServicesForTests } from '@aglyn/aglyn/plugin-manager/plugin-services'
import { CONSOLE_PLUGIN_SERVER_MANIFEST } from '../constants/plugins.server.generated'

/**
 * "ACT ON THIS DROP-OFF" DRAFTS AN AUTOMATION THE WORKFLOWS PLUGIN WOULD STORE
 * (AGL-3605).
 *
 * The funnels plugin builds the automation and hands it to whichever plugin
 * registered the `automation` draft writer; it may not import that plugin,
 * so its own spec checks the shape against a stand-in. This is where the
 * shape meets the real writer's validator — the Actions editor's — reached
 * the way the console reaches both: through the generated manifest.
 */

const load = async (id: string) => {
  const entry = CONSOLE_PLUGIN_SERVER_MANIFEST.find((one) => one.id === id)
  if (!entry) throw new Error(`no "${id}" in the console's server manifest`)
  const mod = (await entry.load()) as Record<string, any>
  const registrar = (entry.register as Record<string, string | undefined>)['consoleApi']
  if (registrar) await mod[registrar]()
  return mod
}

describe('the drop-off automation, against the automation writer', () => {
  let draft: (options: Record<string, unknown>) => { name: string; content: Record<string, unknown> }

  beforeAll(async () => {
    resetPluginServicesForTests()
    await load('workflows')
    draft = (await load('funnels'))['dropOffAutomationContent']
  })

  const steps = [
    { type: 'page', key: '/pricing', match: 'exact' },
    { type: 'form', key: 'quote', label: 'Quote form' },
    { type: 'booking', key: '' },
  ]

  it.each(['email', 'task'])('passes the writer’s check as a %s follow-up, switched off', (action) => {
    const writer = pluginResourceDraftWriter('automation')
    expect(writer?.pluginId).toBe('workflows')
    const { content } = draft({ funnelId: 'f1', funnelName: 'Quote', steps, watch: { step: 2, afterHours: 24 }, action })
    const check = writer!.writer.check(content, { hostId: 'h1' })
    expect(check).toEqual({ ok: true, facts: expect.objectContaining({ event: 'funnelLeft', steps: 1, enabled: false }) })
  })
})
