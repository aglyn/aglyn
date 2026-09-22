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

import { setRegisteringPluginId } from '../app-utils/registering-plugin'
import {
  capturePluginContact,
  listPluginContactSources,
  pluginContactCaptureWriter,
  pluginContactSource,
  registerPluginContactCaptureWriter,
  registerPluginContactSource,
  type PluginContactCaptureRequest,
  type PluginContactCaptureWriter,
} from './plugin-contact-capture'
import {
  resetPluginServicesForTests,
  unregisterPluginServices,
} from './plugin-services'

/**
 * The seam with no CRM, commerce, forms or bookings in it: a `rolodex` plugin
 * keeps the workspace's people, and two unrelated silos — a `kiosk` that takes
 * signatures at an event and a `mailer` that runs a newsletter box — hand it
 * whoever they met. Neither silo knows how a person is stored, keyed, staged
 * or refused, and neither imports the other or the rolodex.
 */

/** The rolodex's own store and rules; nothing outside its writer touches either. */
function rolodexPlugin() {
  const people = new Map<string, { id: string; profile: Record<string, unknown> }>()
  const erased = new Set(['gone@example.test'])
  let band = 10
  const writer: PluginContactCaptureWriter = {
    capture: async (request) => {
      const email = String(request.identity.email ?? '')
        .trim()
        .toLowerCase()
      if (!email.includes('@')) {
        return { ok: false, reason: 'invalid-email', error: 'That is not an address we can use' }
      }
      if (erased.has(email)) {
        return { ok: false, reason: 'erased', error: 'This person asked to be forgotten' }
      }
      const held = people.get(email)
      if (held) {
        // A visit by somebody already held merges; the profile keys given win,
        // and a key the silo did not give is left exactly as it was.
        held.profile = { ...held.profile, ...(request.profile ?? {}) }
        return { ok: true, record: 'contact', contactId: held.id, created: false }
      }
      if (people.size >= band) {
        return { ok: false, reason: 'band', error: 'This workspace is at the people it may hold' }
      }
      const id = `p-${people.size + 1}`
      people.set(email, { id, profile: { ...(request.profile ?? {}) } })
      return { ok: true, record: 'contact', contactId: id, created: true }
    },
  }
  return {
    writer,
    people,
    setBand: (value: number) => {
      band = value
    },
  }
}

/** A silo's call: it reports what it saw and nothing else. */
function kioskCapture(
  email: unknown,
  extra: Partial<PluginContactCaptureRequest> = {},
): PluginContactCaptureRequest {
  return {
    orgId: 'org-1',
    hostId: 'host-1',
    identity: { email, name: 'Sam Signature' },
    interaction: {
      source: 'kiosk',
      atMs: 1_760_000_000_000,
      refId: 'kioskVisits/v-1',
      summary: 'Signed the guest book',
    },
    ...extra,
  }
}

function declareSilos(): void {
  registerPluginContactSource(
    {
      source: 'kiosk',
      label: 'Guest book',
      openLabel: 'Open visit',
      recordKind: 'kioskVisit',
    },
    { pluginId: 'kiosk' },
  )
  // A newsletter box leaves nothing to open, so it declares no link.
  registerPluginContactSource(
    { source: 'mailer', label: 'Newsletter box' },
    { pluginId: 'mailer' },
  )
}

beforeEach(() => {
  resetPluginServicesForTests()
  setRegisteringPluginId(undefined)
})

describe('plugin contact capture', () => {
  it('lets a silo hand a person to whichever plugin keeps people', async () => {
    const rolodex = rolodexPlugin()
    setRegisteringPluginId('rolodex')
    registerPluginContactCaptureWriter(rolodex.writer)
    setRegisteringPluginId(undefined)

    expect(pluginContactCaptureWriter()).toEqual({
      pluginId: 'rolodex',
      writer: rolodex.writer,
    })
    expect(await capturePluginContact(kioskCapture('Sam@Example.test'))).toEqual({
      ok: true,
      record: 'contact',
      contactId: 'p-1',
      created: true,
    })
    // The same person again is a visit, not a second person.
    expect(
      await capturePluginContact(
        kioskCapture('sam@example.test', { profile: { phone: '555' } }),
      ),
    ).toEqual({ ok: true, record: 'contact', contactId: 'p-1', created: false })
    expect(rolodex.people.get('sam@example.test')?.profile).toEqual({ phone: '555' })
  })

  it('returns the owner’s refusal rather than throwing, so the silo keeps what it recorded', async () => {
    const rolodex = rolodexPlugin()
    registerPluginContactCaptureWriter(rolodex.writer, { pluginId: 'rolodex' })

    expect(await capturePluginContact(kioskCapture('not-an-address'))).toEqual({
      ok: false,
      reason: 'invalid-email',
      error: 'That is not an address we can use',
    })
    expect(await capturePluginContact(kioskCapture('gone@example.test'))).toEqual({
      ok: false,
      reason: 'erased',
      error: 'This person asked to be forgotten',
    })
    rolodex.setBand(0)
    expect(await capturePluginContact(kioskCapture('new@example.test'))).toEqual({
      ok: false,
      reason: 'band',
      error: 'This workspace is at the people it may hold',
    })
  })

  it('answers null when no plugin keeps people, and after the owner unloads', async () => {
    expect(pluginContactCaptureWriter()).toBeNull()
    expect(await capturePluginContact(kioskCapture('sam@example.test'))).toBeNull()

    registerPluginContactCaptureWriter(rolodexPlugin().writer, { pluginId: 'rolodex' })
    expect(await capturePluginContact(kioskCapture('sam@example.test'))).not.toBeNull()

    unregisterPluginServices('rolodex')
    expect(pluginContactCaptureWriter()).toBeNull()
    expect(await capturePluginContact(kioskCapture('sam@example.test'))).toBeNull()
  })

  it('keeps one writer: a second plugin is refused naming both, and the owner re-registers its own', async () => {
    const first = rolodexPlugin()
    const second = rolodexPlugin()
    registerPluginContactCaptureWriter(first.writer, { pluginId: 'rolodex' })
    expect(() =>
      registerPluginContactCaptureWriter(second.writer, { pluginId: 'kiosk' }),
    ).toThrow(
      'plugin service "core.contact-capture" is a single-implementation contract already registered by "rolodex"; refused "kiosk"',
    )
    expect(pluginContactCaptureWriter()?.writer).toBe(first.writer)

    registerPluginContactCaptureWriter(second.writer, { pluginId: 'rolodex' })
    expect(pluginContactCaptureWriter()?.writer).toBe(second.writer)
  })

  it('lets each silo declare its own door, with one owner per source word', () => {
    declareSilos()
    expect(pluginContactSource('kiosk')).toEqual({
      source: 'kiosk',
      label: 'Guest book',
      openLabel: 'Open visit',
      recordKind: 'kioskVisit',
      pluginId: 'kiosk',
    })
    // A door with nothing to open declares no link, which is the honest answer.
    expect(pluginContactSource('mailer')?.openLabel).toBeUndefined()
    expect(listPluginContactSources().map((one) => [one.source, one.pluginId])).toEqual([
      ['kiosk', 'kiosk'],
      ['mailer', 'mailer'],
    ])

    expect(() =>
      registerPluginContactSource(
        { source: 'kiosk', label: 'Signup sheet' },
        { pluginId: 'mailer' },
      ),
    ).toThrow(
      'contact capture source "kiosk" is already declared by "kiosk"; refused "mailer"',
    )
    expect(pluginContactSource('kiosk')?.label).toBe('Guest book')

    // The silo re-declaring replaces its own rather than adding a second.
    registerPluginContactSource(
      { source: 'kiosk', label: 'Guest book (lobby)' },
      { pluginId: 'kiosk' },
    )
    expect(listPluginContactSources()).toHaveLength(2)
    expect(pluginContactSource('kiosk')?.label).toBe('Guest book (lobby)')

    unregisterPluginServices('kiosk')
    expect(pluginContactSource('kiosk')).toBeNull()
  })

  it('needs a source word, a label and an owner', () => {
    expect(() =>
      registerPluginContactSource({ source: ' ', label: 'Nameless' }, { pluginId: 'kiosk' }),
    ).toThrow('a contact capture source needs a source word')
    expect(() =>
      registerPluginContactSource({ source: 'kiosk', label: '  ' }, { pluginId: 'kiosk' }),
    ).toThrow('contact capture source "kiosk" needs a label')
    expect(() =>
      registerPluginContactSource({ source: 'kiosk', label: 'Guest book' }),
    ).toThrow(/no owner/)
    expect(() =>
      registerPluginContactCaptureWriter(rolodexPlugin().writer),
    ).toThrow(/no owner/)
  })
})
