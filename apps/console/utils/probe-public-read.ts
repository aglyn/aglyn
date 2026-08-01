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
 * Which layer is refusing our reads? (AGL-1143)
 *
 * `permission-denied` is what Firestore returns for a rules verdict AND for
 * an App Check rejection — the two are indistinguishable from the client, and
 * they need opposite responses. That ambiguity cost most of a day: a session
 * was denied on every collection, the rules were suspected, and the rules
 * turned out to allow it (proved in the emulator against a synthetic token).
 * The refusal was happening in front of them.
 *
 * `orgSlugs` is `allow read: if true` — the only unconditionally public
 * collection there is. So a read of it separates the layers cleanly:
 *
 *   succeeds → App Check and the transport are fine. Whatever is failing is
 *              this session's identity: an ID token that is missing, expired
 *              or revoked. "Sign in again" is the right advice.
 *   denied   → the request never got past App Check. Signing in again fixes
 *              NOTHING, and telling someone to do it destroys the evidence,
 *              which is exactly how AGL-1062 lost hours.
 *
 * Reads a document that deliberately does not exist. A missing document is a
 * successful read at the rules layer, so this needs no fixture, cannot be
 * broken by someone renaming a workspace, and returns a few bytes.
 */

import { doc, getDoc, type Firestore } from 'firebase/firestore'

/** Not a real slug. Nothing creates it; nothing should. */
const PROBE_DOC = '__console-health-probe__'

export type PublicReadProbe =
  | 'ok'
  | 'denied'
  | 'error'

export interface PublicReadProbeResult {
  outcome: PublicReadProbe
  /** Firestore's own code, when there was one — for the log line. */
  code?: string
  /** What this means, in the words the next person needs. */
  hint: string
}

/**
 * Read the public collection and report which layer answered.
 *
 * Deliberately does NOT go through `firestoreOneShotRetry`: that helper feeds
 * `session-health`, and a probe run *because* the session looks unhealthy
 * must not add to the evidence that triggered it. It also must not retry —
 * the caller has already waited through five backoffs and wants an answer,
 * not another minute of them.
 */
export async function probePublicRead(
  firestore: Firestore,
): Promise<PublicReadProbeResult> {
  try {
    await getDoc(doc(firestore, 'orgSlugs', PROBE_DOC))
    return {
      outcome: 'ok',
      hint:
        'A public read SUCCEEDED, so App Check and the transport are fine — ' +
        'this session’s ID token is the problem. Signing in again should fix it.',
    }
  } catch (error) {
    const code = (error as { code?: string })?.code
    if (code === 'permission-denied') {
      return {
        outcome: 'denied',
        code,
        hint:
          'A read of a PUBLIC collection was also denied. The rules allow it ' +
          'unconditionally, so the request is being refused before rules run ' +
          '— App Check. Signing in again will NOT help; check App Check ' +
          'enforcement and the reCAPTCHA site key for this origin.',
      }
    }
    return {
      outcome: 'error',
      code,
      hint:
        'The probe failed without a permission verdict — likely offline or ' +
        'blocked by the network rather than by Firebase.',
    }
  }
}

export default probePublicRead
