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
 * What Manage Account → Profile image writes to `users/{uid}` (AGL-2486).
 *
 * A separate, pure module because the interesting part of that save is not
 * the network call — it is which of two sentinels each field gets, and that
 * decision is the difference between a removed avatar staying removed and
 * the identity provider restoring it on the next sign-in. Inline in the page
 * it was reachable only by mounting the whole account screen; here it is
 * three assertions.
 *
 * ## The rule this encodes
 *
 * `seedUserProfile` fills ABSENT fields from the IdP assertion on EVERY
 * sign-in, and its `blank()` counts an empty string as absent. So a clear
 * that stores `''`, or one that deletes the field and says nothing else, is
 * indistinguishable from an account that never had an avatar — and the next
 * sign-in writes the directory's picture straight back.
 *
 * `propagateMemberPhoto` already refuses that on the roster row by clearing
 * with `FieldValue.delete()`. Deletion is necessary here too, but it is NOT
 * sufficient, because on this document the seed is the thing being defended
 * against and absence is exactly what makes it write. The marker is what
 * carries the instruction.
 *
 * Symmetric on purpose, so no caller has to read the prior value: setting a
 * photo clears the marker. Someone who sets an avatar has stopped objecting
 * to having one, which makes re-enabling IdP prefill the same gesture as
 * choosing a picture rather than a control nobody would ever find.
 */
export interface AccountPhotoSentinels<TSentinel> {
  /** Firestore's `deleteField()` — removes the key outright. */
  deleteField: () => TSentinel
  /** Firestore's `serverTimestamp()` — stamps the removal. */
  serverTimestamp: () => TSentinel
}

export interface AccountPhotoProfilePatch<TSentinel> {
  photoUrl: string | TSentinel
  photoUrlErasedAt: TSentinel
}

/**
 * Build the `users/{uid}` merge patch for an avatar save.
 *
 * @param photoUrl the value the user is saving, already trimmed. The empty
 *        string is a real input and means REMOVE — not "no change".
 */
export function accountPhotoProfilePatch<TSentinel>(
  photoUrl: string,
  sentinels: AccountPhotoSentinels<TSentinel>,
): AccountPhotoProfilePatch<TSentinel> {
  const value = typeof photoUrl === 'string' ? photoUrl.trim() : ''
  return {
    photoUrl: value || sentinels.deleteField(),
    photoUrlErasedAt: value
      ? sentinels.deleteField()
      : sentinels.serverTimestamp(),
  }
}

export default accountPhotoProfilePatch
