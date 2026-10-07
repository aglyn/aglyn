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
 * The site's redirect rules (AGL-3620). Read-only on the phone; on a tablet
 * the list sits beside the selected rule's detail. Editing opens the
 * console's own Redirects page, which owns the validation and the publish
 * role a rule needs.
 */

import type { MobileScreenProps } from '@aglyn/mobile-plugin-host'
import { Button, Card, EmptyState, ListRow, Screen, Skeleton, SplitView, Text } from '@aglyn/mobile-ui'
import { useState } from 'react'
import { FlatList, View } from 'react-native'
import { useHostRedirects, type RedirectRow } from './use-host-redirects'

function RedirectDetail({ row }: { row: RedirectRow | null }) {
  if (!row) return <EmptyState icon="git-branch-outline" title="Pick a redirect to see it here" />
  return (
    <Screen>
      <Card title={row.source}>
        <Text tone="secondary">Sends visitors to</Text>
        <Text>{row.destination}</Text>
        <Text tone="secondary">
          {row.statusCode} · {row.kind ?? 'exact'} match · {row.enabled === false ? 'Off' : 'On'}
        </Text>
      </Card>
    </Screen>
  )
}

export default function RedirectsListScreen({ context }: MobileScreenProps) {
  const { rows, ready, error } = useHostRedirects(context.firestore, context.hostId)
  const [selected, setSelected] = useState<string | null>(null)
  const current = rows.find((row) => row.id === selected) ?? null

  const list = !ready ? (
    <View style={{ padding: 16, gap: 12 }}>
      <Skeleton height={44} />
      <Skeleton height={44} />
      <Skeleton height={44} />
    </View>
  ) : error ? (
    <EmptyState icon="warning-outline" title="Could not load this site's redirects" />
  ) : (
    <FlatList
      data={rows}
      keyExtractor={(row) => row.id}
      ListEmptyComponent={
        <EmptyState
          icon="git-branch-outline"
          title="No redirects yet"
          body="Rules you add in the console show up here."
        />
      }
      ListFooterComponent={
        <View style={{ padding: 16 }}>
          <Button
            title="Manage in the console"
            variant="outlined"
            icon="open-outline"
            onPress={() => context.openConsolePath('/redirects', 'site')}
          />
        </View>
      }
      renderItem={({ item }) => (
        <ListRow
          testID={`redirect-${item.id}`}
          icon={item.enabled === false ? 'pause-circle-outline' : 'git-branch-outline'}
          title={item.source}
          subtitle={`${item.statusCode} → ${item.destination}`}
          selected={item.id === selected}
          onPress={() => setSelected(item.id)}
          trailing={null}
        />
      )}
    />
  )

  return <SplitView list={list} detail={<RedirectDetail row={current} />} />
}
