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
import type { MobileApiClient, MobilePluginContext } from '@aglyn/mobile-plugin-host'
import type { Firestore } from 'firebase/firestore'

/*
 * What every Bookings query and action in the Aglyn app is handed (AGL-3621):
 * the signed-in Firestore under the console's own rules, the site being
 * looked at, the workspace it belongs to, and the console API client. Writes
 * the console makes through a route go through that route with the member's
 * ID token, so the phone has no path the browser does not.
 */
export interface BookingsMobileContext {
  firestore: Firestore
  hostId: string
  orgId: string | null
  api: MobileApiClient
  /** Clock, injectable for specs. */
  now?: () => number
}

export function bookingsContextOf(context: MobilePluginContext): BookingsMobileContext | null {
  if (!context.hostId || !context.firestore) return null
  return {
    firestore: context.firestore as Firestore,
    hostId: context.hostId,
    orgId: context.orgId,
    api: context.api,
  }
}

export const nowOf = (context: Pick<BookingsMobileContext, 'now'>): number =>
  context.now ? context.now() : Date.now()

/** A fresh key for one attempt at a write that moves money. */
export function newAttemptKey(prefix: string): string {
  const random =
    typeof globalThis.crypto?.randomUUID === 'function'
      ? globalThis.crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}${Math.random().toString(36).slice(2, 12)}`
  return `${prefix}:${random}`
}

/** A route's refusal as one line for an alert. */
export function errorText(error: unknown, fallback = 'That did not work. Try again.'): string {
  const message = (error as { message?: unknown } | null)?.message
  return typeof message === 'string' && message ? message : fallback
}
