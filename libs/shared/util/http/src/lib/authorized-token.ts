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
 * How long a call waits for the caller's ID token before it gives up.
 *
 * `getIdToken()` mints from a cached token when one is live and otherwise
 * refreshes against Google's token endpoint, and that refresh carries no
 * deadline of its own: a request that is never answered leaves a promise
 * pending for the life of the page. Every surface here awaits that promise
 * BEFORE it issues its own request, so an unbounded wait is not a slow
 * request — it is a surface that issues nothing, forever, having reported
 * nothing.
 *
 * Long enough to cover a cold refresh over a slow connection, and short
 * enough that a button which reads "Working…" goes back to being a button.
 */
export const ID_TOKEN_TIMEOUT_MS = 10_000

/**
 * The caller could not be authorized, so no request was made.
 *
 * A distinct type because it is the one failure that has NOT reached the
 * server: nothing was sent, nothing was charged, nothing was mailed. A
 * surface catching it can say so plainly instead of reporting the generic
 * failure of an action that never left the browser.
 */
export class AuthorizationUnavailableError extends Error {
  /** Which of the three ways the token could not be had. */
  readonly reason: 'signed-out' | 'timeout' | 'rejected'

  constructor(reason: 'signed-out' | 'timeout' | 'rejected', message: string) {
    super(message)
    this.name = 'AuthorizationUnavailableError'
    this.reason = reason
  }
}

/** The account shape this needs: something that can mint an ID token. */
export interface TokenSource {
  getIdToken?: (forceRefresh?: boolean) => Promise<string>
}

/** What a caller may hand in where an account is expected. */
export type MaybeTokenSource = TokenSource | null | undefined

/** Whatever a thrown value has to say for itself, in one line. */
const errorText = (cause: unknown): string =>
  cause instanceof Error
    ? cause.message
    : String((cause as { message?: unknown })?.message ?? cause ?? 'no detail')

/**
 * THE CALLER'S ID TOKEN, OR AN ERROR THAT SAYS WHY THERE ISN'T ONE.
 *
 * Three refusals rather than a value that may be missing, because the
 * alternative is what a missing token silently buys: a request that goes out
 * with no `Authorization` header, is refused by the route on its own terms,
 * and reports "Send failed" to somebody whose actual problem is that they are
 * signed out. A token is either obtained or the call does not happen.
 *
 * The timeout is the load-bearing one. Awaiting an unbounded refresh in front
 * of a request means a stalled token endpoint takes the whole surface with
 * it — no data, no action, and a button latched on a promise that never
 * settles.
 *
 * @param user - The signed-in account, or nothing.
 * @param options - `timeoutMs` overrides the deadline; `forceRefresh` asks
 *   Firebase to skip its cached token, which is what a surface reading a
 *   claim that has just changed needs.
 */
export async function resolveIdToken(
  user: MaybeTokenSource,
  options: { timeoutMs?: number; forceRefresh?: boolean } = {},
): Promise<string> {
  const { timeoutMs = ID_TOKEN_TIMEOUT_MS, forceRefresh = false } = options
  if (!user?.getIdToken) {
    throw new AuthorizationUnavailableError(
      'signed-out',
      'You are signed out, so nothing was sent. Sign in again and retry.',
    )
  }
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const token = await Promise.race([
      Promise.resolve(user.getIdToken(forceRefresh)).catch((cause: unknown) => {
        throw new AuthorizationUnavailableError(
          'rejected',
          'Your sign-in could not be confirmed, so nothing was sent. ' +
            `Check your connection and retry. (${errorText(cause)})`,
        )
      }),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(
            new AuthorizationUnavailableError(
              'timeout',
              'Your sign-in could not be confirmed in time, so nothing was ' +
                'sent. Check your connection and retry.',
            ),
          )
        }, timeoutMs)
      }),
    ])
    if (!token) {
      throw new AuthorizationUnavailableError(
        'signed-out',
        'You are signed out, so nothing was sent. Sign in again and retry.',
      )
    }
    return token
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

/**
 * What to put in front of somebody when a call failed.
 *
 * An authorization failure names itself; anything else is the caller's own
 * fallback, because a network error mid-send and a send that never left are
 * not the same news.
 */
export const describeCallFailure = (
  error: unknown,
  fallback: string,
): string =>
  error instanceof AuthorizationUnavailableError ? error.message : fallback

/**
 * The answer a caller gets when the token could not be had.
 *
 * `401` because that is what the request would have been answered with had it
 * gone out, and the reason travels in `error`, which is the field every
 * caller already reads off a refused response. Duck-typed rather than a real
 * `Response`: the constructor is absent from some of the environments these
 * surfaces are tested in, and every field a caller touches is here.
 */
const refusedResponse = (message: string): Response => {
  const body = JSON.stringify({ error: message })
  return {
    ok: false,
    status: 401,
    statusText: 'Unauthorized',
    redirected: false,
    type: 'basic' as ResponseType,
    url: '',
    headers: { get: (name: string) =>
      name.toLowerCase() === 'content-type' ? 'application/json' : null },
    json: async () => ({ error: message }),
    text: async () => body,
    clone() {
      return refusedResponse(message)
    },
  } as unknown as Response
}

/**
 * A `fetch` THAT CANNOT GO OUT UNAUTHENTICATED AND CANNOT HANG ON THE TOKEN.
 *
 * The header is unconditional, which is the whole point: building it as
 * `...(idToken ? { Authorization } : {})` means a caller who could not be
 * authorized sends the request ANYWAY, without credentials. That is a request
 * which should never have left the browser — it reaches the route, is refused
 * on the route's own terms, and comes back as whatever generic failure the
 * surface prints for a bad response, so the one fact worth telling the person
 * (they are signed out) is the one fact nobody says.
 *
 * When the token cannot be had the request is not made at all and the caller
 * is answered with a `401` carrying the reason. Callers already branch on
 * `response.ok` and already render `payload.error`, so the refusal arrives
 * through the path they have rather than through one they would have to grow
 * — and, unlike a thrown error, it cannot turn a surface that used to hang
 * into a surface that silently rejects.
 *
 * Callers that must distinguish "the route refused me" from "this never left
 * the browser" should use {@link resolveIdToken} directly and catch
 * {@link AuthorizationUnavailableError}.
 */
export async function authorizedFetch(
  user: MaybeTokenSource,
  input: string | URL,
  init: RequestInit = {},
  options: {
    timeoutMs?: number
    forceRefresh?: boolean
    /** Test seam. The real one is `fetch`. */
    fetchImpl?: typeof fetch
  } = {},
): Promise<Response> {
  let idToken: string
  try {
    idToken = await resolveIdToken(user, options)
  } catch (error) {
    return refusedResponse(
      describeCallFailure(error, 'Your sign-in could not be confirmed.'),
    )
  }
  return (options.fetchImpl ?? fetch)(input, {
    ...init,
    headers: { ...plainHeaders(init.headers), Authorization: `Bearer ${idToken}` },
  })
}

/**
 * Whatever `headers` form the caller used, as a plain record.
 *
 * The outgoing headers stay a plain object rather than becoming a `Headers`
 * instance, because that is the shape callers hand in and the shape their
 * tests read back off the recorded request. Promoting it would change what
 * every one of those assertions sees without changing what the server gets.
 */
const plainHeaders = (headers: RequestInit['headers']): Record<string, string> => {
  if (!headers) return {}
  if (Array.isArray(headers)) return Object.fromEntries(headers)
  if (typeof (headers as Headers).forEach === 'function' && !isPlainRecord(headers)) {
    const flat: Record<string, string> = {}
    ;(headers as Headers).forEach((value, key) => {
      flat[key] = value
    })
    return flat
  }
  return { ...(headers as Record<string, string>) }
}

/** True for an object literal, which `Headers` is not. */
const isPlainRecord = (value: unknown): boolean => {
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}
