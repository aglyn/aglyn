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
 * More: the account, the switcher, appearance, and a way into the console
 * for anything the app does not yet draw natively (AGL-3620).
 */

import { mobileBrandName, useMobileAuth, useWorkspace } from '@aglyn/mobile-core'
import { Button, Card, ListRow, Screen, Text } from '@aglyn/mobile-ui'
import { useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { APP_VERSION } from '../config'
import type { RootStackParams } from '../shell/navigation-ref'

export function MoreScreen() {
  const { user, signOut } = useMobileAuth()
  const workspace = useWorkspace()
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParams>>()

  return (
    <Screen>
      <Card title="Account">
        <Text>{user?.email ?? ''}</Text>
        <ListRow
          icon="swap-horizontal"
          title={workspace.org?.name ?? 'Choose a workspace'}
          subtitle={workspace.site?.name}
          onPress={() => navigation.navigate('Switcher')}
        />
        <ListRow icon="notifications-outline" title="Notifications" onPress={() => navigation.navigate('Notifications')} />
        <ListRow icon="settings-outline" title="Settings" testID="more-settings" onPress={() => navigation.navigate('Settings')} />
      </Card>
      <Card title="Console">
        <Text tone="secondary">{`Everything in the ${mobileBrandName()} console, including the Besigner, opens here.`}</Text>
        <ListRow
          icon="open-outline"
          title="Open the console"
          testID="more-open-console"
          onPress={() =>
            navigation.navigate('Console', { path: workspace.org ? `/${workspace.org.slug}` : '/' })
          }
        />
      </Card>
      <Button title="Sign out" variant="outlined" testID="more-sign-out" onPress={() => void signOut()} />
      <Text variant="caption" tone="secondary">
        {mobileBrandName()} {APP_VERSION}
      </Text>
    </Screen>
  )
}
