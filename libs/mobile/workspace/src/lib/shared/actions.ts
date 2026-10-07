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

import { Alert } from 'react-native'

/*==========================================
 * ASK FIRST, SAY WHY NOT.
 *
 * Every write these screens make goes through a console route, and is asked
 * first with the platform's own dialog. A route that refuses says why in its
 * `error`, which the API client carries as the message; that sentence is
 * shown as it is, so the app and the console refuse in the same words.
 *=========================================*/

export interface ConfirmOptions {
  title: string
  message?: string
  /** The confirming button's label, e.g. "Remove". */
  confirmLabel: string
  destructive?: boolean
}

/** The platform dialog as a promise: true for the confirming button, false otherwise. */
export function confirmAction(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(
      options.title,
      options.message,
      [
        { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
        {
          text: options.confirmLabel,
          style: options.destructive ? 'destructive' : 'default',
          onPress: () => resolve(true),
        },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    )
  })
}

/** What a failed request says: the route's own sentence, else a plain one. */
export function refusalMessage(error: unknown, fallback = 'That did not work. Try again.'): string {
  return error instanceof Error && error.message ? error.message : fallback
}

/** Shows a refusal in the platform dialog. */
export function showRefusal(title: string, error: unknown): void {
  Alert.alert(title, refusalMessage(error))
}

/** A short notice, for a write that worked and says something worth knowing. */
export function showNotice(title: string, message?: string): void {
  Alert.alert(title, message)
}
