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

import { useRouter } from 'next/navigation'
import { type FormEvent, useCallback } from 'react'

/**
 * The URL a `method="get"` form would load, or `null` when the submit should
 * be left to the browser: a POST, a `target` other than this window, or an
 * action on another origin, none of which the client router can stand in for.
 *
 * Built the way the browser builds it — the action's own query string is
 * REPLACED by the form's fields, not merged with them — so the soft
 * navigation lands on exactly the page a full load would have.
 */
export const softGetSubmitHref = (
  form: HTMLFormElement,
  submitter?: HTMLElement | null,
): string | null => {
  if ((form.getAttribute('method') ?? 'get').toLowerCase() !== 'get') {
    return null
  }
  const target = form.getAttribute('target')
  if (target && target !== '_self') return null
  const url = new URL(form.action, window.location.href)
  if (url.origin !== window.location.origin) return null
  const params = new URLSearchParams()
  for (const [name, value] of new FormData(form, submitter ?? null)) {
    if (typeof value === 'string') params.append(name, value)
  }
  const search = params.toString()
  return `${url.pathname}${search ? `?${search}` : ''}`
}

/**
 * An `onSubmit` for a plain GET form that navigates with the Next router
 * instead of reloading the document.
 *
 * The form keeps its `action` and `method`, so it still works before
 * hydration and with scripting off — this only takes over once React is
 * listening, the same progressive enhancement `AppLink` gives an `<a>`.
 */
export const useSoftGetSubmit = () => {
  const router = useRouter()
  return useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      if (event.defaultPrevented) return
      const submitter = (event.nativeEvent as SubmitEvent).submitter
      const href = softGetSubmitHref(event.currentTarget, submitter)
      if (!href) return
      event.preventDefault()
      router.push(href)
    },
    [router],
  )
}
