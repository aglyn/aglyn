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
 * Which screen a host wants shown when a path matches nothing (AGL-2342).
 *
 * Three sources, in precedence order, and the third is the one that makes this
 * work for the sites that exist today:
 *
 *  1. `errorScreens.notFound` — the Error pages card's binding (AGL-131). The
 *     explicit answer, and the only one an author can see and change.
 *  2. `notFoundScreenId` — the pre-AGL-131 field, still set on older hosts.
 *  3. **The routing map's `404` entry.** Measured on production 2026-08-19,
 *     `errorScreens` was unset on every host, and yet `aglyn.com` publishes a
 *     screen named *"Not found (404)"* at the path `404` — which is, per
 *     `get-screen.ts`, "exactly how every error screen on the platform exists
 *     today". Reading the map means designing a 404 screen the obvious way
 *     (publish it at `/404`) is enough; binding it in the console is an
 *     upgrade, not a prerequisite.
 *
 * The map is consulted LAST so that binding a slot always wins over an
 * accident of pathing, and a host that has bound one screen and published a
 * different one at `/404` gets the one it asked for.
 *
 * Note what source 3 does NOT buy: `/404` itself is a reserved Next.js output
 * (`x-matched-path: /404`, served from the build's own `404.html`), so that URL
 * stays the framework's. What is fixed is every OTHER unmatched path, which is
 * the URL a visitor actually mistypes.
 *
 * Pure and dependency-free on purpose (AGL-2648): it has two readers with very
 * different module graphs — the page loader, which composes the screen's body,
 * and the not-found boundary's `generateMetadata`, which needs only the id to
 * read a title — and the second must not have to import the first to ask a
 * question about a host record.
 */
export function resolveNotFoundScreenId(host: unknown): string | undefined {
  const record = host as {
    errorScreens?: { notFound?: string }
    notFoundScreenId?: string
    screens?: Record<string, string>
  } | null
  if (!record) return undefined
  const bound = record.errorScreens?.notFound ?? record.notFoundScreenId
  if (bound) return bound
  const routed = Object.entries(record.screens ?? {}).find(
    ([, path]) => path === '404',
  )
  return routed?.[0]
}
