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
 * The workspace and site switcher (AGL-3620): the console's org and host
 * switchers as one screen. Picking a workspace shows its sites; picking a
 * site closes the switcher.
 */

import { mobileBrandName, useWorkspace } from '@aglyn/mobile-core'
import { Card, EmptyState, ListRow, Screen, Text } from '@aglyn/mobile-ui'
import { useNavigation } from '@react-navigation/native'

export function SwitcherScreen() {
  const workspace = useWorkspace()
  const navigation = useNavigation()

  if (workspace.ready && !workspace.orgs.length) {
    return (
      <Screen>
        <EmptyState
          icon="business-outline"
          title="No workspaces yet"
          body={`Create a workspace in the ${mobileBrandName()} console, then come back here.`}
        />
      </Screen>
    )
  }

  return (
    <Screen>
      <Card title="Workspace">
        {workspace.orgs.map((org) => (
          <ListRow
            key={org.id}
            testID={`switcher-org-${org.slug}`}
            icon="business-outline"
            title={org.name}
            subtitle={org.role || undefined}
            selected={org.id === workspace.org?.id}
            onPress={() => workspace.selectOrg(org.id)}
          />
        ))}
      </Card>
      <Card title="Site">
        {workspace.sites.length ? (
          workspace.sites.map((site) => (
            <ListRow
              key={site.id}
              testID={`switcher-site-${site.id}`}
              icon="globe-outline"
              title={site.name}
              subtitle={site.subdomain || undefined}
              selected={site.id === workspace.site?.id}
              onPress={() => {
                workspace.selectSite(site.id)
                if (navigation.canGoBack()) navigation.goBack()
              }}
            />
          ))
        ) : (
          <Text tone="secondary">This workspace has no sites you can open.</Text>
        )}
      </Card>
      {workspace.error ? <Text tone="error">{workspace.error}</Text> : null}
    </Screen>
  )
}
