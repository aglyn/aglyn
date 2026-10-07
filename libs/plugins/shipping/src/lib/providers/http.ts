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

import { ShippingProviderError, type ShippingProviderId } from './types'

/** The longest any one provider call may take before it is abandoned. */
export const PROVIDER_REQUEST_TIMEOUT_MS = 25_000

/** The `fetch` an adapter calls, injectable so a spec can answer it. */
export type ProviderFetch = typeof fetch

export interface ProviderRequest {
  providerId: ShippingProviderId
  fetchImpl: ProviderFetch
  url: string
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
  headers: Record<string, string>
  body?: unknown
  signal?: AbortSignal
}

/**
 * One JSON request to a provider: a timeout of its own on top of the
 * caller's signal, and every failure turned into a
 * {@link ShippingProviderError} carrying the provider's words where it gave
 * any. Never logs a header: they carry the platform's credential.
 */
export async function providerJson<T>(request: ProviderRequest): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), PROVIDER_REQUEST_TIMEOUT_MS)
  const onAbort = () => controller.abort()
  request.signal?.addEventListener('abort', onAbort)
  try {
    let response: Response
    try {
      response = await request.fetchImpl(request.url, {
        method: request.method ?? 'GET',
        headers: {
          Accept: 'application/json',
          ...(request.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...request.headers,
        },
        ...(request.body !== undefined ? { body: JSON.stringify(request.body) } : {}),
        signal: controller.signal,
      })
    } catch (error) {
      throw new ShippingProviderError(
        controller.signal.aborted
          ? `${request.providerId} did not answer in time`
          : `${request.providerId} could not be reached`,
        0,
        request.providerId,
      )
    }
    const text = await response.text()
    let parsed: unknown = undefined
    try {
      parsed = text ? JSON.parse(text) : undefined
    } catch {
      parsed = undefined
    }
    if (!response.ok) {
      throw new ShippingProviderError(
        `${request.providerId} refused the request (${response.status})`,
        response.status,
        request.providerId,
        providerErrorDetail(parsed),
      )
    }
    return parsed as T
  } finally {
    clearTimeout(timer)
    request.signal?.removeEventListener('abort', onAbort)
  }
}

/** The human part of a provider's error body, bounded. */
export function providerErrorDetail(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') return undefined
  const record = body as Record<string, unknown>
  const candidates: unknown[] = [
    (record['error'] as Record<string, unknown> | undefined)?.['message'],
    record['detail'],
    record['message'],
    Array.isArray(record['messages'])
      ? (record['messages'] as Array<{ text?: unknown }>).map((one) => one?.text).join(' ')
      : undefined,
    record['__all__'],
  ]
  for (const candidate of candidates) {
    const text = Array.isArray(candidate) ? candidate.join(' ') : candidate
    if (typeof text === 'string' && text.trim()) return text.trim().slice(0, 300)
  }
  return undefined
}

/** A decimal string or number of currency units, as integer cents. */
export function decimalToCents(value: unknown): number {
  const amount = Number(value)
  return Number.isFinite(amount) ? Math.round(amount * 100) : 0
}

/** Integer cents as the decimal string a provider expects. */
export function centsToDecimal(cents: number): string {
  return (Math.max(0, Math.round(cents)) / 100).toFixed(2)
}

/** Grams to ounces, to two places. */
export function gramsToOunces(grams: number): number {
  return Math.max(0.1, Math.round((grams / 28.349523125) * 100) / 100)
}

/** Centimetres to inches, to two places. */
export function cmToInches(cm: number): number {
  return Math.round((cm / 2.54) * 100) / 100
}
