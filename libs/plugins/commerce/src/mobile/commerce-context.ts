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

import type { MobilePluginContext } from '@aglyn/mobile-plugin-host'
import type { Firestore } from 'firebase/firestore'
import { useMemo } from 'react'
import type { CommerceMobileContext, MobileApiRequest } from './data/context'

/*
 * The app shell's plugin context as the commerce data layer takes it
 * (AGL-3621). The shell's client is handed full console paths and carries
 * the member's ID token, the retry policy and the `Idempotency-Key` header;
 * the data layer names routes below `/api/`.
 */

export function commerceContextOf(context: MobilePluginContext): CommerceMobileContext | null {
  if (!context.hostId) return null
  return {
    firestore: context.firestore as Firestore,
    hostId: context.hostId,
    api: {
      request: <T>(path: string, init: MobileApiRequest) =>
        context.api.request<T>(`/api/${path.replace(/^\/+/, '')}`, {
          method: init.method,
          ...(init.query ? { query: { ...init.query } } : {}),
          ...(init.body !== undefined ? { body: init.body } : {}),
          ...(init.idempotencyKey ? { idempotencyKey: init.idempotencyKey } : {}),
        }),
    },
  }
}

/** The data layer's context for this screen, stable while the site is. */
export function useCommerceContext(context: MobilePluginContext): CommerceMobileContext | null {
  return useMemo(
    () => commerceContextOf(context),
    // The shell rebuilds `context` when the pick changes; these are what the data layer reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [context.firestore, context.hostId, context.api],
  )
}

/** A route's refusal as one line for an alert. */
export function errorText(error: unknown, fallback = 'That did not work. Try again.'): string {
  const message = (error as { message?: unknown } | null)?.message
  return typeof message === 'string' && message ? message : fallback
}
