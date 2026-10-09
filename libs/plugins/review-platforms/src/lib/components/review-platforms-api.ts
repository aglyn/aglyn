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
import { REVIEW_PLATFORMS_API_ROUTES } from '../constants/api-routes'

/**
 * The console half's one way to the routes (AGL-3699): the member's own
 * token, JSON both ways, and the route's sentence thrown on a refusal so a
 * card can show it as is.
 */

export type ReviewPlatformsRoute = (typeof REVIEW_PLATFORMS_API_ROUTES)[keyof typeof REVIEW_PLATFORMS_API_ROUTES]

export function useReviewPlatformsFetch() {
  const { data: user } = useUser()
  return useCallback(
    async <T,>(route: ReviewPlatformsRoute, options: { query?: Record<string, string>; body?: unknown } = {}): Promise<T> => {
      const query = options.query ? `?${new URLSearchParams(options.query).toString()}` : ''
      const response = await authorizedFetch(user, `/api/${route}${query}`, {
        method: options.body === undefined ? 'GET' : 'POST',
        headers: options.body === undefined ? {} : { 'Content-Type': 'application/json' },
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      })
      const payload = (await response.json().catch(() => ({}))) as T & { error?: string }
      if (!response.ok) throw new Error(payload?.error ?? 'Something went wrong. Try again.')
      return payload
    },
    [user],
  )
}
