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

/**
 * Relaying a host event onto the outbox (AGL-3643): only what a hook of the
 * site takes, in the shape the REST API reads it, keyed by its record.
 */

import { readZapierHookEvents, ZAPIER_DOMAIN_EVENTS, zapierEventForHostEvent } from '../model/hook-events'
import { relayHostEventToZapier, type ZapierRelayDeps, type ZapierRelayRequest } from './relay'

function setup(hooked: string[] = ['contact.created', 'form.submitted']) {
  const raised: ZapierRelayRequest[] = []
  const asked: string[] = []
  const deps: ZapierRelayDeps = {
    hasHook: async (_hostId, event) => {
      asked.push(event)
      return hooked.includes(event)
    },
    raise: async (request) => void raised.push(request),
    randomKey: () => 'rnd',
  }
  return { deps, raised, asked }
}

describe('relayHostEventToZapier (AGL-3643)', () => {
  it('relays a new contact, keyed by its id, without the site in the record', async () => {
    const { deps, raised } = setup()
    const relayed = await relayHostEventToZapier(deps, 'h1', 'contactCreated', {
      contactId: 'c1',
      email: 'avery@example.com',
      name: 'Avery',
      source: 'form',
      hostId: 'h1',
      lifecycleStage: 'lead',
    })
    expect(relayed).toBe(true)
    expect(raised).toEqual([
      {
        hostId: 'h1',
        key: 'contact.created:contact:c1',
        payload: {
          event: 'contact.created',
          data: { contact: { id: 'c1', email: 'avery@example.com', name: 'Avery', source: 'form', lifecycleStage: 'lead' } },
        },
      },
    ])
  })

  it('relays a form submission as the API publishes it, named by the stored submission', async () => {
    const { deps, raised } = setup()
    await relayHostEventToZapier(
      deps,
      'h1',
      'formSubmission',
      { formId: 'frm_1', formName: 'Contact', path: '/contact', email: 'a@example.com', message: 'Hi' },
      { recordId: 'sub_9' },
    )
    expect(raised[0]).toEqual({
      hostId: 'h1',
      key: 'form.submitted:submission:sub_9',
      payload: {
        event: 'form.submitted',
        data: {
          submission: {
            id: 'sub_9',
            object: 'form_submission',
            form_id: 'frm_1',
            form: 'Contact',
            path: '/contact',
            fields: { email: 'a@example.com', message: 'Hi' },
            read: false,
          },
        },
      },
    })
  })

  it('relays nothing for a site with no hook taking the event, at one read', async () => {
    const { deps, raised, asked } = setup([])
    expect(await relayHostEventToZapier(deps, 'h1', 'formSubmission', { formName: 'Contact' })).toBe(false)
    expect(asked).toEqual(['form.submitted'])
    expect(raised).toEqual([])
  })

  it('reads nothing for an event no hook can take, and relays no contact without an id', async () => {
    const { deps, raised, asked } = setup()
    expect(await relayHostEventToZapier(deps, 'h1', 'pageView', {})).toBe(false)
    expect(await relayHostEventToZapier(deps, 'h1', 'dealWon', { dealId: 'd1' })).toBe(false)
    expect(asked).toEqual([])
    expect(await relayHostEventToZapier(deps, 'h1', 'contactCreated', { email: 'x@example.com' })).toBe(false)
    expect(raised).toEqual([])
  })
})

describe('the hook event catalog (AGL-3643)', () => {
  it('reads `events` or one `event`, in catalog order, naming what it does not know', () => {
    expect(readZapierHookEvents({ events: ['order.refunded', 'order.paid', 'order.paid'] })).toEqual({
      events: ['order.paid', 'order.refunded'],
      unknown: [],
    })
    expect(readZapierHookEvents({ event: 'booking.created' })).toEqual({ events: ['booking.created'], unknown: [] })
    expect(readZapierHookEvents({ events: ['nope', 'form.submitted'] })).toEqual({
      events: ['form.submitted'],
      unknown: ['nope'],
    })
    expect(readZapierHookEvents({})).toEqual({ events: [], unknown: [] })
  })

  it('subscribes to the outbox events and relays the two host events', () => {
    expect(ZAPIER_DOMAIN_EVENTS).toEqual([
      'order.paid',
      'order.fulfilled',
      'order.delivered',
      'order.refunded',
      'order.cancelled',
      'booking.created',
      'booking.rescheduled',
      'booking.canceled',
    ])
    expect(zapierEventForHostEvent('contactCreated')).toBe('contact.created')
    expect(zapierEventForHostEvent('formSubmission')).toBe('form.submitted')
    expect(zapierEventForHostEvent('booking')).toBeNull()
  })
})
