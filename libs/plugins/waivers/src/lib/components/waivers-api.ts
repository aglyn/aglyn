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

'use client'

import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import { useUser } from '@aglyn/tenant-feature-instance'
import { useCallback } from 'react'
import { WAIVERS_API_ROUTES, WAIVERS_PUBLIC_PAGE_PATH, WAIVERS_SITE_SIGN_PATH } from '../constants/bundle-common'

/**
 * The console half's one way to the routes (AGL-4042): the member's own
 * token, JSON both ways, and the route's sentence thrown on a refusal so a
 * card can show it as is. Files (the PDF, a CSV, an image) come back as a
 * Blob.
 */

export type WaiversRoute = (typeof WAIVERS_API_ROUTES)[keyof typeof WAIVERS_API_ROUTES]

export interface WaiversRequestOptions {
  query?: Record<string, string | undefined>
  body?: unknown
}

const queryString = (query?: Record<string, string | undefined>) => {
  const entries = Object.entries(query ?? {}).filter((entry): entry is [string, string] => Boolean(entry[1]))
  return entries.length ? `?${new URLSearchParams(entries).toString()}` : ''
}

/** A refusal with the route's own words and, where it gave one, its code. */
export class WaiversRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message)
  }
}

export function useWaiversFetch() {
  const { data: user } = useUser()
  const send = useCallback(
    async (route: WaiversRoute, options: WaiversRequestOptions = {}): Promise<Response> => {
      const post = options.body !== undefined
      const response = await authorizedFetch(user as never, `/api/${route}${queryString(options.query)}`, {
        method: post ? 'POST' : 'GET',
        headers: post ? { 'Content-Type': 'application/json' } : {},
        ...(post ? { body: JSON.stringify(options.body) } : {}),
      })
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string; code?: string }
        throw new WaiversRequestError(payload?.error ?? 'Something went wrong. Try again.', response.status, payload?.code)
      }
      return response
    },
    [user],
  )
  const request = useCallback(
    async <T,>(route: WaiversRoute, options: WaiversRequestOptions = {}): Promise<T> =>
      (await (await send(route, options)).json()) as T,
    [send],
  )
  const download = useCallback(
    async (route: WaiversRoute, options: WaiversRequestOptions = {}): Promise<Blob> => (await send(route, options)).blob(),
    [send],
  )
  return { ready: Boolean(user), request, download }
}

/** A signer's request: no account, JSON both ways. */
export async function publicWaiversRequest<T>(route: WaiversRoute, options: WaiversRequestOptions = {}): Promise<T> {
  const post = options.body !== undefined
  const response = await fetch(`/api/${route}${queryString(options.query)}`, {
    method: post ? 'POST' : 'GET',
    headers: post ? { 'Content-Type': 'application/json' } : {},
    ...(post ? { body: JSON.stringify(options.body) } : {}),
  })
  const payload = (await response.json().catch(() => ({}))) as T & { error?: string; code?: string }
  if (!response.ok) {
    throw new WaiversRequestError(payload?.error ?? 'Something went wrong. Try again.', response.status, payload?.code)
  }
  return payload
}

/** A fresh key for one signing: a retried press is the same signature. */
export function newWaiverAttemptKey(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`
}

/** Saves a Blob the browser was handed, under a name. */
export function saveBlob(blob: Blob, filename: string): void {
  const href = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = href
  link.download = filename
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(href), 1000)
}

/**
 * The share link a signer opens: the store's own signing page for one waiver,
 * on the store's site (`signPageOrigin`, which the templates route answers).
 * A site with no public address keeps the console's public signing page,
 * under `consoleOrigin`.
 */
export function waiverShareLink(
  signPageOrigin: string | null,
  consoleOrigin: string,
  hostId: string,
  waiverId: string,
): string {
  if (signPageOrigin) {
    const params = new URLSearchParams({ waiver: waiverId })
    return `${signPageOrigin.replace(/\/+$/, '')}/${WAIVERS_SITE_SIGN_PATH}?${params.toString()}`
  }
  const params = new URLSearchParams({ host: hostId, waiver: waiverId })
  return `${consoleOrigin.replace(/\/+$/, '')}/kiosk/waivers${WAIVERS_PUBLIC_PAGE_PATH}?${params.toString()}`
}
