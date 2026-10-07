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

import { useWorkspace, type WorkspaceSite } from '@aglyn/mobile-core'
import { Button, EmptyState, ListRow, Notice, Screen, Skeleton, Text, useMobileTheme } from '@aglyn/mobile-ui'
import { ScrollView, View } from 'react-native'

/** Roles that may ring up a sale; the routes hold the rest (`managePos`, the `pos` entitlement). */
export function sitesThatCanSell(sites: readonly WorkspaceSite[]): WorkspaceSite[] {
  return sites.filter((site) => site.role === 'admin' || site.role === 'editor')
}

/**
 * Which store this device sells for (AGL-3618): the workspace, then one of
 * its sites the person may sell on. The pick is remembered on the device by
 * the foundation's switcher, per person.
 */
export function StorePicker(props: { onChosen: () => void; onSignOut: () => void }) {
  const theme = useMobileTheme()
  const workspace = useWorkspace()
  const sellable = sitesThatCanSell(workspace.sites)
  if (!workspace.ready) {
    return (
      <Screen>
        <Skeleton height={44} />
        <Skeleton height={44} />
      </Screen>
    )
  }
  return (
    <Screen padded={false}>
      <View style={{ padding: theme.space(2), gap: theme.space(1) }}>
        <Text variant="title">Choose the store</Text>
        <Text tone="secondary">This device rings up sales for the store you pick here.</Text>
        {workspace.error ? <Notice tone="error" message={workspace.error} /> : null}
      </View>
      {workspace.orgs.length > 1 ? (
        <ScrollView horizontal contentContainerStyle={{ gap: theme.space(1), paddingHorizontal: theme.space(2) }}>
          {workspace.orgs.map((org) => (
            <Button
              key={org.id}
              title={org.name}
              variant={org.id === workspace.org?.id ? 'contained' : 'outlined'}
              onPress={() => workspace.selectOrg(org.id)}
            />
          ))}
        </ScrollView>
      ) : null}
      {sellable.length ? (
        sellable.map((site) => (
          <ListRow
            key={site.id}
            testID={`store-${site.id}`}
            title={site.name}
            subtitle={site.subdomain || undefined}
            icon="storefront-outline"
            selected={site.id === workspace.site?.id}
            onPress={() => {
              workspace.selectSite(site.id)
              props.onChosen()
            }}
          />
        ))
      ) : (
        <EmptyState
          icon="storefront-outline"
          title="No store you can sell on"
          body="Ask the workspace owner for the Admin or Editor role on a site with Point of sale."
          action={<Button title="Sign out" variant="outlined" onPress={props.onSignOut} />}
        />
      )}
    </Screen>
  )
}
