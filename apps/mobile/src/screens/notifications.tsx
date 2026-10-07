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
 * The person's notifications (AGL-3620): the same `users/{uid}/notifications`
 * feed the console's bell reads, newest first, under the same owner-only
 * rules. Opening one marks it read the way the console does (`read` beside
 * `readAt`, AGL-3321) and follows its link — natively when a plugin answers
 * the path, otherwise in the console WebView.
 */

import { getMobileFirebase, useMobileAuth } from '@aglyn/mobile-core'
import { getMobileDeepLinks, resolveMobileLink } from '@aglyn/mobile-plugin-host'
import { Button, Card, EmptyState, Icon, ListRow, Screen, Skeleton, useMobileTheme } from '@aglyn/mobile-ui'
import { useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import {
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore'
import { useEffect, useState } from 'react'
import type { RootStackParams } from '../shell/navigation-ref'

export interface FeedNotification {
  id: string
  title: string
  body?: string
  link?: string
  read: boolean
  level?: string
}

/** The AGL-3437 levels as the theme's intents; unknown or absent reads as info. */
export function levelIntent(level: string | undefined): 'error' | 'warning' | 'success' | 'info' {
  if (level === 'critical' || level === 'error') return 'error'
  if (level === 'warning') return 'warning'
  if (level === 'success') return 'success'
  return 'info'
}

function useNotificationFeed(count: number): FeedNotification[] | null {
  const { user } = useMobileAuth()
  const [rows, setRows] = useState<FeedNotification[] | null>(null)
  useEffect(() => {
    if (!user) return
    const { firestore } = getMobileFirebase()
    return onSnapshot(
      query(
        collection(firestore, 'users', user.uid, 'notifications'),
        orderBy('createdAt', 'desc'),
        limit(count),
      ),
      (snapshot) =>
        setRows(
          snapshot.docs.map((row) => {
            const data = row.data()
            return {
              id: row.id,
              title: String(data['title'] ?? ''),
              body: typeof data['body'] === 'string' ? data['body'] : undefined,
              link: typeof data['link'] === 'string' ? data['link'] : undefined,
              read: data['read'] === true,
              level: typeof data['level'] === 'string' ? data['level'] : undefined,
            }
          }),
        ),
      () => setRows([]),
    )
  }, [user, count])
  return rows
}

export function useOpenNotification() {
  const { user } = useMobileAuth()
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParams>>()
  return (row: Pick<FeedNotification, 'id' | 'link' | 'read'>) => {
    if (user && !row.read) {
      const { firestore } = getMobileFirebase()
      updateDoc(doc(firestore, 'users', user.uid, 'notifications', row.id), {
        read: true,
        readAt: serverTimestamp(),
      }).catch(() => undefined)
    }
    const target = row.link ? resolveMobileLink(row.link, getMobileDeepLinks()) : null
    if (!target) return
    if (target.kind === 'screen') {
      navigation.navigate('PluginScreen', { screenId: target.screen, params: target.params })
    } else {
      navigation.navigate('Console', { path: target.path })
    }
  }
}

function NotificationRows({ rows }: { rows: FeedNotification[] }) {
  const theme = useMobileTheme()
  const open = useOpenNotification()
  return (
    <>
      {rows.map((row) => (
        <ListRow
          key={row.id}
          testID={`notification-${row.id}`}
          title={row.title}
          subtitle={row.body}
          selected={!row.read}
          trailing={
            <Icon
              name={row.read ? 'ellipse-outline' : 'ellipse'}
              size={10}
              color={theme.colors[levelIntent(row.level)].main}
            />
          }
          onPress={() => open(row)}
        />
      ))}
    </>
  )
}

export function RecentNotificationsCard() {
  const rows = useNotificationFeed(5)
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParams>>()
  return (
    <Card
      title="Notifications"
      actions={<Button title="See all" variant="text" onPress={() => navigation.navigate('Notifications')} />}
    >
      {rows === null ? (
        <Skeleton height={40} />
      ) : rows.length ? (
        <NotificationRows rows={rows} />
      ) : (
        <EmptyState icon="notifications-off-outline" title="You're all caught up" />
      )}
    </Card>
  )
}

export function NotificationsScreen() {
  const rows = useNotificationFeed(50)
  return (
    <Screen padded={false}>
      {rows === null ? (
        <Skeleton height={56} />
      ) : rows.length ? (
        <NotificationRows rows={rows} />
      ) : (
        <EmptyState icon="notifications-off-outline" title="You're all caught up" />
      )}
    </Screen>
  )
}
