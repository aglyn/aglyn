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
 * The Support page's HTTP helper, extracted so it can be tested (AGL-1158).
 *
 * It was fifty lines of genuinely subtle rules living inside a 686-line
 * component, with **no test at all** — and the bug that motivated this issue
 * proved how expensive that is: AGL-1157 put a body on a GET, `fetch` threw
 * before opening a connection, the bare `catch` turned that into an empty
 * list, and it shipped. Invisible to typecheck and to the whole console suite,
 * because nothing exercised this code.
 *
 * The rules it encodes, each of which has already been a bug:
 *
 * * a GET/HEAD **may not carry a body** — `fetch` throws `TypeError` before
 *   any request is made (AGL-1157);
 * * `orgId` rides on the **query** regardless, because the routes read
 *   `query.orgId ?? payload.orgId` and a body-only reader missed it entirely
 *   (AGL-1147);
 * * a failure is **reported**, never swallowed — an empty list that means
 *   "request threw" is indistinguishable from one that means "no tickets",
 *   which is precisely how AGL-1157 survived a release.
 */

export interface SupportRequestDeps {
  /** Resolves the caller's ID token, or nothing when signed out. */
  getIdToken: () => Promise<string | undefined>
  /** Scopes every call; absent until the org resolves (AGL-1154). */
  orgId?: string
  /** Surfaced to the user. Called at most once per failed request. */
  onError: (message: string) => void
  /** Injected for tests; defaults to the global. */
  fetchImpl?: typeof fetch
}

/** Methods that must not carry a body. */
const BODYLESS = new Set(['GET', 'HEAD'])

/** Appends `orgId` to a path that may already have a query string. */
export function scopeToOrg(path: string, orgId?: string): string {
  if (!orgId) return path
  const separator = path.includes('?') ? '&' : '?'
  return `${path}${separator}orgId=${encodeURIComponent(orgId)}`
}

/**
 * Makes one Support API call, returning the payload or `null`.
 *
 * `null` always means "this failed and the user has been told" — never "the
 * server returned nothing". Callers render an empty state on `null` only
 * because there is nothing else to render, not because it implies emptiness.
 */
export async function supportRequest(
  deps: SupportRequestDeps,
  path: string,
  method: string,
  body?: Record<string, unknown>,
): Promise<unknown | null> {
  const { getIdToken, orgId, onError, fetchImpl = fetch } = deps
  try {
    const idToken = await getIdToken()
    const scoped = scopeToOrg(path, orgId)
    const sendsBody = !BODYLESS.has(method.toUpperCase())
    const response = await fetchImpl(scoped, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
      },
      // The `orgId` in the body is belt-and-braces for POSTs (AGL-1147); the
      // query above is what the routes actually prefer.
      ...(sendsBody && (body || orgId)
        ? {
            body: JSON.stringify({
              ...(body ?? {}),
              ...(orgId ? { orgId } : {}),
            }),
          }
        : {}),
    })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok) {
      onError(
        (payload as { error?: string })?.error ?? 'Request failed',
      )
      return null
    }
    return payload
  } catch (error) {
    // Logged as well as surfaced (AGL-1157). A bare `catch {}` here turned a
    // thrown TypeError into an empty list and a generic toast — the failure
    // mode that let the GET-with-body bug ship.
    console.error('[support] request failed', method, path, error)
    onError('An error has occurred')
    return null
  }
}

export default supportRequest
