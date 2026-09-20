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

import { emitHostEvent } from './emit-host-event'
import {
  dispatchHostAutomation,
  listHostEventListeners,
  registerHostEventListener,
  resetHostEventListenersForTests,
} from './host-event-listeners'

/**
 * The host-event seam (AGL-3105): the runtime raises an event and runs
 * nothing itself; whatever registered hears it.
 *
 * The promises the emitting doors depend on are the ones pinned here — every
 * listener hears every event, a failing listener costs only itself, and the
 * door never sees a rejection — because a form submission that 500s because
 * an automation threw is the failure this seam exists to rule out.
 */

const alert = (message: string) => ({ message, severity: 'info' as const })

beforeEach(() => {
  resetHostEventListenersForTests()
  jest.restoreAllMocks()
})

describe('emitHostEvent', () => {
  it('hands the event to every listener and gathers their alerts', async () => {
    const heard: string[] = []
    registerHostEventListener('first', {
      onEvent: async (hostId, event, payload) => {
        heard.push(`first:${hostId}:${event}:${payload['email']}`)
        return [alert('from first')]
      },
    })
    registerHostEventListener('second', {
      onEvent: async (hostId, event) => {
        heard.push(`second:${hostId}:${event}`)
      },
    })

    const { alerts } = await emitHostEvent('site-1', 'formSubmission', {
      email: 'ada@example.com',
    })

    expect(heard.sort()).toEqual([
      'first:site-1:formSubmission:ada@example.com',
      'second:site-1:formSubmission',
    ])
    expect(alerts).toEqual([alert('from first')])
  })

  it('costs a failing listener only itself, and never rejects', async () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    registerHostEventListener('broken', {
      onEvent: async () => {
        throw new Error('engine down')
      },
    })
    registerHostEventListener('working', {
      onEvent: async () => [alert('still ran')],
    })

    await expect(emitHostEvent('site-1', 'booking', {})).resolves.toEqual({
      alerts: [alert('still ran')],
    })
    expect(error).toHaveBeenCalledWith(
      '[host-events] broken failed on booking',
      'site-1',
      expect.any(Error),
    )
  })

  it('says once, not per event, that nothing is listening', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined)

    await expect(emitHostEvent('site-1', 'pageView', {})).resolves.toEqual({
      alerts: [],
    })
    await emitHostEvent('site-1', 'pageView', {})

    expect(warn).toHaveBeenCalledTimes(1)
  })
})

describe('registerHostEventListener', () => {
  it('replaces a plugin’s listener rather than adding a second', async () => {
    let runs = 0
    const listener = {
      onEvent: async () => {
        runs += 1
      },
    }
    // Boot registers it, and the plugin's API surface registers it again.
    registerHostEventListener('automation', listener)
    registerHostEventListener('automation', listener)

    await emitHostEvent('site-1', 'lead', {})

    expect(listHostEventListeners()).toEqual(['automation'])
    expect(runs).toBe(1)
  })

  it('refuses a listener that names no plugin', () => {
    expect(() =>
      registerHostEventListener(' ', { onEvent: async () => undefined }),
    ).toThrow(/plugin/)
  })
})

describe('dispatchHostAutomation', () => {
  it('reaches the listeners that dispatch, with the automation named', async () => {
    const dispatched: string[] = []
    registerHostEventListener('events-only', { onEvent: async () => undefined })
    registerHostEventListener('dispatcher', {
      onEvent: async () => undefined,
      onDispatch: async (hostId, automationId, event, payload) => {
        dispatched.push(`${hostId}:${automationId}:${event}:${payload['path']}`)
        return [alert('dispatched')]
      },
    })

    await expect(
      dispatchHostAutomation('site-1', 'action-9', 'scrollDepth', { path: '/pricing' }),
    ).resolves.toEqual([alert('dispatched')])
    expect(dispatched).toEqual(['site-1:action-9:scrollDepth:/pricing'])
  })

  it('never rejects when a dispatcher throws', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
    registerHostEventListener('dispatcher', {
      onEvent: async () => undefined,
      onDispatch: async () => {
        throw new Error('no such action')
      },
    })

    await expect(
      dispatchHostAutomation('site-1', 'action-9', 'elementClick', {}),
    ).resolves.toEqual([])
  })
})
