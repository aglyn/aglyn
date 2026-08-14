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
 * The AI-assist drawer's 423, DRIVEN (AGL-1557).
 *
 * `apps/console/specs/lockdown-client-notice.spec.ts` pins this file at its
 * DECLARATION: it greps the source for `parseLockdownRefusal(` and
 * `lockdownRefusalText(`. Both symbols can be present on a provider that
 * parses the refusal and then falls through to `AI request failed` anyway —
 * the "computed but not wired" shape — and the coverage spec passes. So this
 * file mounts the provider, opens each of its two doors the way the designer
 * opens them (through `AiAssistContext`), answers `/api/ai/assist` with a
 * real 423, and asserts on the snackbar the user is actually shown.
 *
 * Unlike billing (AGL-1558 moved that surface to an inline `LockdownNotice`),
 * this one is still snackbar-shaped and correctly so: the drawer is a modal
 * over a canvas with no room for a structured alert, and the refusal is an
 * answer to something the user just pressed.
 *
 * TWO doors, not one. `handleConfirm` (rewrite) and `handleSectionConfirm`
 * (generate a section) each POST to `/api/ai/assist` and each carry their own
 * copy of the branch order; a fix applied to one and missed on the other is
 * exactly the drift a per-file coverage grep cannot see.
 *
 * FIXTURES: the 423 body is assembled from `lockdownNotice` the way
 * `lockdownJsonResponse` assembles it, and the expected text is produced by
 * the real `parseLockdownRefusal` + `lockdownRefusalText`. Nothing here
 * hand-types notice copy.
 */

import {
  lockdownNotice,
  lockdownRefusalText,
  parseLockdownRefusal,
  PLAN_ENTITLEMENTS,
  SELF_SERVE_PLANS,
  type LockdownState,
} from '@aglyn/aglyn'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useContext } from 'react'

const enqueueSnackbar = jest.fn()

jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar }),
}))
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useUser: () => ({ data: { getIdToken: async () => 'token' } }),
}))

/**
 * The designer's context, stubbed to its shape. Mounting the real besigner
 * to read one context value would drag the whole canvas in; what is under
 * test is the provider's fetch branch, and the provider publishes into this
 * context either way.
 */
jest.mock('@aglyn/besigner-ui', () => ({
  AiAssistContext: require('react').createContext(null),
}))

/**
 * Only `canvas` is stubbed — the rest of `@aglyn/aglyn` is REAL, because the
 * parser, the notice builder and the entitlement gate under test all live
 * there. The rewrite door reads the node's current text off the canvas
 * singleton BEFORE it fetches, so it needs a canvas that answers.
 */
const canvasUpdateNodeProps = jest.fn()
const canvasAddNodeFromPreset = jest.fn()
jest.mock('@aglyn/aglyn', () => ({
  ...jest.requireActual('@aglyn/aglyn'),
  canvas: {
    toJSON: () => ({ nodes: { 'node-1': { props: { children: 'Old copy' } } } }),
    updateNodeProps: (...args: unknown[]) => canvasUpdateNodeProps(...args),
    addNodeFromPreset: (...args: unknown[]) => canvasAddNodeFromPreset(...args),
    rootNode: { $id: 'root' },
  },
}))

import { AiAssistContext } from '@aglyn/besigner-ui'
import { AiAssistProvider } from './ai-assist-provider.component'

/**
 * The 423 body the ai/assist chokepoint emits, mirroring
 * `lockdownJsonResponse` — one spread of `lockdownNotice`, the same pure
 * builder the server calls.
 */
function refusalBody(state: LockdownState): Record<string, unknown> {
  const notice = lockdownNotice(state)
  return {
    error: 'locked',
    scope: state.scope,
    ...(state.feature ? { feature: state.feature } : {}),
    reason: state.reason,
    title: notice.title,
    message: notice.body,
    ...(notice.contact ? { contact: notice.contact } : {}),
    ...(typeof state.untilMs === 'number' ? { untilMs: state.untilMs } : {}),
  }
}

const AI_LOCK: LockdownState = {
  scope: 'feature',
  feature: 'ai-assist',
  reason: 'manual',
}

/** What the user must end up reading, derived rather than transcribed. */
function expectedText(state: LockdownState): string {
  const notice = parseLockdownRefusal(423, refusalBody(state))
  if (!notice) throw new Error('a 423 must always parse to a notice')
  return lockdownRefusalText(notice)
}

/** The cheapest plan that actually carries `aiAssist` — the gate is real. */
const AI_PLAN = SELF_SERVE_PLANS.find(
  (plan) => PLAN_ENTITLEMENTS[plan]?.features?.aiAssist,
)
const ORG = { plan: AI_PLAN }

let assistAnswers: Array<{ status: number; payload: unknown }>
let assistCalls: Array<Record<string, unknown>>

beforeEach(() => {
  enqueueSnackbar.mockClear()
  canvasUpdateNodeProps.mockClear()
  canvasAddNodeFromPreset.mockClear()
  assistAnswers = []
  assistCalls = []
  global.fetch = jest.fn(async (input: any, init?: any) => {
    const url = String(input)
    if (url !== '/api/ai/assist') throw new Error(`unexpected fetch: ${url}`)
    assistCalls.push(JSON.parse(String(init?.body ?? '{}')))
    const answer = assistAnswers.shift()
    if (!answer) throw new Error('unqueued /api/ai/assist call')
    return {
      ok: answer.status >= 200 && answer.status < 300,
      status: answer.status,
      json: async () => answer.payload,
    }
  }) as any
})

afterEach(() => {
  jest.restoreAllMocks()
})

/** Opens whichever door the designer would open, through the real context. */
function Doors() {
  const assist = useContext(AiAssistContext) as any
  return (
    <>
      <button onClick={() => assist?.onRewrite({ $id: 'node-1' })}>
        {'open rewrite'}
      </button>
      <button onClick={() => assist?.onGenerateSection()}>
        {'open section'}
      </button>
    </>
  )
}

function mountProvider() {
  render(
    <AiAssistProvider org={ORG} orgReady>
      <Doors />
    </AiAssistProvider>,
  )
}

/** Drive the rewrite door end to end: open, type an instruction, submit. */
async function driveRewrite() {
  mountProvider()
  fireEvent.click(screen.getByRole('button', { name: 'open rewrite' }))
  fireEvent.change(await screen.findByLabelText('Instruction'), {
    target: { value: 'Make it punchier' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Rewrite' }))
  await waitFor(() => {
    expect(assistCalls.length).toBe(1)
  })
}

/** Same for the section door, which posts `mode: 'section'`. */
async function driveSection() {
  mountProvider()
  fireEvent.click(screen.getByRole('button', { name: 'open section' }))
  fireEvent.change(await screen.findByLabelText('Section'), {
    target: { value: 'A hero with a headline and a CTA' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Generate' }))
  await waitFor(() => {
    expect(assistCalls.length).toBe(1)
  })
}

describe('AGL-1557 · the AI-assist doors read the 423 body', () => {
  it('the REWRITE door says the lock, not “AI request failed”', async () => {
    assistAnswers = [{ status: 423, payload: refusalBody(AI_LOCK) }]
    await driveRewrite()

    await waitFor(() => {
      expect(enqueueSnackbar).toHaveBeenCalledWith(
        expectedText(AI_LOCK),
        // Persistent: a paused feature is not a four-second flash, and the
        // user is mid-task with a dialog open in front of them.
        expect.objectContaining({ variant: 'warning', persist: true }),
      )
    })
    const said = enqueueSnackbar.mock.calls.map((call) => String(call[0]))
    expect(said).not.toContain('AI request failed')
    // The refusal must not be mistaken for a rewrite: nothing lands on the node.
    expect(canvasUpdateNodeProps).not.toHaveBeenCalled()
  })

  it('the SECTION door says the same thing — both doors, one behaviour', async () => {
    assistAnswers = [{ status: 423, payload: refusalBody(AI_LOCK) }]
    await driveSection()
    expect(assistCalls[0]).toMatchObject({ mode: 'section' })

    await waitFor(() => {
      expect(enqueueSnackbar).toHaveBeenCalledWith(
        expectedText(AI_LOCK),
        expect.objectContaining({ variant: 'warning', persist: true }),
      )
    })
    expect(
      enqueueSnackbar.mock.calls.map((call) => String(call[0])),
    ).not.toContain('AI request failed')
    expect(canvasAddNodeFromPreset).not.toHaveBeenCalled()
  })

  it('carries the expected-back line when the lock has an end', async () => {
    const timed = { ...AI_LOCK, untilMs: Date.parse('2026-09-01T12:00:00Z') }
    assistAnswers = [{ status: 423, payload: refusalBody(timed) }]
    await driveRewrite()

    const text = expectedText(timed)
    expect(text).toMatch(/Expected back around /)
    await waitFor(() => {
      expect(enqueueSnackbar).toHaveBeenCalledWith(
        text,
        expect.objectContaining({ variant: 'warning' }),
      )
    })
    // The parser restates the expiry on the reader's clock; the server's UTC
    // blob must not survive into the sentence.
    expect(text).not.toContain(new Date(timed.untilMs).toUTCString())
  })

  it('a 423 whose body lost its copy still reads as a pause', async () => {
    // A refusal that reached the client through something that stripped the
    // body — the degradation rule the parser owns, checked where the user is.
    assistAnswers = [{ status: 423, payload: {} }]
    await driveRewrite()
    const notice = parseLockdownRefusal(423, {})
    await waitFor(() => {
      expect(enqueueSnackbar).toHaveBeenCalledWith(
        lockdownRefusalText(notice as never),
        expect.objectContaining({ variant: 'warning' }),
      )
    })
    const said = enqueueSnackbar.mock.calls.map((call) => String(call[0])).join(' ')
    // The two failure modes the fallback copy exists to prevent.
    expect(said).not.toContain('undefined')
    expect(said).not.toMatch(/something went wrong/i)
  })
})

describe('AGL-1557 · the notice has not replaced the ordinary failure paths', () => {
  it('a 500 is still a generic error, not a lock', async () => {
    assistAnswers = [{ status: 500, payload: { error: 'model unavailable' } }]
    await driveRewrite()
    await waitFor(() => {
      expect(enqueueSnackbar).toHaveBeenCalledWith(
        'model unavailable',
        expect.objectContaining({ variant: 'error' }),
      )
    })
  })

  it('a 501 still reads as “not configured”, which is not a lock either', async () => {
    assistAnswers = [{ status: 501, payload: {} }]
    await driveRewrite()
    await waitFor(() => {
      expect(enqueueSnackbar).toHaveBeenCalledWith(
        'AI assist is not configured on this deployment',
        expect.objectContaining({ variant: 'info' }),
      )
    })
  })

  it('a 200 rewrite still lands on the node', async () => {
    // The negative control: without it, a provider that treated EVERY answer
    // as a lock would pass every assertion above.
    assistAnswers = [{ status: 200, payload: { text: 'Punchier copy' } }]
    await driveRewrite()
    await waitFor(() => {
      expect(canvasUpdateNodeProps).toHaveBeenCalled()
    })
    expect(canvasUpdateNodeProps.mock.calls[0][1]).toMatchObject({
      children: 'Punchier copy',
    })
  })
})
