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
  HOST_EVENT_LABELS,
  HOST_EVENT_PAYLOAD_KEYS,
  HOST_EVENT_TYPES,
  HOST_EVENTS,
  hostEventLabel,
  hostEventPayloadHint,
} from './host-events'

/**
 * The events an automation can start on (AGL-128): the platform's own page
 * view, and every event a plugin's doors raise, declared by that plugin
 * under `hostEvents` in plugins.config.json and compiled (AGL-3080).
 */

const REPO_ROOT = join(__dirname, '../../../../..')

describe('host events', () => {
  it('list the platform’s page view and every declared event, in picker order', () => {
    // The order every trigger picker, the AI's trigger list and a stored
    // automation's default have always shown.
    expect(HOST_EVENT_TYPES).toEqual([
      'formSubmission',
      'pageView',
      'memberSignUp',
      'memberSignIn',
      'memberSignOut',
      'lead',
      'booking',
      'taskCompleted',
      'contactCreated',
      'contactStageChanged',
      'dealStageChanged',
      'dealWon',
      'dealLost',
      'funnelLeft',
    ])
    expect(HOST_EVENTS.find((event) => event.type === 'pageView')?.pluginId).toBeUndefined()
  })

  it('are declared by the plugin whose doors raise them, and core names none', () => {
    const config = JSON.parse(readFileSync(join(REPO_ROOT, 'plugins.config.json'), 'utf8')) as {
      plugins: Array<{ id: string; hostEvents?: Array<{ type: string }> }>
    }
    const declared = new Map(
      config.plugins.flatMap((plugin) =>
        (plugin.hostEvents ?? []).map((event) => [event.type, plugin.id] as const),
      ),
    )
    for (const event of HOST_EVENTS) {
      if (event.type === 'pageView') continue
      expect([event.type, event.pluginId]).toEqual([event.type, declared.get(event.type)])
    }
    const source = readFileSync(join(__dirname, 'host-events.ts'), 'utf8')
    for (const type of declared.keys()) expect(source).not.toContain(`'${type}'`)
  })

  it('read as words, and a custom event keeps its name', () => {
    expect(hostEventLabel('contactCreated')).toBe('Contact created')
    expect(hostEventLabel('contactStageChanged')).toBe('Contact changed stage')
    expect(hostEventLabel('formSubmission')).toBe('Form submitted')
    expect(hostEventLabel('pageView')).toBe('Page viewed')
    // The fallback is the identifier: a custom event is the author's own word.
    expect(hostEventLabel('cartAbandoned')).toBe('cartAbandoned')
    expect(hostEventLabel('')).toBe('Event')
    expect(hostEventLabel(undefined)).toBe('Event')
    for (const type of HOST_EVENT_TYPES) expect(HOST_EVENT_LABELS[type]).toBeTruthy()
  })

  it('name the payload keys a filter can read', () => {
    expect(HOST_EVENT_PAYLOAD_KEYS.contactCreated).toEqual([
      'contactId',
      'email',
      'name',
      'source',
      'hostId',
      'lifecycleStage',
      'campaignIds',
      'formId',
    ])
    expect(HOST_EVENT_PAYLOAD_KEYS.contactStageChanged).toEqual([
      'contactId',
      'email',
      'lifecycleStage',
      'previousStage',
    ])
    expect(HOST_EVENT_PAYLOAD_KEYS.pageView).toEqual(['path'])
    expect(hostEventPayloadHint('contactStageChanged')).toBe(
      'In scope: contactId, email, lifecycleStage, previousStage.',
    )
    // A custom event, and a declared one whose door documents no payload,
    // have no hint — the hint says nothing rather than inventing one.
    expect(hostEventPayloadHint('memberSignOut')).toBeNull()
    expect(hostEventPayloadHint('cartAbandoned')).toBeNull()
    expect(hostEventPayloadHint('')).toBeNull()
  })
})
