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
 * The app's navigation (AGL-3620).
 *
 * Phones get bottom tabs; tablets get the same tabs as a sidebar
 * (`tabBarPosition: 'left'`), which leaves the content area free for a
 * screen's own SplitView. The tabs are Home, then every plugin's tab in its
 * declared order, then More. Everything else is pushed over the tabs:
 * plugin screens, the console WebView, the switcher (a sheet on phones).
 *
 * Links: `aglyn://…`, the console's own https URLs (universal links) and
 * notification links all go through `resolveMobileLink`, so a path a plugin
 * answers opens natively and every other path opens in the console WebView.
 */

import { getMobileConfig } from '@aglyn/mobile-core'
import { getMobileDeepLinks, resolveMobileLink, useMobileContributions } from '@aglyn/mobile-plugin-host'
import { Icon, useLayout, useMobileTheme } from '@aglyn/mobile-ui'
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs'
import {
  DarkTheme,
  DefaultTheme,
  NavigationContainer,
  type LinkingOptions,
  type Theme,
} from '@react-navigation/native'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import * as Linking from 'expo-linking'
import { useMemo } from 'react'
import { ConsoleScreen } from './screens/console'
import { HomeScreen } from './screens/home'
import { MoreScreen } from './screens/more'
import { NotificationsScreen } from './screens/notifications'
import { PluginScreenHost, PluginScreenRoute } from './screens/plugin-screen'
import { NotificationSettingsScreen } from './screens/notification-settings'
import { SettingsScreen } from './screens/settings'
import { SwitcherScreen } from './screens/switcher'
import { navigationRef, type RootStackParams } from './shell/navigation-ref'

const Stack = createNativeStackNavigator<RootStackParams>()
const Tabs = createBottomTabNavigator()

function MainTabs() {
  const { tabs } = useMobileContributions()
  const { kind } = useLayout()
  const theme = useMobileTheme()
  const tablet = kind === 'tablet'
  return (
    <Tabs.Navigator
      id="tabs"
      screenOptions={{
        tabBarPosition: tablet ? 'left' : 'bottom',
        tabBarVariant: tablet ? 'material' : 'uikit',
        tabBarLabelPosition: tablet ? 'below-icon' : undefined,
        tabBarActiveTintColor: theme.colors.primary.text,
        tabBarInactiveTintColor: theme.colors.text.secondary,
        headerShown: true,
      }}
    >
      <Tabs.Screen
        name="home"
        component={HomeScreen}
        options={{
          title: 'Home',
          tabBarButtonTestID: 'tab-home',
          tabBarIcon: ({ color, size }) => <Icon name="home-outline" color={color} size={size} />,
        }}
      />
      {tabs.map((tab) => (
        <Tabs.Screen
          key={tab.id}
          name={`tab:${tab.id}`}
          options={{
            title: tab.title,
            tabBarButtonTestID: `tab-${tab.id}`,
            tabBarIcon: ({ color, size }) => <Icon name={tab.icon} color={color} size={size} />,
          }}
        >
          {() => <PluginScreenHost screenId={tab.screen} setTitle={false} />}
        </Tabs.Screen>
      ))}
      <Tabs.Screen
        name="more"
        component={MoreScreen}
        options={{
          title: 'More',
          tabBarButtonTestID: 'tab-more',
          tabBarIcon: ({ color, size }) => <Icon name="menu-outline" color={color} size={size} />,
        }}
      />
    </Tabs.Navigator>
  )
}

/** Exported for specs: what a link opens, as navigation state. */
export function stateForLink(path: string) {
  const target = resolveMobileLink(path, getMobileDeepLinks())
  if (!target) return undefined
  const top =
    target.kind === 'screen'
      ? { name: 'PluginScreen' as const, params: { screenId: target.screen, params: target.params } }
      : { name: 'Console' as const, params: { path: target.path } }
  return { routes: [{ name: 'Main' as const }, top] }
}

export function AppNavigation() {
  const theme = useMobileTheme()
  const { kind } = useLayout()

  const navigationTheme = useMemo<Theme>(() => {
    const base = theme.scheme === 'dark' ? DarkTheme : DefaultTheme
    return {
      ...base,
      colors: {
        ...base.colors,
        primary: theme.colors.primary.text,
        background: theme.colors.background.default,
        card: theme.colors.background.paper,
        text: theme.colors.text.primary,
        border: theme.colors.divider,
        notification: theme.colors.error.main,
      },
    }
  }, [theme])

  const linking = useMemo<LinkingOptions<RootStackParams>>(
    () => ({
      prefixes: [Linking.createURL('/'), 'aglyn://', getMobileConfig().consoleOrigin],
      // Every link is a console path; the registry decides where it lands.
      getStateFromPath: (path) => stateForLink(path) as never,
    }),
    [],
  )

  return (
    <NavigationContainer ref={navigationRef} theme={navigationTheme} linking={linking}>
      <Stack.Navigator id="root">
        <Stack.Screen name="Main" component={MainTabs} options={{ headerShown: false }} />
        <Stack.Screen name="PluginScreen" component={PluginScreenRoute} options={{ title: '' }} />
        <Stack.Screen name="Console" component={ConsoleScreen} options={{ title: 'Console' }} />
        <Stack.Screen name="Notifications" component={NotificationsScreen} options={{ title: 'Notifications' }} />
        <Stack.Screen name="Settings" component={SettingsScreen} options={{ title: 'Settings' }} />
        <Stack.Screen
          name="NotificationSettings"
          component={NotificationSettingsScreen}
          options={{ title: 'Push notifications' }}
        />
        <Stack.Screen
          name="Switcher"
          component={SwitcherScreen}
          options={{
            title: 'Switch workspace',
            presentation: kind === 'tablet' ? 'formSheet' : 'modal',
          }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  )
}
