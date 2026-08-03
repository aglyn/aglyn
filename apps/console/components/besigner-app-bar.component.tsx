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

import {
  AddControlsComponent,
  DevicePreviewControlsComponent,
  HistoryControlsComponent,
  PanelControlsComponent,
  SchemePreviewControlsComponent,
} from '@aglyn/besigner-ui'
import {
  ICON_VARIANT_APP_SETTINGS,
  ICON_VARIANT_MODIFY_SAVE,
  ICON_VARIANT_NEW_TAB,
  ICON_VARIANT_PAGES,
  ICON_VARIANT_SYMBOL_CONFIRMED,
} from '@aglyn/shared-data-enums'
import { AppLink, MdiIcon } from '@aglyn/shared-ui-jsx'
import { Button, type ButtonProps, Divider, Stack } from '@mui/material'
import { forwardRef } from 'react'
import SecondaryAppBarComponent, {
  type SecondaryAppBarProps,
} from './secondary-app-bar.component'

export interface BesignerAppBarProps extends SecondaryAppBarProps {
  detailsUrl: string
  liveUrl?: string
  onSave: ButtonProps['onClick']
  onPreview?: ButtonProps['onClick']
  onPropertiesEdit?: ButtonProps['onClick']
  saveAvailable?: boolean
  /** Current-document indicator/switcher (see BesignerDocumentSwitcher). */
  documentSwitcher?: JSX.Children
}

export const BesignerAppBarComponent = forwardRef<any, BesignerAppBarProps>(
  (props, ref) => {
    const {
      documentSwitcher,
      liveUrl,
      onPreview,
      onPropertiesEdit,
      onSave,
      saveAvailable,
    } = props

    return (
      <SecondaryAppBarComponent
        ref={ref}
        tabBarTitle={
          <Button
            size="small"
            color="primary"
            onClick={onPropertiesEdit}
            endIcon={
              <MdiIcon
                path={ICON_VARIANT_APP_SETTINGS.path}
                fontSize={'small'}
              />
            }
          >
            {'Properties'}
          </Button>
        }
      >
        <Stack
          direction="row"
          spacing={1}
          sx={{
            alignItems: "center",
            justifyContent: "space-between",
            flexGrow: 1
          }}>
          <AddControlsComponent />
          {documentSwitcher}
          <HistoryControlsComponent sx={{ flexGrow: 1 }} />
          <SchemePreviewControlsComponent />
          <DevicePreviewControlsComponent />
          {/*<InteractControlsComponent />*/}
          <PanelControlsComponent />
          <Divider
            orientation="vertical"
            sx={(theme) => ({
              ml: `${theme.spacing(2)} !important`,
              opacity: 0.5,
            })}
            flexItem
          />
          <AppLink
            componentVariant="button"
            href={liveUrl || ''}
            target="_blank"
            rel="noopener noreferrer"
            size="small"
            color="primary"
            disabled={!liveUrl}
            endIcon={<MdiIcon path={ICON_VARIANT_PAGES.path} />}
          >
            {'Live'}
          </AppLink>
          <Button
            onClick={onPreview}
            size="small"
            color="primary"
            endIcon={<MdiIcon path={ICON_VARIANT_NEW_TAB.path} />}
          >
            {'Preview'}
          </Button>
          <Button
            onClick={onSave}
            size="small"
            disabled={!saveAvailable}
            endIcon={
              <MdiIcon
                path={
                  saveAvailable
                    ? ICON_VARIANT_MODIFY_SAVE.path
                    : ICON_VARIANT_SYMBOL_CONFIRMED.path
                }
              />
            }
            sx={(theme) => ({ mr: `${theme.spacing(-1)} !important` })}
          >
            {saveAvailable ? 'Save' : 'Up to date'}
          </Button>
        </Stack>
      </SecondaryAppBarComponent>
    );
  },
)
BesignerAppBarComponent.displayName = 'BesignerAppBarComponent'

export default BesignerAppBarComponent
