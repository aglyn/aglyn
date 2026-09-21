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

export interface StaffRoleGate {
  /**
   * `false` while the claim is still resolving. Nothing may be BLOCKED in
   * that window: rendering a refusal there would flash a disabled button at
   * every super-staff member on every admin page load.
   */
  ready: boolean
  /** Whether the viewer's role is one the route admits. `false` until `ready`. */
  admitted: boolean
  /**
   * The one thing call sites branch on: a RESOLVED claim the route would
   * refuse. Deliberately not `!admitted` — that is true during the
   * unresolved window too, and would disable the control for everyone for a
   * beat.
   */
  blocked: boolean
  /** The reason to show when `blocked`, else `undefined`. */
  reason?: string
}

/**
 * The viewer's standing against the set of roles a route admits (AGL-2131,
 * moved out of the console app by AGL-3080 so a plugin's staff page can ask
 * the same question).
 *
 * Pure, and takes the role rather than reading it: the claim lives in the
 * app's session, and a staff page the shell mounts is handed the resolved
 * value. `null` means "still reading the token", and it is also what a
 * non-staff viewer resolves to — who never reaches an `/admin` page at all,
 * because the staff gate 404s them first. Treating both as unresolved is
 * therefore right for the only population that gets here.
 *
 * Not every gated act is super-only: `/api/admin/org-override` admits
 * `billing` for plan and quota writes and reserves only `releaseFlags` for
 * `super`. A gate that could only say "super" would disable that dialog for
 * the role whose entire purpose it is — trading one dishonest control for
 * another.
 */
export function resolveStaffRoleGate(
  role: string | null | undefined,
  allowed: readonly string[],
): StaffRoleGate {
  const ready = role !== null && role !== undefined
  const admitted = ready && allowed.includes(String(role))
  const blocked = ready && !admitted
  return {
    ready,
    admitted,
    blocked,
    reason: blocked
      ? `This action requires the ${allowed.join(' or ')} staff role. ` +
        'Ask someone who holds it.'
      : undefined,
  }
}

/** The single sentence every blocked super-only control says. */
export const SUPER_STAFF_ONLY_REASON =
  'This action requires the super staff role. Ask someone who holds it.'
