/**
 * @license
 * Copyright 2026 Aglyn LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Which notifications buzz this phone (AGL-3620): one switch per type,
 * grouped by category, stored at the account scope as
 * `users/{uid}.notificationSettings.accountTypes.{type}.push`, the same
 * settings document and layering the console's notification settings use.
 * A type nobody answered for follows the console feed, which is what the
 * switch shows until it is touched. The types, labels and console defaults
 * are the core catalog as generated data (`notification-catalog.generated.json`).
 */

import { accountPushSwitch, type AccountPushSettings } from '@aglyn/aglyn/app-utils/mobile-push'
import { getMobileFirebase, useLiveDoc, useMobileAuth } from '@aglyn/mobile-core'
import { Card, Screen, Skeleton, SwitchRow, Text } from '@aglyn/mobile-ui'
import { doc, FieldPath, updateDoc } from 'firebase/firestore'
import { useState } from 'react'
import catalog from '../notification-catalog.generated.json'

const SETTINGS_FIELD = 'notificationSettings'

export function NotificationSettingsScreen() {
  const { user } = useMobileAuth()
  const { firestore } = getMobileFirebase()
  const profile = useLiveDoc<Record<string, unknown>>(firestore, user ? ['users', user.uid] : null)
  const [error, setError] = useState<string | null>(null)
  const settings = (profile.data?.[SETTINGS_FIELD] ?? null) as AccountPushSettings | null
  const legacy = (profile.data?.['notificationPrefs'] ?? null) as Record<string, boolean> | null

  const setPush = (type: string, next: boolean) => {
    if (!user) return
    setError(null)
    // A FieldPath, not a dotted string: a type id has a dot of its own
    // (`content.order`), which a dotted path would split into two keys.
    updateDoc(doc(firestore, 'users', user.uid), new FieldPath(SETTINGS_FIELD, 'accountTypes', type, 'push'), next).catch(
      () => setError('That change did not save. Try again.'),
    )
  }

  return (
    <Screen>
      <Text tone="secondary">
        Choose what this phone is notified about. Anything you have not changed follows your notification feed.
      </Text>
      {error ? <Text tone="error">{error}</Text> : null}
      {!profile.ready ? (
        <Card>
          <Skeleton height={44} />
          <Skeleton height={44} />
        </Card>
      ) : (
        catalog.categories.map((category) => (
          <Card key={category.id} title={category.label}>
            {category.types.map((entry) => (
              <SwitchRow
                key={entry.type}
                testID={`push-${entry.type}`}
                title={entry.label}
                value={accountPushSwitch(settings, entry.type, category.id, entry.consoleDefault, legacy)}
                onValueChange={(next) => setPush(entry.type, next)}
              />
            ))}
          </Card>
        ))
      )}
    </Screen>
  )
}
