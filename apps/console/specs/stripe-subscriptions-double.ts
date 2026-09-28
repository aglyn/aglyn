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
 * A stateful stand-in for the handful of Stripe subscription endpoints the
 * staff cancellation uses (AGL-3359), installed as `globalThis.fetch`.
 *
 * STATEFUL on purpose. The cancellation answers with a read-back, and a stub
 * that returned canned bodies would make every read-back agree with whatever
 * the test expected — a double that cannot disagree cannot catch a write
 * that never landed. Here a DELETE really moves the subscription to
 * `canceled`, a failed write really leaves it live, and the read-back reports
 * what the store holds.
 *
 * No request ever leaves the process: localhost runs against the LIVE Stripe
 * key in this repo, so every spec that reaches this code must install this
 * double first.
 */

export interface FakeSubscription {
  id: string
  customer: string
  status: string
  created: number
  cancel_at_period_end?: boolean
  cancel_at?: number | null
  canceled_at?: number | null
  current_period_end?: number
  schedule?: string | null
  metadata?: Record<string, string>
  cancellation_details?: { comment?: string | null }
  /** Stripe's collection pause (AGL-3364); null or absent when collecting. */
  pause_collection?: { behavior: string } | null
  items?: { data: Array<{ price: { id: string; recurring?: { interval: string } } }> }
}

export interface StripeCall {
  method: string
  path: string
  /** Query string for GET/DELETE, form body for POST, decoded. */
  params: Record<string, string>
}

/** A connected account, as far as the payout pause reads it (AGL-3364). */
export interface FakeAccount {
  id: string
  type: 'express' | 'custom' | 'standard'
  settings: {
    payouts: {
      schedule: {
        interval: string
        delay_days?: number
        weekly_anchor?: string
        monthly_anchor?: number
      }
    }
  }
}

export interface StripeDouble {
  subscriptions: Map<string, FakeSubscription>
  accounts: Map<string, FakeAccount>
  calls: StripeCall[]
  /** Make every DELETE/POST answer 500 and change nothing. */
  failWrites: boolean
  /** Make the metadata search answer 400, as it does in some regions. */
  failSearch: boolean
  /** Calls that would have changed something in Stripe. */
  writes(): StripeCall[]
}

const PERIOD_END = 1_900_000_000

export function subscription(
  overrides: Partial<FakeSubscription> & { id: string },
): FakeSubscription {
  return {
    customer: 'cus_org1',
    status: 'active',
    created: 1_800_000_000,
    cancel_at_period_end: false,
    cancel_at: null,
    canceled_at: null,
    current_period_end: PERIOD_END,
    schedule: null,
    metadata: { orgId: 'org1' },
    items: {
      data: [{ price: { id: 'price_pro_month', recurring: { interval: 'month' } } }],
    },
    ...overrides,
  }
}

const reply = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
})

export function installStripeDouble(
  seed: FakeSubscription[] = [],
  accounts: FakeAccount[] = [],
): StripeDouble {
  const double: StripeDouble = {
    subscriptions: new Map(seed.map((entry) => [entry.id, { ...entry }])),
    accounts: new Map(
      accounts.map((entry) => [entry.id, JSON.parse(JSON.stringify(entry))]),
    ),
    calls: [],
    failWrites: false,
    failSearch: false,
    writes() {
      return this.calls.filter((call) => call.method !== 'GET')
    },
  }
  ;(globalThis as any).fetch = jest.fn(async (url: string, init: any = {}) => {
    const parsed = new URL(String(url))
    if (parsed.hostname !== 'api.stripe.com') {
      throw new Error(`unexpected fetch to ${parsed.hostname}`)
    }
    const method = String(init.method ?? 'GET')
    const path = parsed.pathname.replace(/^\/v1\//, '')
    const params = Object.fromEntries(
      (method === 'POST'
        ? new URLSearchParams(String(init.body ?? ''))
        : parsed.searchParams
      ).entries(),
    )
    double.calls.push({ method, path, params })

    if (method === 'GET' && path === 'subscriptions') {
      const data = [...double.subscriptions.values()].filter(
        (entry) => entry.customer === params['customer'],
      )
      return reply(200, { object: 'list', data, has_more: false })
    }
    if (method === 'GET' && path === 'subscriptions/search') {
      if (double.failSearch) {
        return reply(400, { error: { message: 'Search is not available' } })
      }
      const match = /metadata\['orgId'\]:'([^']*)'/.exec(params['query'] ?? '')
      const data = [...double.subscriptions.values()].filter(
        (entry) => match && entry.metadata?.['orgId'] === match[1],
      )
      return reply(200, { object: 'search_result', data, has_more: false })
    }
    const account = /^accounts\/([^/]+)$/.exec(path)
    if (account) {
      const found = double.accounts.get(decodeURIComponent(account[1]))
      if (!found) return reply(404, { error: { message: 'No such account' } })
      if (method === 'GET') return reply(200, JSON.parse(JSON.stringify(found)))
      if (double.failWrites) {
        return reply(500, { error: { message: 'Stripe is having a moment' } })
      }
      // A Standard account's payouts are its own; Stripe refuses the write.
      if (found.type === 'standard') {
        return reply(400, {
          error: { message: 'You cannot update payout settings of a Standard account' },
        })
      }
      const schedule = found.settings.payouts.schedule
      const key = (name: string) => `settings[payouts][schedule][${name}]`
      if (params[key('interval')]) {
        found.settings.payouts.schedule = { interval: params[key('interval')] }
        if (schedule.delay_days !== undefined && !params[key('delay_days')]) {
          found.settings.payouts.schedule.delay_days = schedule.delay_days
        }
      }
      if (params[key('delay_days')]) {
        found.settings.payouts.schedule.delay_days = Number(params[key('delay_days')])
      }
      if (params[key('weekly_anchor')]) {
        found.settings.payouts.schedule.weekly_anchor = params[key('weekly_anchor')]
      }
      if (params[key('monthly_anchor')]) {
        found.settings.payouts.schedule.monthly_anchor = Number(params[key('monthly_anchor')])
      }
      return reply(200, JSON.parse(JSON.stringify(found)))
    }
    const scheduleRelease = /^subscription_schedules\/([^/]+)\/release$/.exec(path)
    if (scheduleRelease && method === 'POST') {
      if (double.failWrites) return reply(500, { error: { message: 'boom' } })
      for (const entry of double.subscriptions.values()) {
        if (entry.schedule === scheduleRelease[1]) entry.schedule = null
      }
      return reply(200, { id: scheduleRelease[1], status: 'released' })
    }
    const one = /^subscriptions\/([^/]+)$/.exec(path)
    const entry = one ? double.subscriptions.get(decodeURIComponent(one[1])) : null
    if (!one || !entry) {
      return reply(404, { error: { message: 'No such subscription' } })
    }
    if (method === 'GET') return reply(200, { ...entry })
    if (double.failWrites) {
      return reply(500, { error: { message: 'Stripe is having a moment' } })
    }
    if (method === 'DELETE') {
      entry.status = 'canceled'
      entry.canceled_at = 1_850_000_000
      entry.cancellation_details = {
        comment: params['cancellation_details[comment]'] ?? null,
      }
      return reply(200, { ...entry })
    }
    if (method === 'POST') {
      if (entry.schedule) {
        return reply(400, {
          error: { message: 'The subscription is managed by a schedule' },
        })
      }
      if (params['cancel_at_period_end'] === 'true') {
        entry.cancel_at_period_end = true
        entry.cancel_at = entry.current_period_end ?? null
      }
      if (params['pause_collection[behavior]']) {
        entry.pause_collection = { behavior: params['pause_collection[behavior]'] }
      } else if ('pause_collection' in params && params['pause_collection'] === '') {
        entry.pause_collection = null
      }
      if (params['cancellation_details[comment]']) {
        entry.cancellation_details = {
          comment: params['cancellation_details[comment]'],
        }
      }
      return reply(200, { ...entry })
    }
    return reply(405, { error: { message: 'Unsupported' } })
  })
  return double
}
