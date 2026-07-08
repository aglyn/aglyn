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

const RETRY_DELAY_MS = 400
const MAX_RETRIES = 5

/**
 * Retries a one-shot Firestore read (`getDocs`/`getCountFromServer`/`getDoc`)
 * on `permission-denied`, the same transient race `useFirestoreCollection`/
 * `useFirestoreDoc` recover from (AGL-216/218-222/223): `useUser()` can
 * report a signed-in user a beat before Firestore's own credential provider
 * has attached that user's ID token, so the very first read right after
 * sign-in can be denied even though the user is genuinely authorized.
 * Unlike `onSnapshot`, one-shot reads don't get a second try for free —
 * this wraps them with the same short backoff.
 */
export async function firestoreOneShotRetry<T>(
  run: () => Promise<T>,
): Promise<T> {
  let attempt = 0
  for (;;) {
    try {
      return await run()
    } catch (error) {
      const code = (error as { code?: string })?.code
      if (code !== 'permission-denied' || attempt >= MAX_RETRIES) throw error
      attempt += 1
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS))
    }
  }
}

export default firestoreOneShotRetry
