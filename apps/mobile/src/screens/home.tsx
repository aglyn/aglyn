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
 * The dashboard home (AGL-3620): the workspace and site in view, the
 * plugins' quick actions, then the plugins' dashboard widgets. Phones stack
 * the widgets; tablets pair the `half` ones two to a row.
 */

import { mobileBrandName, useWorkspace } from '@aglyn/mobile-core'
import {
  useMobileContributions,
  useMobilePluginContext,
  type MobileQuickAction,
} from '@aglyn/mobile-plugin-host'
import { Card, EmptyState, Icon, Screen, Text, useLayout, useMobileTheme } from '@aglyn/mobile-ui'
import { useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { Pressable, StyleSheet, View } from 'react-native'
import { LazyContribution } from '../shell/lazy-contribution'
import type { RootStackParams } from '../shell/navigation-ref'
import { RecentNotificationsCard } from './notifications'

function QuickActions({ actions }: { actions: MobileQuickAction[] }) {
  const theme = useMobileTheme()
  const context = useMobilePluginContext()
  if (!actions.length) return null
  return (
    <View style={[styles.actions, { gap: theme.space(1) }]}>
      {actions.map((action) => (
        <Pressable
          key={action.id}
          accessibilityRole="button"
          testID={`quick-action-${action.id}`}
          onPress={() =>
            action.screen
              ? context.navigate(action.screen, action.params)
              : context.openConsolePath(action.consolePath ?? '/')
          }
          style={({ pressed }) => [
            styles.action,
            {
              backgroundColor: theme.colors.background.paper,
              borderColor: theme.colors.divider,
              borderRadius: theme.radius,
              padding: theme.space(1.5),
              opacity: pressed ? 0.7 : 1,
            },
          ]}
        >
          <Icon name={action.icon} color={theme.colors.primary.text} />
          <Text variant="caption" numberOfLines={2}>
            {action.title}
          </Text>
        </Pressable>
      ))}
    </View>
  )
}

export function HomeScreen() {
  const theme = useMobileTheme()
  const { kind } = useLayout()
  const workspace = useWorkspace()
  const context = useMobilePluginContext()
  const { widgets, quickActions } = useMobileContributions()
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParams>>()
  const hasSite = Boolean(workspace.site)

  const visibleActions = quickActions.filter((action) => hasSite || !action.requiresSite)
  const visibleWidgets = widgets.filter((widget) => hasSite || !widget.requiresSite)

  return (
    <Screen>
      <Pressable
        accessibilityRole="button"
        testID="home-switcher"
        onPress={() => navigation.navigate('Switcher')}
        style={[styles.scope, { gap: theme.space(1) }]}
      >
        <View style={styles.flex}>
          <Text variant="title" numberOfLines={1}>
            {workspace.org?.name ?? (workspace.ready ? 'No workspace' : ' ')}
          </Text>
          <Text tone="secondary" numberOfLines={1}>
            {workspace.site ? workspace.site.name : workspace.ready ? 'Pick a site' : ' '}
          </Text>
        </View>
        <Icon name="swap-horizontal" color={theme.colors.primary.text} />
      </Pressable>

      <QuickActions actions={visibleActions} />

      <View style={[styles.grid, { gap: theme.space(2) }]}>
        {visibleWidgets.map((widget) => (
          <View
            key={widget.id}
            style={kind === 'tablet' && widget.size === 'half' ? styles.half : styles.full}
          >
            <Card title={widget.title}>
              <LazyContribution id={widget.id} load={widget.load} props={{ context }} compact />
            </Card>
          </View>
        ))}
      </View>

      <RecentNotificationsCard />

      {workspace.ready && !workspace.orgs.length ? (
        <EmptyState
          icon="business-outline"
          title="No workspaces yet"
          body={`Create a workspace in the ${mobileBrandName()} console, then come back here.`}
        />
      ) : null}
    </Screen>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scope: { flexDirection: 'row', alignItems: 'center' },
  actions: { flexDirection: 'row', flexWrap: 'wrap' },
  action: { width: 104, minHeight: 84, gap: 6, borderWidth: StyleSheet.hairlineWidth },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  full: { width: '100%' },
  half: { flexBasis: '48%', flexGrow: 1 },
})
