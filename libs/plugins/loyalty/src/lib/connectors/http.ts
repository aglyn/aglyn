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

import { LoyaltyVendorError, type LoyaltyVendorFetch } from './types'

/**
 * One JSON call to a loyalty vendor (AGL-3677), with a deadline and the
 * vendor's answer sorted into what the caller does next. A vendor's error text
 * is kept short and never carries the request: the request held the secret.
 */

const TIMEOUT_MS = 10_000

export interface VendorCall {
  vendor: string
  method: 'GET' | 'POST'
  url: string
  headers: Record<string, string>
  body?: unknown
  /** Statuses that are an answer, not a failure: a 404 for "no such member". */
  accept?: number[]
  /** Statuses that mean "the balance cannot go that low". */
  insufficient?: number[]
}

export interface VendorAnswer {
  status: number
  body: any
}

function shortText(value: unknown): string {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160)
}

/** The vendor's own sentence for a refusal, from the shapes Smile.io and Yotpo answer with. */
function vendorMessage(body: any): string {
  if (!body || typeof body !== 'object') return shortText(body)
  return shortText(
    body.error?.message ??
      body.error ??
      body.message ??
      body.errors?.[0]?.message ??
      body.errors?.[0] ??
      '',
  )
}

export async function vendorJson(
  fetchImpl: LoyaltyVendorFetch,
  call: VendorCall,
): Promise<VendorAnswer> {
  let response: Response
  try {
    response = await fetchImpl(call.url, {
      method: call.method,
      headers: {
        Accept: 'application/json',
        ...(call.body !== undefined
          ? { 'Content-Type': 'application/json' }
          : {}),
        ...call.headers,
      },
      ...(call.body !== undefined ? { body: JSON.stringify(call.body) } : {}),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch {
    throw new LoyaltyVendorError(
      'transient',
      `${call.vendor} could not be reached.`,
    )
  }
  const text = await response.text().catch(() => '')
  let body: any = null
  if (text) {
    try {
      body = JSON.parse(text)
    } catch {
      body = text
    }
  }
  const status = response.status
  if ((status >= 200 && status < 300) || call.accept?.includes(status))
    return { status, body }
  const said = vendorMessage(body)
  if (status === 401 || status === 403) {
    throw new LoyaltyVendorError(
      'auth',
      `${call.vendor} refused the connection’s credentials${said ? `: ${said}` : '.'}`,
      status,
    )
  }
  if (call.insufficient?.includes(status)) {
    throw new LoyaltyVendorError(
      'insufficient',
      `${call.vendor} refused the change${said ? `: ${said}` : '.'}`,
      status,
    )
  }
  if (status === 408 || status === 423 || status === 429 || status >= 500) {
    throw new LoyaltyVendorError(
      'transient',
      `${call.vendor} is busy (${status}); it will be sent again.`,
      status,
    )
  }
  throw new LoyaltyVendorError(
    'refused',
    `${call.vendor} refused the request (${status})${said ? `: ${said}` : '.'}`,
    status,
  )
}

/** A whole number from a vendor field, or 0. */
export function vendorWhole(value: unknown): number {
  const number = Number(value)
  return Number.isFinite(number) ? Math.trunc(number) : 0
}
