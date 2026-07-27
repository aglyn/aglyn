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
 * Rules for a password an ADMIN chooses on somebody else's behalf
 * (AGL-910). Pure and dependency-free so all three surfaces agree: the
 * console form checks it before a round trip, the Firebase Auth endpoints
 * check it again, and the site-member handler — which lives in the commerce
 * plugin and shares nothing else with them — checks the same thing.
 *
 * Not the policy for passwords people choose for THEMSELVES. This one is
 * stricter on length because the credential is handed over out of band
 * (read aloud, pasted into a ticket) and is meant to be replaced.
 */

/** Firebase Auth's own floor is 6; a third party has seen this one. */
export const PASSWORD_MIN_LENGTH = 12
export const PASSWORD_MAX_LENGTH = 128

export interface PasswordValidation {
  /** Message to show the admin, or null when the password is acceptable. */
  error: string | null
  /** The coerced password. Only meaningful when `error` is null. */
  password: string
}

/**
 * Deliberately shallow — length plus a couple of triviality traps. A
 * composition rulebook (one upper, one digit, one symbol) pushes admins
 * toward `Password1!` shapes without adding real strength; length is what
 * carries here, and the credential is short-lived by design.
 *
 * A nullable `error` rather than an ok/error union: this crosses three
 * project boundaries (console app, commerce plugin, tenant app) and
 * discriminated-union narrowing did not survive the trip.
 */
export function validateNewPassword(raw: unknown): PasswordValidation {
  const password = String(raw ?? '')
  const error =
    password.length < PASSWORD_MIN_LENGTH
      ? `Passwords must be at least ${PASSWORD_MIN_LENGTH} characters`
      : password.length > PASSWORD_MAX_LENGTH
        ? `Passwords can be at most ${PASSWORD_MAX_LENGTH} characters`
        : password.trim() !== password
          ? 'Passwords cannot start or end with a space'
          : new Set(password).size < 5
            ? 'That password is too repetitive'
            : null
  return { error, password }
}
