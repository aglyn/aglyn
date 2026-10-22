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

import {
  NOTIFICATION_SOUND_FIELD,
  notificationSound,
  type NotificationSound,
} from '@aglyn/aglyn/app-utils/notification-sounds'
import { useFirestore, useUser } from '../firebase/firebase-services'
import { doc, onSnapshot, setDoc } from 'firebase/firestore'
import { useCallback, useEffect, useState } from 'react'

/**
 * The person's notification sound (`users/{uid}.notificationSound`), kept
 * live so a pick made in Notification settings, or in an app, is the next
 * chime this tab plays. It is an account setting: the same pick names the
 * sound the Apple and Android apps' pushes play.
 */
export default function useNotificationSound(): [
  NotificationSound,
  (id: string) => void,
] {
  const { data: user } = useUser()
  const firestore = useFirestore()
  const uid = (user as { uid?: string } | null | undefined)?.uid
  const [picked, setPicked] = useState<unknown>(undefined)

  useEffect(() => {
    if (!uid) return
    return onSnapshot(
      doc(firestore, 'users', uid),
      (snapshot) => setPicked(snapshot.get(NOTIFICATION_SOUND_FIELD)),
      () => undefined,
    )
  }, [firestore, uid])

  const pick = useCallback(
    (id: string) => {
      if (!uid) return
      setPicked(id)
      void setDoc(
        doc(firestore, 'users', uid),
        { [NOTIFICATION_SOUND_FIELD]: id },
        { merge: true },
      ).catch(console.error)
    },
    [firestore, uid],
  )

  return [notificationSound(picked), pick]
}
