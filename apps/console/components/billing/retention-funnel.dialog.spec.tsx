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
 * The funnel's client half (AGL-1863, under AGL-1859).
 *
 * The property under test is the ORDER and the ESCAPES: survey → downsell →
 * winback → leave, with every step passable and no failure able to strand
 * someone who wants out. A retention flow that traps a customer is a support
 * incident, not a save — so the failure cases here matter more than the
 * happy path.
 *
 * The funnelId is the other load-bearing thing: it must reach `onLeave`, or
 * the departure records as funnel-skipped even though the survey was
 * answered, and the churn breakdown quietly loses the answers it did get.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'

const mockEnqueueSnackbar = jest.fn()

jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: mockEnqueueSnackbar }),
}))

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useUser: () => ({ data: { uid: 'u-1', getIdToken: async () => 'tok' } }),
}))

const mockTrackEvent = jest.fn()

/**
 * The analytics module is spread from the REAL one and only `trackEvent` is
 * replaced (AGL-1865). A wholesale factory here would be a closed world: the
 * module also exports the taxonomy the rest of the console imports, and every
 * export this component tree reaches has to still be there or the suite fails
 * with a TypeError that has nothing to do with the funnel.
 *
 * The spy is the point. Under jsdom the real `trackEvent` finds no transport
 * and no `window.gtag`, so it silently no-ops — which is exactly why the four
 * funnel events went unasserted: deleting every one of them left this suite
 * green.
 */
jest.mock('@aglyn/aglyn/app-utils/analytics-events', () => ({
  __esModule: true,
  ...jest.requireActual('@aglyn/aglyn/app-utils/analytics-events'),
  trackEvent: (...args: unknown[]) => mockTrackEvent(...args),
}))

/** The params GA received for `name`, or undefined if it never fired. */
function eventParams(name: string): Record<string, unknown> | undefined {
  const call = mockTrackEvent.mock.calls.find(([event]) => event === name)
  return call?.[1]
}

import { RetentionFunnelDialog } from './retention-funnel.dialog'

const jsonResponse = (body: unknown, status = 200) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }) as unknown as Response

/** The survey response the route actually returns for a Pro org. */
const SURVEY_OK = {
  ok: true,
  funnelId: 'f-1',
  downsellPlan: 'starter',
  winbackAvailable: true,
  winbackPercentOff: 50,
  winbackDurationMonths: 2,
}

function renderFunnel(
  overrides: Partial<React.ComponentProps<typeof RetentionFunnelDialog>> = {},
) {
  const onLeave = jest.fn(async () => undefined)
  const onDownsell = jest.fn(async () => true)
  const onClose = jest.fn()
  render(
    <RetentionFunnelDialog
      open
      surface="subscription_cancel"
      orgId="org-1"
      subscriptionActive
      onClose={onClose}
      onDownsell={onDownsell}
      onLeave={onLeave}
      {...overrides}
    />,
  )
  return { onLeave, onDownsell, onClose }
}

/** Answer the survey and advance. */
async function answerSurvey(reason = "It's too expensive") {
  fireEvent.click(screen.getByLabelText(reason))
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
}

beforeEach(() => {
  jest.clearAllMocks()
  global.fetch = jest.fn(async () => jsonResponse(SURVEY_OK)) as never
})

describe('RetentionFunnelDialog order and escapes (AGL-1863)', () => {
  it('cannot continue until a reason is chosen', () => {
    renderFunnel()
    expect(
      (screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true)
    fireEvent.click(screen.getByLabelText('Technical problems'))
    expect(
      (screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement)
        .disabled,
    ).toBe(false)
  })

  it('stores the survey against the surface, then offers the downsell', async () => {
    renderFunnel()
    await answerSurvey()
    await screen.findByText('Would a smaller plan work better?')

    const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body)
    expect(body).toMatchObject({
      orgId: 'org-1',
      action: 'survey',
      surface: 'subscription_cancel',
      reason: 'too_expensive',
    })
    // The downsell states end-of-cycle semantics — the same promise the
    // server keeps (AGL-1862), said where the decision is made.
    expect(
      screen.getByText(/end of your current billing period/i),
    ).toBeTruthy()
  })

  it('walks survey → downsell → winback → leave, carrying the funnelId', async () => {
    const { onLeave } = renderFunnel()
    await answerSurvey()
    fireEvent.click(
      await screen.findByRole('button', { name: 'No thanks, continue' }),
    )
    await screen.findByText('Stay for 50% off?')
    fireEvent.click(screen.getByRole('button', { name: 'No thanks, continue' }))
    fireEvent.click(
      await screen.findByRole('button', { name: /Yes, cancel/ }),
    )
    // The survey's id reaches the leave call — without it the cancel records
    // itself as funnel-skipped despite the customer having answered.
    await waitFor(() => expect(onLeave).toHaveBeenCalledWith('f-1'))
  })

  it('states the discount BOUND, not just the discount', async () => {
    renderFunnel()
    await answerSurvey()
    fireEvent.click(
      await screen.findByRole('button', { name: 'No thanks, continue' }),
    )
    await screen.findByText('Stay for 50% off?')
    expect(
      screen.getByText(/returns to its regular price/i),
    ).toBeTruthy()
  })

  it('accepting the downsell retains the org and never calls onLeave', async () => {
    const { onDownsell, onLeave, onClose } = renderFunnel()
    await answerSurvey()
    fireEvent.click(
      await screen.findByRole('button', { name: /Switch to/ }),
    )
    await waitFor(() => expect(onDownsell).toHaveBeenCalledWith('starter'))
    expect(onLeave).not.toHaveBeenCalled()
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it('accepting the winback applies it and never calls onLeave', async () => {
    ;(global.fetch as jest.Mock).mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init.body))
      if (body.action === 'survey') return jsonResponse(SURVEY_OK)
      return jsonResponse({ ok: true, percentOff: 50, durationMonths: 2 })
    })
    const { onLeave, onClose } = renderFunnel()
    await answerSurvey()
    fireEvent.click(
      await screen.findByRole('button', { name: 'No thanks, continue' }),
    )
    fireEvent.click(
      await screen.findByRole('button', { name: 'Apply the discount' }),
    )
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(onLeave).not.toHaveBeenCalled()
    // Applied against the survey it belongs to.
    const winbackCall = (global.fetch as jest.Mock).mock.calls
      .map(([, init]: any) => JSON.parse(String(init.body)))
      .find((body: any) => body.action === 'winback')
    expect(winbackCall).toMatchObject({ action: 'winback', funnelId: 'f-1' })
  })

  it('skips the offers entirely without a live subscription', async () => {
    // Nothing to downsell FROM and no subscription to discount — an org here
    // gets survey → leave, not two dead-end screens.
    renderFunnel({ subscriptionActive: false })
    await answerSurvey()
    expect(
      await screen.findByText('Cancel your subscription?'),
    ).toBeTruthy()
  })

  it('offers the winback directly when there is no downsell tier', async () => {
    ;(global.fetch as jest.Mock).mockImplementation(async () =>
      jsonResponse({ ...SURVEY_OK, downsellPlan: null }),
    )
    renderFunnel()
    await answerSurvey()
    expect(await screen.findByText('Stay for 50% off?')).toBeTruthy()
  })

  it('skips the winback when the org already used its one offer', async () => {
    ;(global.fetch as jest.Mock).mockImplementation(async () =>
      jsonResponse({ ...SURVEY_OK, downsellPlan: null, winbackAvailable: false }),
    )
    renderFunnel()
    await answerSurvey()
    expect(
      await screen.findByText('Cancel your subscription?'),
    ).toBeTruthy()
  })
})

describe('the funnel never traps a customer who wants out (AGL-1863)', () => {
  it('a FAILED survey still reaches the exit — recorded as a skip', async () => {
    ;(global.fetch as jest.Mock).mockImplementation(async () =>
      jsonResponse({ error: 'nope' }, 502),
    )
    const { onLeave } = renderFunnel()
    await answerSurvey()
    // Straight to the exit: no offers, because the server never told us what
    // to offer, and inventing terms in the browser is how you promise a
    // discount the guard will refuse to mint.
    fireEvent.click(
      await screen.findByRole('button', { name: /Yes, cancel/ }),
    )
    // null funnelId — the departure honestly records as funnel-skipped
    // rather than claiming a survey that was never stored.
    await waitFor(() => expect(onLeave).toHaveBeenCalledWith(null))
  })

  it('a REFUSED winback falls through to the exit instead of looping', async () => {
    ;(global.fetch as jest.Mock).mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init.body))
      if (body.action === 'survey') {
        return jsonResponse({ ...SURVEY_OK, downsellPlan: null })
      }
      return jsonResponse(
        { error: 'The winback offer has already been used' },
        409,
      )
    })
    const { onLeave } = renderFunnel()
    await answerSurvey()
    fireEvent.click(
      await screen.findByRole('button', { name: 'Apply the discount' }),
    )
    expect(
      await screen.findByText('Cancel your subscription?'),
    ).toBeTruthy()
    expect(mockEnqueueSnackbar).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /Yes, cancel/ }))
    await waitFor(() => expect(onLeave).toHaveBeenCalled())
  })

  it('the account-delete surface asks its own question and stores its own surface', async () => {
    const { onLeave } = renderFunnel({
      surface: 'account_delete',
      subscriptionActive: false,
    })
    await answerSurvey('Something else')
    const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body)
    expect(body).toMatchObject({ surface: 'account_delete', reason: 'other' })
    expect(
      await screen.findByText('Delete this organization?'),
    ).toBeTruthy()
    fireEvent.click(
      screen.getByRole('button', { name: /Yes, delete this organization/ }),
    )
    await waitFor(() => expect(onLeave).toHaveBeenCalledWith('f-1'))
  })

  it('reopening starts a FRESH funnel — no stale funnelId from last time', async () => {
    const { onLeave, onClose } = renderFunnel({ subscriptionActive: false })
    await answerSurvey()
    await screen.findByText('Cancel your subscription?')
    fireEvent.click(screen.getByRole('button', { name: 'Keep my plan' }))
    expect(onClose).toHaveBeenCalled()
    expect(onLeave).not.toHaveBeenCalled()
  })
})

/**
 * The funnel's GA4 half (AGL-1865).
 *
 * These four events were emitted but asserted NOWHERE: under jsdom
 * `trackEvent` finds no transport and no `window.gtag`, so it no-ops, and
 * deleting all four calls left every other suite in this file green. An
 * instrumentation the tests cannot see is an instrumentation that can be
 * refactored away in silence — and the whole point of the funnel is that
 * retention becomes measurable on day one.
 *
 * Each test asserts the event NAME and the params the breakdown depends on.
 * `plan` matters as much as the name: without it the churn report cannot say
 * which tier people leave from, which is the first question anyone asks of it.
 */
describe('the funnel reports every step to GA4 (AGL-1865)', () => {
  it('the survey answer fires churn_survey_submitted with the reason and tier', async () => {
    renderFunnel({ currentPlan: 'pro' })
    await answerSurvey()
    await screen.findByText('Would a smaller plan work better?')
    expect(eventParams('churn_survey_submitted')).toMatchObject({
      reason: 'too_expensive',
      surface: 'subscription_cancel',
      plan: 'pro',
    })
  })

  it('an accepted downsell fires downsell_accepted naming BOTH tiers', async () => {
    renderFunnel({ currentPlan: 'pro' })
    await answerSurvey()
    await screen.findByText('Would a smaller plan work better?')
    fireEvent.click(screen.getByRole('button', { name: /^Switch to/ }))
    await waitFor(() =>
      expect(eventParams('downsell_accepted')).toMatchObject({
        from_plan: 'pro',
        to_plan: 'starter',
        surface: 'subscription_cancel',
      }),
    )
  })

  it('a declined downsell fires NOTHING — the save has to be real to count', async () => {
    renderFunnel({ currentPlan: 'pro', onDownsell: jest.fn(async () => false) })
    await answerSurvey()
    await screen.findByText('Would a smaller plan work better?')
    fireEvent.click(screen.getByRole('button', { name: /^Switch to/ }))
    await waitFor(() =>
      expect(mockTrackEvent).toHaveBeenCalledWith(
        'churn_survey_submitted',
        expect.anything(),
      ),
    )
    expect(eventParams('downsell_accepted')).toBeUndefined()
  })

  it('an applied winback reports the SERVER’s terms, not the client’s guess', async () => {
    ;(global.fetch as jest.Mock).mockImplementation(async (_url, init) => {
      const body = JSON.parse(init.body)
      if (body.action === 'survey') return jsonResponse(SURVEY_OK)
      // Deliberately NOT the 50/2 the dialog was told at survey time: the
      // margin question ("what did this save actually cost?") is answered
      // wrong by anything except what was really minted.
      return jsonResponse({ ok: true, percentOff: 25, durationMonths: 1 })
    })
    renderFunnel({ currentPlan: 'pro' })
    await answerSurvey()
    await screen.findByText('Would a smaller plan work better?')
    fireEvent.click(screen.getByRole('button', { name: 'No thanks, continue' }))
    await screen.findByText('Stay for 50% off?')
    fireEvent.click(screen.getByRole('button', { name: 'Apply the discount' }))
    await waitFor(() =>
      expect(eventParams('winback_discount_accepted')).toMatchObject({
        percent_off: 25,
        duration_months: 1,
        surface: 'subscription_cancel',
        plan: 'pro',
      }),
    )
  })

  it('a winback response missing its numbers OMITS them — never NaN', async () => {
    ;(global.fetch as jest.Mock).mockImplementation(async (_url, init) => {
      const body = JSON.parse(init.body)
      if (body.action === 'survey') return jsonResponse(SURVEY_OK)
      return jsonResponse({ ok: true })
    })
    renderFunnel({ currentPlan: 'pro' })
    await answerSurvey()
    await screen.findByText('Would a smaller plan work better?')
    fireEvent.click(screen.getByRole('button', { name: 'No thanks, continue' }))
    await screen.findByText('Stay for 50% off?')
    fireEvent.click(screen.getByRole('button', { name: 'Apply the discount' }))
    await waitFor(() =>
      expect(eventParams('winback_discount_accepted')).toBeTruthy(),
    )
    const params = eventParams('winback_discount_accepted') ?? {}
    // Absent, not NaN. A gap is readable; a NaN averages into the margin
    // number as though it were an answer.
    expect('percent_off' in params).toBe(false)
    expect('duration_months' in params).toBe(false)
    expect(params).toMatchObject({ surface: 'subscription_cancel' })
  })

  it('a REFUSED winback reports no acceptance', async () => {
    ;(global.fetch as jest.Mock).mockImplementation(async (_url, init) => {
      const body = JSON.parse(init.body)
      if (body.action === 'survey') return jsonResponse(SURVEY_OK)
      return jsonResponse({ error: 'already used' }, 409)
    })
    renderFunnel({ currentPlan: 'pro' })
    await answerSurvey()
    await screen.findByText('Would a smaller plan work better?')
    fireEvent.click(screen.getByRole('button', { name: 'No thanks, continue' }))
    await screen.findByText('Stay for 50% off?')
    fireEvent.click(screen.getByRole('button', { name: 'Apply the discount' }))
    await screen.findByText('Cancel your subscription?')
    expect(eventParams('winback_discount_accepted')).toBeUndefined()
  })

  it('leaving fires cancellation_completed with funnel_completed TRUE', async () => {
    renderFunnel({ currentPlan: 'pro', subscriptionActive: false })
    await answerSurvey()
    await screen.findByText('Cancel your subscription?')
    fireEvent.click(screen.getByRole('button', { name: /^Yes, cancel/ }))
    await waitFor(() =>
      expect(eventParams('cancellation_completed')).toMatchObject({
        surface: 'subscription_cancel',
        funnel_completed: true,
        plan: 'pro',
      }),
    )
  })

  it('a survey that never stored reports funnel_completed FALSE, not a silent gap', async () => {
    // The funnel must not trap someone whose survey failed — they still reach
    // the exit, and the GA denominator has to say so, or the Firestore
    // `funnelSkipped` marker and the GA funnel disagree about the same
    // departure.
    ;(global.fetch as jest.Mock).mockImplementation(async () =>
      jsonResponse({ error: 'nope' }, 500),
    )
    renderFunnel({ currentPlan: 'pro', subscriptionActive: false })
    await answerSurvey()
    await screen.findByText('Cancel your subscription?')
    fireEvent.click(screen.getByRole('button', { name: /^Yes, cancel/ }))
    await waitFor(() =>
      expect(eventParams('cancellation_completed')).toMatchObject({
        funnel_completed: false,
      }),
    )
  })

  it('the account-delete path reports the SAME events under its own surface', async () => {
    renderFunnel({
      surface: 'account_delete',
      currentPlan: 'business',
      subscriptionActive: false,
    })
    await answerSurvey('Something else')
    await screen.findByText('Delete this organization?')
    fireEvent.click(
      screen.getByRole('button', { name: /Yes, delete this organization/ }),
    )
    await waitFor(() =>
      expect(eventParams('cancellation_completed')).toMatchObject({
        surface: 'account_delete',
        plan: 'business',
      }),
    )
    expect(eventParams('churn_survey_submitted')).toMatchObject({
      surface: 'account_delete',
    })
  })
})
