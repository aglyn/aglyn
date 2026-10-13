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

import { PLUGIN_TRANSFER_RESOURCES_DECLARED } from '@aglyn/aglyn/plugin-manager/first-party-plugins.generated'
import {
  pluginTransferResourceProblems,
  resetTransferResourcesForTests,
  resolveTransferResource,
  transferResourceCatalog,
} from '@aglyn/aglyn/plugin-manager/plugin-transfer-resources'
let mockServerHalfLoaded = false
jest.mock('./server/event-drafts.server', () => {
  mockServerHalfLoaded = true
  return { eventDraftWriter: null }
})

import { pluginAiCapability } from '@aglyn/aglyn/plugin-manager/plugin-ai-capabilities'
import { pluginResourceDraftWriter } from '@aglyn/aglyn/plugin-manager/plugin-resource-drafts'
import { resetPluginServicesForTests } from '@aglyn/aglyn/plugin-manager/plugin-services'
import { BUNDLE_ID } from './constants/bundle-common'
import {
  lazyEventDraftWriter,
  registerEventsCalendarConsoleServerDeclarations,
} from './declarations.console-server'
import { EVENT_DRAFT_RESOURCE } from './model/event-draft-content'

/**
 * The console boot registers the `events` resource against the real
 * extension point, under the declaration `plugins.config.json` compiles —
 * and loads nothing heavy doing it: the hooks that read or write load the
 * resource on first use.
 */
describe('events-calendar console-server declarations', () => {
  beforeEach(() => resetTransferResourcesForTests())

  it('registers every hook the declared resource needs', async () => {
    const declared = PLUGIN_TRANSFER_RESOURCES_DECLARED.find(
      (entry) => entry.key === 'events',
    )
    expect(declared).toMatchObject({
      pluginId: BUNDLE_ID,
      scope: 'host',
      kinds: ['records'],
    })
    expect(declared?.exportOnly).toBeUndefined()

    registerEventsCalendarConsoleServerDeclarations()

    const resolved = await resolveTransferResource('events')
    expect(resolved.pluginId).toBe(BUNDLE_ID)
    expect(pluginTransferResourceProblems(resolved, resolved.impl)).toEqual([])
    for (const hook of [
      'count',
      'readPage',
      'lookup',
      'plan',
      'apply',
      'revert',
    ] as const) {
      expect(typeof resolved.impl[hook]).toBe('function')
    }
  })

  it('registers the event draft writer and the build operation it executes, and checks without loading the Admin SDK (AGL-3743)', () => {
    resetPluginServicesForTests()
    registerEventsCalendarConsoleServerDeclarations()
    expect(pluginResourceDraftWriter(EVENT_DRAFT_RESOURCE)).toEqual({
      pluginId: BUNDLE_ID,
      writer: lazyEventDraftWriter,
    })
    expect(pluginAiCapability('event')?.pluginId).toBe(BUNDLE_ID)
    expect(pluginAiCapability('event')?.capability.draftResource).toBe(EVENT_DRAFT_RESOURCE)
    // The check is pure: it answered, and no server module was asked for.
    expect(
      lazyEventDraftWriter.check(
        { title: 'Tasting night', startsAt: '2026-12-03T18:30', timezone: 'America/New_York' },
        { hostId: 'host-1' },
      ),
    ).toMatchObject({ ok: true, facts: { status: 'draft' } })
    expect(mockServerHalfLoaded).toBe(false)
  })

  it('answers the catalog without loading the resource', async () => {
    registerEventsCalendarConsoleServerDeclarations()
    const resolved = await resolveTransferResource('events')
    const catalog = await transferResourceCatalog(resolved, {
      resource: 'events',
      orgId: 'org-1',
      hostId: 'host-1',
      actorUid: null,
    })
    expect(catalog.byId.get('startsAt')?.required).toBe(true)
    expect(resolved.impl.matchKeys?.[0]).toEqual({
      fieldId: 'id',
      normalizer: 'aglynId',
    })
  })
})
