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

import * as Aglyn from '@aglyn/aglyn'
import {
  buildInteractionCandidate,
  pruneUndefined,
} from './interaction-builder-doc'

describe('interaction builder doc serialization (AGL-570)', () => {
  it('serializes a hover → open-menu interaction into a runtime-consumable action', () => {
    const selector = '[data-aglyn="leaf:nav-1"]'
    // Exactly what the dialog holds after picking When=hovered and
    // Then=Open a menu (target: this element): the action-type reset
    // leaves a fan of `undefined` siblings on the step.
    const candidate = buildInteractionCandidate({
      name: 'When hovered — nav-1',
      event: 'elementHoverEnter',
      selector,
      frequency: 'every',
      cooldownMinutes: 60,
      steps: [
        {
          type: 'openMenu',
          selector,
          menuNodeId: 'nav-1',
          className: undefined,
          message: undefined,
          workflowId: undefined,
          overlayId: undefined,
          url: undefined,
          eventName: undefined,
          drawerNodeId: undefined,
        },
      ],
    })

    // Trigger targets the element by its stable leaf selector on the
    // hover event the runtime already handles.
    expect(candidate.trigger).toEqual({
      event: 'elementHoverEnter',
      selector,
      everyTime: true,
    })
    // The open-menu step survives with its menuNodeId; the `undefined`
    // siblings are gone — a single one would reject the whole setDoc.
    expect(candidate.steps).toEqual([
      { type: 'openMenu', selector, menuNodeId: 'nav-1' },
    ])
    expect(candidate.enabled).toBe(true)

    // No `undefined` anywhere in the written doc (the Firestore instance
    // has no ignoreUndefinedProperties, so any would reject the write).
    for (const step of candidate.steps as unknown as Array<
      Record<string, unknown>
    >) {
      expect(Object.values(step).every((value) => value !== undefined)).toBe(
        true,
      )
    }

    // get-client-automations will surface it: the action validates, the
    // event is a site event, and the step is a client step.
    expect(Aglyn.validateHostAction(candidate)).toBeNull()
    expect(Aglyn.isSiteEventType(candidate.trigger.event)).toBe(true)
    expect(Aglyn.isClientActionStep(candidate.steps[0])).toBe(true)
  })

  it('maps each frequency to its trigger cap and keeps the selector', () => {
    const selector = '[data-aglyn="leaf:cta"]'
    const base = {
      name: 'x',
      event: 'elementClick',
      selector,
      cooldownMinutes: 15,
      steps: [{ type: 'siteAlert', message: 'hi' }],
    }
    expect(
      buildInteractionCandidate({ ...base, frequency: 'session' }).trigger,
    ).toEqual({ event: 'elementClick', selector, oncePerSession: true })
    expect(
      buildInteractionCandidate({ ...base, frequency: 'visitor' }).trigger,
    ).toEqual({ event: 'elementClick', selector, oncePerVisitor: true })
    expect(
      buildInteractionCandidate({ ...base, frequency: 'cooldown' }).trigger,
    ).toEqual({ event: 'elementClick', selector, cooldownMinutes: 15 })
    // "always" (once per page view) carries no cap flag.
    expect(
      buildInteractionCandidate({ ...base, frequency: 'always' }).trigger,
    ).toEqual({ event: 'elementClick', selector })
  })

  it('drops undefined keys deeply while preserving falsy values', () => {
    expect(
      pruneUndefined({
        a: undefined,
        b: 0,
        c: '',
        d: false,
        e: null,
        f: { g: undefined, h: 1, i: [{ j: undefined, k: 2 }] },
      }),
    ).toEqual({ b: 0, c: '', d: false, e: null, f: { h: 1, i: [{ k: 2 }] } })
  })
})
