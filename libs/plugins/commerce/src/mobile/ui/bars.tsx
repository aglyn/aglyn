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

import { Text, useMobileTheme } from '@aglyn/mobile-ui'
import { StyleSheet, View } from 'react-native'

/*
 * A plain bar chart for a run of days (AGL-3621): one bar per day, scaled to
 * the window's largest, the first and last day labeled under it. Its
 * accessible label states the figures, because a bar is not readable to a
 * screen reader.
 */

export interface Bar {
  key: string
  value: number
  label: string
}

export function Bars({
  bars,
  height = 96,
  summary,
  testID,
}: {
  bars: readonly Bar[]
  height?: number
  summary: string
  testID?: string
}) {
  const theme = useMobileTheme()
  const peak = Math.max(1, ...bars.map((bar) => bar.value))
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={summary} testID={testID}>
      <View style={[styles.row, { height, gap: bars.length > 14 ? 2 : 4 }]}>
        {bars.map((bar) => (
          <View key={bar.key} style={styles.column}>
            <View
              style={{
                height: Math.max(2, Math.round((bar.value / peak) * height)),
                backgroundColor: bar.value ? theme.colors.primary.main : theme.colors.divider,
                borderTopLeftRadius: theme.radius / 2,
                borderTopRightRadius: theme.radius / 2,
              }}
            />
          </View>
        ))}
      </View>
      {bars.length ? (
        <View style={styles.labels}>
          <Text variant="caption" tone="secondary">
            {bars[0].label}
          </Text>
          <Text variant="caption" tone="secondary">
            {bars[bars.length - 1].label}
          </Text>
        </View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-end' },
  column: { flex: 1, justifyContent: 'flex-end' },
  labels: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
})
