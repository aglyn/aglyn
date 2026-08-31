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
 * it — no audience count, no sending identity, and a Send button latched on a
 * promise that never settles.
 */
export async function resolveIdToken(
  user: TokenSource | null | undefined,
  timeoutMs: number = ID_TOKEN_TIMEOUT_MS,
): Promise<string> {
  if (!user?.getIdToken) {
    throw new AuthorizationUnavailableError(
      'signed-out',
      'You are signed out, so nothing was sent. Sign in again and retry.',
    )
  }
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const token = await Promise.race([
      Promise.resolve(user.getIdToken()).catch((cause: unknown) => {
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

/** Whatever a thrown value has to say for itself, in one line. */
const errorText = (cause: unknown): string =>
  cause instanceof Error
    ? cause.message
    : String((cause as { message?: unknown })?.message ?? cause ?? 'no detail')

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
