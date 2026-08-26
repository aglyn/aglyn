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

import {
  presenceFaultNotice,
  type PresenceFault,
} from '../hooks/use-presence'

/**
 * The presence failure copy names a REMEDY (AGL-2486).
 *
 * what does this mean? It
 * gives the users no course of action on how to fix it. The tooltip then
 * read `Presence could not start. … Failed at: broker (500) — Could not start
 * presence` — a stage name and an HTTP status, in front of a customer, with
 * nothing in it a customer could act on.
 *
 * These are assertions about WORDS, which is unusual and deliberate. The copy
 * is the entire deliverable of that half of the issue: there is no behaviour
 * to assert, so a spec that only checked `fault.kind` would pass on a build
 * that had quietly gone back to printing a status code. Each case below
 * failed against the pre-AGL-2486 tree.
 */

const fault = (over: Partial<PresenceFault> = {}): PresenceFault => ({
  kind: 'broken',
  stage: 'broker',
  code: '500',
  message: 'Could not start presence',
  ...over,
})

describe('every presence failure keeps the two things that were right', () => {
  const kinds: PresenceFault['kind'][] = [
    'unconfigured',
    'signed-out',
    'not-allowed',
    'broken',
  ]

  it.each(kinds)(
    'still warns that an empty stack is not proof you are alone (%s)',
    (kind) => {
      // the requirement was for this sentence to be KEPT. It is the one thing on the
      // badge that prevents the worst outcome — two people editing the same
      // screen, each believing the empty avatar stack means they are alone.
      expect(presenceFaultNotice(fault({ kind })).caution).toContain(
        'does NOT mean you are alone',
      )
    },
  )

  it.each(kinds)('says the reader’s own work is unaffected (%s)', (kind) => {
    // Presence failing looks, from the canvas, exactly like the editor having
    // lost its connection. Without this sentence the reasonable response is
    // to stop working or start copying things out — over a badge that has
    // nothing to do with saving.
    const { caution } = presenceFaultNotice(fault({ kind }))
    expect(caution).toContain('Your own editing is unaffected')
    expect(caution).toContain('saved normally')
  })

  it.each(kinds)('leads with prose, never a stage name or a code (%s)', (kind) => {
    const { title, remedy } = presenceFaultNotice(fault({ kind }))
    for (const lead of [title, remedy]) {
      expect(lead).not.toMatch(/\bbroker\b/i)
      expect(lead).not.toMatch(/\b(?:4|5)\d\d\b/)
      expect(lead).not.toMatch(/Failed at:/i)
    }
  })
})

describe('the technical detail survives, behind the copy rather than in it', () => {
  it('carries stage, code and message for whoever debugs this next', () => {
    // Moving it out of the lead must not mean losing it: this string is what
    // a reader pastes into a support message.
    expect(
      presenceFaultNotice(
        fault({ stage: 'room', code: 'PERMISSION_DENIED', message: 'nope' }),
      ).detail,
    ).toBe('room (PERMISSION_DENIED) — nope')
  })

  it('is empty rather than invented when there is no fault', () => {
    expect(presenceFaultNotice(null).detail).toBe('')
  })
})

describe('a deployment without presence is not an outage', () => {
  it('tells the reader there is nothing to retry', () => {
    // The self-host case (`project_self_host_docker_byo_firebase`): a Docker
    // install that brought its own Firebase and no Realtime Database is
    // working as configured. Telling its operator to "reload and tell
    // support" would send them hunting a bug that does not exist.
    const notice = presenceFaultNotice(
      fault({ kind: 'unconfigured', stage: 'config', code: 'no-database-url' }),
    )
    expect(notice.title).toContain('not set up')
    expect(notice.remedy).toContain('Nothing is broken')
    expect(notice.remedy).not.toMatch(/reload/i)
  })

  it('reads differently from a live failure, which is the whole point', () => {
    const broken = presenceFaultNotice(fault({ kind: 'broken' }))
    const unconfigured = presenceFaultNotice(fault({ kind: 'unconfigured' }))
    expect(broken.title).not.toBe(unconfigured.title)
    expect(broken.remedy).not.toBe(unconfigured.remedy)
    // Only one of the two is a bug, and only one of the two asks for a retry.
    expect(broken.remedy).toMatch(/reload/i)
  })
})

describe('each remaining kind names the ONE thing that reader can do', () => {
  it('a stale session is told to sign in again', () => {
    // This is the case the SSO revocation bug produced. It arrived as a 500,
    // so the old copy blamed the server — and the one action that would have
    // worked was the one nothing mentioned.
    const notice = presenceFaultNotice(fault({ kind: 'signed-out' }))
    expect(notice.remedy).toMatch(/sign (out and sign )?back in|sign in again/i)
  })

  it('an unadmitted account is told who to ask', () => {
    const notice = presenceFaultNotice(fault({ kind: 'not-allowed' }))
    expect(notice.remedy).toMatch(/admin/i)
    // And reassured about the thing they will otherwise assume they lost.
    expect(notice.remedy).toMatch(/editing permissions are unchanged/i)
  })
})
