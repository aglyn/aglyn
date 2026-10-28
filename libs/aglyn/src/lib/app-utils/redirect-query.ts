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
 * A site redirect keeps the visitor's query string.
 *
 * A short link printed on a sign, `example.com/booth`, redirects to a long
 * destination that carries its own parameters
 * (`/signup?utm_source=event&utm_medium=qr`). Before this, a visitor who
 * arrived with parameters of their own — `example.com/booth?ref=flyer` — lost
 * them at the redirect, because the destination replaced the whole URL.
 *
 * The rule's own parameters WIN. They are what the owner set on purpose, and
 * the printed link never carries any: a parameter the visitor brings with the
 * same name is dropped rather than allowed to rewrite the rule's attribution.
 * Every other parameter the visitor brought is appended, in the order it came,
 * repeated keys and all.
 *
 * The destination's own query is kept byte for byte (no re-encoding: a rule an
 * owner wrote with `%20` keeps `%20`), its fragment stays last, and a
 * destination that is a path (`/pricing`) works the same as an absolute URL.
 *
 * Pure and import-free on purpose: the tenant middleware deep-imports it into
 * the edge bundle.
 */
export function withVisitorQuery(
  destination: string,
  visitorSearch: string,
): string {
  const search = String(visitorSearch ?? '').replace(/^\?/, '')
  if (!search) return destination
  const hashAt = destination.indexOf('#')
  const beforeHash = hashAt === -1 ? destination : destination.slice(0, hashAt)
  const hash = hashAt === -1 ? '' : destination.slice(hashAt)
  const queryAt = beforeHash.indexOf('?')
  const base = queryAt === -1 ? beforeHash : beforeHash.slice(0, queryAt)
  const ownQuery = queryAt === -1 ? '' : beforeHash.slice(queryAt + 1)
  const own = new URLSearchParams(ownQuery)
  const added = new URLSearchParams()
  for (const [key, value] of new URLSearchParams(search)) {
    if (!own.has(key)) added.append(key, value)
  }
  const extra = added.toString()
  if (!extra) return destination
  const query = ownQuery ? `${ownQuery}&${extra}` : extra
  return `${base}?${query}${hash}`
}
