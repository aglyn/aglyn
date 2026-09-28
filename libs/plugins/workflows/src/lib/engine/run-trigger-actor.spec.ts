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

import { runTriggeredByFields, withRunTriggerActor } from './run-trigger-actor'

describe('who set a run off (AGL-3376)', () => {
  it('stamps nothing outside a scope — a resumed wait is not recorded', () => {
    expect(runTriggeredByFields()).toEqual({})
  })

  it('stamps the actor through every await inside the scope', async () => {
    const seen = await withRunTriggerActor(
      { kind: 'member', uid: 'u1', email: 'rep@example.test' },
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 1))
        // A chained event's run is written deeper still, and is credited
        // to whoever caused the first one.
        return await Promise.resolve().then(() => runTriggeredByFields())
      },
    )
    expect(seen).toEqual({
      triggeredBy: { kind: 'member', uid: 'u1', email: 'rep@example.test' },
    })
    expect(runTriggeredByFields()).toEqual({})
  })

  it('writes only the keys the door knew — Firestore refuses undefined', async () => {
    const fields = await withRunTriggerActor(
      { kind: 'apiKey', apiKeyName: 'Zapier', uid: null, email: undefined },
      async () => runTriggeredByFields(),
    )
    expect(fields).toEqual({ triggeredBy: { kind: 'apiKey', apiKeyName: 'Zapier' } })
  })

  it('keeps two concurrent events apart', async () => {
    const [a, b] = await Promise.all([
      withRunTriggerActor({ kind: 'visitor' }, async () => {
        await new Promise((resolve) => setTimeout(resolve, 5))
        return runTriggeredByFields()
      }),
      withRunTriggerActor({ kind: 'platform' }, async () => runTriggeredByFields()),
    ])
    expect(a).toEqual({ triggeredBy: { kind: 'visitor' } })
    expect(b).toEqual({ triggeredBy: { kind: 'platform' } })
  })
})
