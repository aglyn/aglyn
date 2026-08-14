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
 * Carries a failed signup-time org creation to the workspace picker
 * (AGL-1523).
 *
 * `provisionSignUpOrg` is best-effort BY CONTRACT — a failed org create must
 * not read as a failed sign-up — but best-effort used to mean silent: the
 * person typed a workspace name, was given nothing, and landed on the picker
 * with no explanation. This marker is how the picker learns what happened so
 * it can say so and offer the create dialog with the name they already typed.
 *
 * sessionStorage on purpose (same reasoning as `legal-consent.ts`): it
 * survives the navigation from /signup to the picker in this tab, and dies
 * with the tab instead of haunting some later, unrelated session.
 */

const STORAGE_KEY = 'aglyn:signup-org-create-failed'

export interface SignUpOrgFailure {
  /** The organization name the person typed into the signup form. */
  name: string
  /** The server's error copy, when it sent any. */
  error: string | null
}

export function markSignUpOrgFailure(failure: SignUpOrgFailure): void {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(failure))
  } catch {
    // Storage unavailable (private mode, quota) — the picker falls back to
    // its ordinary empty state, which still offers workspace creation.
  }
}

/** Read AND clear — the notice shows once, not on every future picker visit. */
export function consumeSignUpOrgFailure(): SignUpOrgFailure | null {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    window.sessionStorage.removeItem(STORAGE_KEY)
    const parsed = JSON.parse(raw) as Partial<SignUpOrgFailure>
    if (typeof parsed?.name !== 'string' || !parsed.name) return null
    return {
      name: parsed.name,
      error: typeof parsed.error === 'string' ? parsed.error : null,
    }
  } catch {
    return null
  }
}
