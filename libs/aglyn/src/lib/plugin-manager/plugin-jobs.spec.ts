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

/**
 * THE JOB CONTRACT'S LOCKDOWN GATE (AGL-2495, from the AGL-1621 drill).
 *
 * The runner is the single place a background job's lockdown verdict comes
 * from, so this is where that mechanism is held: who supplies the answer,
 * what happens when nobody does, and what a job that mis-declares its scope
 * gets back.
 *
 * The behaviour of the six real jobs is asserted where they live
 * (`job-lockdown.spec.ts` in each plugin, `publish-schedule-job-lockdown.spec.ts`
 * in the tenant). This file is about the contract they all hang off.
 */

import {
  hasPluginJobHostLockdown,
  pluginJobHostGate,
  registerPluginJobHostLockdown,
  resetPluginJobHostLockdownForTests,
  resetPluginJobLockdownWarningForTests,
  runPluginJobs,
  type PluginJob,
  type PluginJobHostGate,
} from './plugin-jobs'

/**
 * The registry is module state shared with every other suite in this project,
 * so each test registers what it needs and the resolver is reset around it.
 */
beforeEach(() => {
  resetPluginJobHostLockdownForTests()
  resetPluginJobLockdownWarningForTests()
})
afterAll(() => {
  resetPluginJobHostLockdownForTests()
})

/** A job the runner will find, with a handler that records its gate. */
function job(overrides: Partial<PluginJob> & Pick<PluginJob, 'name'>): PluginJob {
  return {
    pluginId: 'spec',
    intervalMinutes: 1,
    lockdown: { scope: 'per-host' },
    handler: () => undefined,
    ...overrides,
  }
}

/** Run exactly one job, without disturbing whatever else is registered. */
async function runOnly(target: PluginJob) {
  const { registerPluginJob } = await import('./plugin-jobs')
  registerPluginJob(target)
  return runPluginJobs((candidate) => candidate.name === target.name)
}

describe('AGL-2495 · the host lockdown resolver registry', () => {
  it('starts unregistered, and says so', () => {
    expect(hasPluginJobHostLockdown()).toBe(false)
  })

  it('asks the registered resolver, and passes the host through', async () => {
    const asked: string[] = []
    registerPluginJobHostLockdown(async (hostId) => {
      asked.push(hostId)
      return hostId === 'locked'
    })
    expect(hasPluginJobHostLockdown()).toBe(true)

    const gate = pluginJobHostGate()
    expect(await gate.isLocked('locked')).toBe(true)
    expect(await gate.isLocked('healthy')).toBe(false)
    expect(asked).toEqual(['locked', 'healthy'])
  })

  it('only the exact answer TRUE locks — a truthy value does not', async () => {
    // The `lockdownEnforcement` posture, one level out: a resolver that
    // answered with an object, a string, or anything a future refactor might
    // return must not be read as "locked" by truthiness. Over-refusing here
    // freezes every background job on the platform.
    registerPluginJobHostLockdown((() => 'yes') as never)
    expect(await pluginJobHostGate().isLocked('any')).toBe(false)
  })

  it('answers NOT LOCKED, loudly, when nothing is registered', async () => {
    // FAIL OPEN, deliberately: a self-host that never wired a carrier must
    // not have its background work welded shut. The console.error is the
    // whole of the compensation, so it is asserted rather than assumed.
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(await pluginJobHostGate().isLocked('anything')).toBe(false)
    expect(spy).toHaveBeenCalledTimes(1)
    expect(String(spy.mock.calls[0][0])).toContain('UNGATED')
    // Once per process, not once per host — a per-minute beat across every
    // site would otherwise bury every other line in the log.
    await pluginJobHostGate().isLocked('another')
    expect(spy).toHaveBeenCalledTimes(1)
    spy.mockRestore()
  })

  it('never asks the resolver about an empty host id', async () => {
    const asked: string[] = []
    registerPluginJobHostLockdown(async (hostId) => {
      asked.push(hostId)
      return true
    })
    // A row with no host is a data defect, not a locked site. Answering
    // "locked" would freeze it forever; asking the resolver would make every
    // such row a Firestore read.
    expect(await pluginJobHostGate().isLocked('')).toBe(false)
    expect(asked).toEqual([])
  })
})

describe('AGL-2495 · the runner injects the gate', () => {
  it('hands a per-host job a working gate', async () => {
    registerPluginJobHostLockdown(async (hostId) => hostId === 'locked')
    const seen: boolean[] = []
    await runOnly(
      job({
        name: 'injected-gate',
        handler: async (gate: PluginJobHostGate) => {
          seen.push(await gate.isLocked('locked'))
          seen.push(await gate.isLocked('healthy'))
        },
      }),
    )
    expect(seen).toEqual([true, false])
  })

  it('a platform-scoped job that asks about a host FAILS', async () => {
    // The one runtime enforcement of the declaration. `{ scope: 'platform' }`
    // is a claim that there is no host to ask about; a job that asks anyway
    // has mislabelled itself, and answering "not locked" would let a
    // mislabelled job mutate a locked site while looking correct.
    registerPluginJobHostLockdown(async () => true)
    const results = await runOnly(
      job({
        name: 'mislabelled',
        lockdown: { scope: 'platform', reason: 'claims to touch no host' },
        handler: async (gate: PluginJobHostGate) => {
          await gate.isLocked('some-host')
        },
      }),
    )
    expect(results).toHaveLength(1)
    expect(results[0].ok).toBe(false)
    expect(results[0].error).toContain("declared lockdown scope 'platform'")
    expect(results[0].error).toContain('some-host')
  })

  it('a platform-scoped job that asks NOTHING runs fine', async () => {
    // The refusal must be about asking, not about being platform-scoped —
    // otherwise the escape hatch is unusable and the runtime check is just a
    // second way to fail.
    const results = await runOnly(
      job({
        name: 'honest-platform',
        lockdown: { scope: 'platform', reason: 'touches no host' },
        handler: () => undefined,
      }),
    )
    expect(results[0].ok).toBe(true)
  })

  it('one job throwing does not stop the next — isolation survives', async () => {
    // The pre-existing guarantee, re-asserted because the gate added a new
    // way for a handler to throw.
    registerPluginJobHostLockdown(async () => true)
    const ran: string[] = []
    const { registerPluginJob } = await import('./plugin-jobs')
    registerPluginJob(
      job({
        name: 'isolation-a',
        lockdown: { scope: 'platform', reason: 'x' },
        handler: async (gate: PluginJobHostGate) => {
          await gate.isLocked('h')
        },
      }),
    )
    registerPluginJob(
      job({
        name: 'isolation-b',
        handler: () => {
          ran.push('b')
        },
      }),
    )
    const results = await runPluginJobs((candidate) =>
      candidate.name.startsWith('isolation-'),
    )
    expect(results.map((result) => result.ok)).toEqual([false, true])
    expect(ran).toEqual(['b'])
  })
})
