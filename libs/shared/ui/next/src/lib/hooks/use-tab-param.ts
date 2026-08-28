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

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'

/**
 * `?tab=` ↔ the selected vertical tab, in one place (AGL-2486, AGL-693).
 *
 * Every surface with vertical tabs deep-links the same way, and it is this
 * hook that makes that true. Left to themselves, three pages produce three
 * different answers and one of them is wrong: validating the incoming id
 * against a HAND-MAINTAINED LIST silently opens the default tab for any id
 * added later; validating against two hardcoded ids is correct only until a
 * third arrives; and reading `window.location.search` once on mount ignores
 * every later navigation.
 *
 * ## Why this lives in the library rather than in the console
 *
 * The console is not the only surface with a vertical tab rail. `HubTabs` —
 * the rail itself — is shared, and every relocated feature plugin's console
 * page renders through it. A library cannot import from an app, so a hook
 * that lived in `apps/console/hooks` was one the rail could not use, and the
 * rail therefore grew the fourth answer: it read the parameter once into
 * `useState` and never looked again, so back, forward and an in-app link into
 * another section of an open page all left the rail on the old tab while the
 * URL said otherwise. Moving the hook here is what makes "one reader" true of
 * the component that most needs it.
 *
 * ## The list is the CALLER'S, and it is the real one
 *
 * `ids` is the tabs that exist right now, which is what makes an unknown id
 * fall back instead of selecting a panel nothing renders. Manage Account is
 * why that matters beyond typos: its Security section is absent for an
 * SSO-governed account with no password, so `?tab=security` is a valid id on
 * one account and a blank page on another.
 *
 * ## It keeps following the param
 *
 * Not just on mount. Back and forward are navigations between two states of
 * the same page, and a docs link or an in-app link can change the param under
 * a mounted page — read once, either leaves the old tab selected while the URL
 * says otherwise.
 *
 * This cannot fight the reader's own clicks: a click writes the param, so the
 * param and the state already agree by the time the effect looks.
 */
export interface UseTabParamOptions {
  /** The tabs that exist, in order. The first is the default. */
  ids: readonly string[]
  /** Query key. `tab` everywhere today. */
  param?: string
  /** Selected when the param is absent or names no tab. Defaults to `ids[0]`. */
  fallback?: string
  /** Ran after a change — the pages log a `screen_view` here. */
  onChange?: (id: string) => void
}

export interface UseTabParamResult {
  tab: string
  /** Drop-in for MUI `TabList`'s `onChange`. */
  onTabChange: (event: unknown, value: string) => void
}

export function useTabParam(options: UseTabParamOptions): UseTabParamResult {
  const { ids, param = 'tab', fallback, onChange } = options
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const requested = searchParams?.get(param) ?? null
  // `''` and not `undefined` on an empty list: MUI's `TabContext` takes the
  // selected id as its context value, and `undefined` there renders a rail
  // with no selection and warns on every render. A hub whose tabs are built
  // from entitlements can legitimately have none for one render.
  const fallbackId = fallback ?? ids[0] ?? ''
  /*
    `ids.includes` and not a Set: these lists are single digits, the array is
    rebuilt every render by callers that derive it, and a Set built per render
    to search five strings costs more than the search.
  */
  const resolved = requested && ids.includes(requested) ? requested : fallbackId
  const [tab, setTab] = useState(resolved)

  // Follow the param when it changes — back/forward, or a link into another
  // section of a page already open. `resolved` is already validated, so an id
  // that has gone away (a section that stopped rendering) lands on the
  // fallback rather than on nothing.
  useEffect(() => {
    setTab((current) => (current === resolved ? current : resolved))
  }, [resolved])


  const onTabChange = useCallback(
    (_event: unknown, value: string) => {
      setTab(value)
      // Shallow replace, no scroll: the section deep-links and survives
      // back/forward without the page jumping to the top on every tab click.
      const next = new URLSearchParams(searchParams?.toString())
      next.set(param, value)
      router.replace(`${pathname}?${next.toString()}`, { scroll: false })
      onChange?.(value)
    },
    [router, pathname, searchParams, param, onChange],
  )

  return { tab, onTabChange }
}

export default useTabParam
