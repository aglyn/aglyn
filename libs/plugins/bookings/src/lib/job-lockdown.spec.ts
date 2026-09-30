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
 * THE TWO BOOKINGS BEATS HONOUR A LOCKDOWN (AGL-2495, from AGL-1621).
 *
 * `lockdown-tenant-api-coverage.spec.ts` proves each registration DECLARES a
 * scope and ASKS the gate. It reads text, so it cannot prove the answer
 * reaches the write three files away. This suite is the other half: it drives
 * each job with a gate that says LOCKED and asserts nothing was written and
 * nothing was sent, then lifts the lock on the SAME input and asserts the
 * work lands.
 *
 * SKIPPED, NOT DROPPED is the property that needs the second half. A job that
 * merely stopped writing under a lock would pass a one-sided suite while
 * quietly consuming the row — stamping it, deleting it, advancing past it —
 * and the loss would only be visible after the lift, which is exactly when
 * nobody is looking. `publish-schedule-job-lockdown.spec.ts` set that shape
 * for the core beat; this is it for the plugin ones.
 *
 * NO STRIPE. Neither of these jobs touches a payment API, and `global.fetch`
 * is asserted untouched below so that stays true — localhost carries the LIVE
 * secret key (`feedback_stripe_live_vs_test_mode`), so a suite near this code
 * proves the absence rather than assuming it.
 */

import { REMINDER_WINDOW_START_HOURS } from './model'

const NOW = 1_770_000_000_000
/** Inside the 23–25h reminder band, so the real predicate says "due". */
const STARTS_AT = NOW + (REMINDER_WINDOW_START_HOURS + 0.5) * 60 * 60 * 1000

/** Every mutation the doubles observe, as `verb path`. */
let writes: string[] = []
/** Every email the pass would have sent. */
let emails: string[] = []
/** Hosts the gate was asked about, in order. */
let asked: string[] = []
/** The set of hosts the gate answers LOCKED for. */
let lockedHosts = new Set<string>()

/** The job handlers, captured at import time from the registry call. */
const registered = new Map<string, (gate: unknown) => Promise<void>>()

const gate = { isLocked: async (hostId: string) => {
  asked.push(hostId)
  return lockedHosts.has(hostId)
} }

// ---------------------------------------------------------------------------
// Doubles
// ---------------------------------------------------------------------------

/** Console routes, captured when `registerBookingsConsoleApi` runs. */
const routes = new Map<string, (req: unknown, res: unknown) => Promise<unknown>>()

jest.mock('@aglyn/aglyn/server', () => ({
  registerPluginApiRoute: (
    path: string,
    handler: (req: unknown, res: unknown) => Promise<unknown>,
  ) => {
    routes.set(path, handler)
  },
  registerPluginConfigSchema: () => undefined,
  registerBillingWebhookHandler: () => undefined,
  registerPluginJob: (job: {
    name: string
    handler: (gate: unknown) => Promise<void>
  }) => {
    registered.set(job.name, job.handler)
  },
  // Core's registry gate. The manual door must NOT use it (AGL-3356): the
  // console registers no resolver, so this answers "not locked" there. A
  // double that says UNLOCKED for everything proves the door does not ask it.
  pluginJobHostGate: () => ({ isLocked: async () => false }),
  checkEntitlement: () => true,
  resolveBrandingProfile: () => ({ name: 'Acme', fromName: 'Acme' }),
  resolveTransactionFeeCents: () => 0,
}))

// This file is about the lockdown, so whatever owns the tax rule adds nothing.
jest.mock('@aglyn/aglyn/plugin-manager/plugin-tax-profile', () => ({
  pluginTaxProfile: () => ({
    flatTax: () => ({ taxCents: 0, label: '', pct: 0 }),
    taxModeOf: () => 'none',
  }),
}))

jest.mock('@aglyn/tenant-runtime', () => ({
  // Every server door captures through `captureHostContact` (AGL-2605), which
  // is `upsertHostContact` plus the contactCreated announcement. The stub
  // hands the call to whichever double this spec keeps for the writer — the
  // runtime mock's own, or the data-admin mock's when the spec doubles the
  // data layer instead — so assertions on its options read the same calls.
  captureHostContact: (...args: unknown[]) => {
    const runtime = jest.requireMock('@aglyn/tenant-runtime') as {
      upsertHostContact?: (...a: unknown[]) => unknown
    }
    const dataAdmin = jest.requireMock('@aglyn/tenant-data-admin') as {
      upsertHostContact?: (...a: unknown[]) => unknown
    }
    return (runtime.upsertHostContact ?? dataAdmin.upsertHostContact)?.(...args)
  },
  emitHostEvent: () => undefined,
}))

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => 'NOW', delete: () => 'DELETE' },
}))

// No template published: the batch loader answers nothing, as the stubbed
// `loadHostEmail` below always did (AGL-3370 moved the batch onto the leaf).
jest.mock('@aglyn/tenant-data-admin/server/host-email-tokens', () => ({
  loadHostEmailWithTokens: async () => null,
  renderLoadedHostEmailWithTokens: () => null,
}))

jest.mock('@aglyn/shared-util-email', () => ({
  // TRUE, deliberately. `isEmailConfigured()` false is the other way the
  // reminder beat sends nothing, and a suite that left it false would prove
  // the lock works by proving email was switched off.
  isEmailConfigured: () => true,
  loadHostEmail: async () => null,
  renderLoadedHostEmail: () => ({ subject: 's', text: 't' }),
  sendEmail: async (message: { to: string }) => {
    emails.push(message.to)
    return { sent: true }
  },
}))

/** `hosts/{hostId}/bookings/{id}` — enough of a snapshot for both passes. */
function bookingDoc(
  hostId: string,
  id: string,
  data: Record<string, unknown>,
) {
  const path = `hosts/${hostId}/bookings/${id}`
  return {
    id,
    data: () => data,
    get: (field: string) => (data as Record<string, unknown>)[field],
    ref: {
      path,
      parent: { parent: { id: hostId } },
      set: async (value: Record<string, unknown>) => {
        writes.push(`set ${path} ${JSON.stringify(value)}`)
        Object.assign(data, value)
      },
    },
  }
}

/** The rows each collection-group query answers with, set per test. */
let staleHolds: ReturnType<typeof bookingDoc>[] = []
let upcoming: ReturnType<typeof bookingDoc>[] = []

jest.mock('@aglyn/tenant-data-admin', () => ({
  /*
   * The site's own sending identity, which every tenant send now resolves.
   *
   * A VERIFIED one, because these specs are about the mail their subject
   * sends rather than about the identity boundary — a refusing stub would
   * turn each of them into an assertion that no mail was sent, which is not
   * what any of them was written to check. The boundary itself is proved in
   * `platform-sending-domain.spec.ts`, `host-sending-domain.spec.ts` and
   * `email-audience-coverage.spec.ts`.
   *
   * The domain is the SITE's, never `aglyn.com`, so an assertion on a From:
   * address in this file cannot accidentally pass against a platform
   * fallback.
   */
  hostSendingIdentity: async () => ({
    from: 'hello@site.mail.aglyn.app',
    source: 'custom',
    domain: 'site.mail.aglyn.app',
    summary: 'Sending as hello@site.mail.aglyn.app.',
    refusal: null,
  }),
  firebaseAdmin: {
    firestore: { FieldValue: { serverTimestamp: () => 'NOW' } },
    app: () => ({
      firestore: () => ({
        collectionGroup: () => {
          const chain: any = {
            where: (field: string) => {
              // The two passes are told apart by the field they filter on:
              // `expire-stale-holds` selects `status`, the reminder pass
              // selects `startsAtMs`.
              if (field === 'status') chain.__rows = staleHolds
              if (field === 'startsAtMs') chain.__rows = upcoming
              return chain
            },
            limit: () => chain,
            get: async () => ({
              size: (chain.__rows ?? []).length,
              docs: chain.__rows ?? [],
            }),
          }
          return chain
        },
      }),
    }),
  },
  getOrgForHost: async () => ({ org: { name: 'Acme' } }),
  resolveOrgIdForHost: async () => 'org-1',
  getPluginConfig: async () => ({}),
  meterHostEmail: async (hostId: string) => {
    writes.push(`meter ${hostId}`)
  },
  notifyHostManagers: async () => undefined,
  upsertHostContact: async () => undefined,
  renderHostEmailWithTokens: () => ({ subject: 's', text: 't' }),
}))

// The site-lockdown gate the console's manual door is handed (AGL-3356).
jest.mock('@aglyn/tenant-data-admin/server/tenant-write-lockdown', () => ({
  siteLockdownJobGate: () => gate,
}))

jest.mock('@aglyn/tenant-data-admin/server/payment-provider', () => ({
  merchantAccountIsReady: () => true,
}))

// `require`, not `import`. A static import is hoisted above the module-scope
// `const`s this file's doubles close over, so `server.ts` would run its
// registrations while `registered` was still in the temporal dead zone.
const { scanBookingReminders, registerBookingsConsoleApi } = require('./server') as {
  scanBookingReminders: (gate: {
    isLocked: (hostId: string) => Promise<boolean>
  }) => Promise<{ sent: number; skippedLocked: number }>
  registerBookingsConsoleApi: () => void
}
registerBookingsConsoleApi()

const realFetch = global.fetch

beforeEach(() => {
  writes = []
  emails = []
  asked = []
  lockedHosts = new Set()
  staleHolds = []
  upcoming = []
})

describe('AGL-2495 · bookings#expire-stale-holds honours a lockdown', () => {
  const runJob = async () => {
    const handler = registered.get('expire-stale-holds')
    expect(handler).toBeDefined()
    await handler?.(gate)
  }

  it('CONTROL — an unlocked host has its lapsed hold canceled', async () => {
    staleHolds = [bookingDoc('healthy', 'b1', { status: 'pendingPayment' })]
    await runJob()
    expect(asked).toEqual(['healthy'])
    expect(writes).toEqual([
      'set hosts/healthy/bookings/b1 {"status":"canceled"}',
    ])
  })

  it('a locked host has NOTHING written', async () => {
    staleHolds = [bookingDoc('locked', 'b1', { status: 'pendingPayment' })]
    lockedHosts.add('locked')
    await runJob()
    expect(asked).toEqual(['locked'])
    expect(writes).toEqual([])
  })

  it('SKIPPED, NOT DROPPED — the hold lapses after the lift', async () => {
    // The SAME document object across both beats: nothing in the locked pass
    // may have retired it, or the second pass would find a row it can no
    // longer act on. That is the property a one-sided suite cannot see.
    const hold = bookingDoc('locked', 'b1', { status: 'pendingPayment' })
    staleHolds = [hold]
    lockedHosts.add('locked')
    await runJob()
    expect(writes).toEqual([])
    expect(hold.data()).toEqual({ status: 'pendingPayment' })

    lockedHosts.delete('locked')
    await runJob()
    expect(writes).toEqual([
      'set hosts/locked/bookings/b1 {"status":"canceled"}',
    ])
  })

  it('one locked host does not freeze the beat for a healthy one', async () => {
    staleHolds = [
      bookingDoc('locked', 'b1', { status: 'pendingPayment' }),
      bookingDoc('healthy', 'b2', { status: 'pendingPayment' }),
    ]
    lockedHosts.add('locked')
    await runJob()
    expect(asked).toEqual(['locked', 'healthy'])
    expect(writes).toEqual([
      'set hosts/healthy/bookings/b2 {"status":"canceled"}',
    ])
  })
})

describe('AGL-2495 · bookings#booking-reminders honours a lockdown', () => {
  const booking = (hostId: string) =>
    bookingDoc(hostId, 'b1', {
      status: 'confirmed',
      email: 'guest@example.com',
      name: 'Guest',
      serviceName: 'Massage',
      startsAtMs: STARTS_AT,
    })

  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(NOW)
  })
  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('CONTROL — an unlocked host gets its reminder, metered and stamped', async () => {
    upcoming = [booking('healthy')]
    const result = await scanBookingReminders(gate)
    expect(emails).toEqual(['guest@example.com'])
    expect(result.sent).toBe(1)
    expect(writes).toContain('meter healthy')
  })

  it('a locked host is not emailed, not metered and not stamped', async () => {
    upcoming = [booking('locked')]
    lockedHosts.add('locked')
    const result = await scanBookingReminders(gate)
    expect(emails).toEqual([])
    expect(writes).toEqual([])
    expect(result.sent).toBe(0)
    // Counted as its own thing, not folded into the "not due" tally — a
    // suspended merchant's silence must not read as a quiet hour.
    expect(result.skippedLocked).toBe(1)
  })

  it('SKIPPED, NOT DROPPED — the booking is unstamped and mails after the lift', async () => {
    const row = booking('locked')
    upcoming = [row]
    lockedHosts.add('locked')
    await scanBookingReminders(gate)
    // `reminderSentAt` is what retires a booking from this pass. Its absence
    // is the whole of "not dropped".
    expect(row.data()['reminderSentAt']).toBeUndefined()

    lockedHosts.delete('locked')
    const after = await scanBookingReminders(gate)
    expect(after.sent).toBe(1)
    expect(emails).toEqual(['guest@example.com'])
  })
})

/*
 * THE CONSOLE'S MANUAL DOOR (AGL-3356). `POST bookings/reminders` with the
 * cron secret drives the same scan by hand, served by the console — where
 * core's job registry has no resolver and answered "not locked" for every
 * site. The door now takes the site-lockdown gate directly.
 */
describe('AGL-3356 · the manual bookings/reminders door honours a lockdown', () => {
  const callDoor = async () => {
    const captured: { status: number; body: any } = { status: 0, body: null }
    const res: any = {
      status: (code: number) => {
        captured.status = code
        return res
      },
      json: (body: unknown) => {
        captured.body = body
        return res
      },
    }
    await routes.get('bookings/reminders')?.(
      { method: 'POST', headers: { 'x-cron-secret': 'cron' } },
      res,
    )
    return captured
  }
  const previous = process.env['CRON_SECRET']
  beforeEach(() => {
    process.env['CRON_SECRET'] = 'cron'
    jest.spyOn(Date, 'now').mockReturnValue(NOW)
  })
  afterEach(() => {
    if (previous === undefined) delete process.env['CRON_SECRET']
    else process.env['CRON_SECRET'] = previous
    jest.restoreAllMocks()
  })

  it('skips a locked site, leaves the row unstamped, and sends after the lift', async () => {
    const row = bookingDoc('locked', 'b1', {
      status: 'confirmed',
      email: 'guest@example.com',
      name: 'Guest',
      serviceName: 'Massage',
      startsAtMs: STARTS_AT,
    })
    upcoming = [row]
    lockedHosts.add('locked')
    const locked = await callDoor()
    expect(locked.status).toBe(200)
    expect(locked.body).toMatchObject({ sent: 0, skippedLocked: 1 })
    expect(asked).toEqual(['locked'])
    expect(emails).toEqual([])
    expect(row.data()['reminderSentAt']).toBeUndefined()

    lockedHosts.delete('locked')
    expect((await callDoor()).body).toMatchObject({ sent: 1 })
    expect(emails).toEqual(['guest@example.com'])
  })
})

describe('AGL-2495 · neither bookings beat touches a payment API', () => {
  it('global.fetch is the untouched original', () => {
    // Guarding the guard: this suite replaces no network, so if either job
    // ever grew a Stripe call the run would leave the sandbox. Asserted
    // rather than assumed, because localhost carries the LIVE key.
    expect(global.fetch).toBe(realFetch)
  })
})
