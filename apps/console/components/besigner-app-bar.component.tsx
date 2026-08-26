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
  ICON_VARIANT_MENU_DOWN,
  ICON_VARIANT_MODIFY_SAVE,
  ICON_VARIANT_NEW_TAB,
  ICON_VARIANT_PAGES,
  ICON_VARIANT_SYMBOL_CONFIRMED,
} from '@aglyn/shared-data-enums'
import { AppLink, MdiIcon } from '@aglyn/shared-ui-jsx'
import {
  Button,
  ButtonGroup,
  type ButtonProps,
  Divider,
  ListItemText,
  Menu,
  MenuItem,
  Stack,
  Tooltip,
} from '@mui/material'
import { forwardRef, useState } from 'react'
import SecondaryAppBarComponent, {
  type SecondaryAppBarProps,
} from './secondary-app-bar.component'

/**
 * Save, with the live outcome one click away (AGL-1152).
 *
 * A split button: the main half saves a draft — the default, and what an
 * author does dozens of times an hour — while the chevron offers `Save &
 * publish` for the moment they actually mean it. The alternative shapes were
 * both worse: one button that always publishes takes away the ability to save
 * work in progress, and a separate Publish item elsewhere in the UI is the
 * thing that made "I saved and nothing happened" possible.
 *
 * Falls back to a PLAIN button when no publish handler is given, so an editor
 * with no publish concept is unchanged rather than growing a dead chevron.
 */
function SaveControl(props: {
  onSave: ButtonProps['onClick']
  onSaveAndPublish?: () => void
  publishBlockedReason?: string
  saveAvailable?: boolean
}) {
  const { onSave, onSaveAndPublish, publishBlockedReason, saveAvailable } = props
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null)
  // NEVER DISABLED, however up to date the editor believes it is (AGL-1262).
  // A disabled Save is a dead control: the one time it matters — the editor's
  // idea of "saved" has drifted from the document — the author clicks it,
  // nothing happens, nothing is said, and they close the tab believing the
  // work landed. Clicking always produces an answer, and `handleSave` checks
  // the stored document before agreeing there is nothing to write.
  const label = saveAvailable ? 'Save draft' : 'Up to date'
  const icon = (
    <MdiIcon
      path={
        saveAvailable
          ? ICON_VARIANT_MODIFY_SAVE.path
          : ICON_VARIANT_SYMBOL_CONFIRMED.path
      }
    />
  )
  if (!onSaveAndPublish) {
    return (
      <Button
        onClick={onSave}
        size="small"
        endIcon={icon}
        sx={(theme) => ({ mr: `${theme.spacing(-1)} !important` })}
      >
        {label}
      </Button>
    )
  }
  return (
    <>
      <ButtonGroup
        size="small"
        variant="text"
        sx={(theme) => ({ mr: `${theme.spacing(-1)} !important` })}
      >
        <Button onClick={onSave} endIcon={icon}>
          {label}
        </Button>
        <Button
          aria-label="Save options"
          aria-haspopup="menu"
          onClick={(event) => setMenuAnchor(event.currentTarget)}
          sx={{ px: 0.5, minWidth: 0 }}
        >
          <MdiIcon path={ICON_VARIANT_MENU_DOWN.path} />
        </Button>
      </ButtonGroup>
      <Menu
        anchorEl={menuAnchor}
        open={Boolean(menuAnchor)}
        onClose={() => setMenuAnchor(null)}
      >
        <MenuItem
          onClick={(event) => {
            setMenuAnchor(null)
            onSave?.(event as never)
          }}
        >
          <ListItemText
            primary="Save draft"
            secondary="Keeps your work; the live site is unchanged"
          />
        </MenuItem>
        <MenuItem
          disabled={Boolean(publishBlockedReason)}
          onClick={() => {
            setMenuAnchor(null)
            onSaveAndPublish()
          }}
        >
          <ListItemText
            primary="Save & publish"
            secondary={publishBlockedReason ?? 'Saves, then updates the live site'}
          />
        </MenuItem>
      </Menu>
    </>
  )
}
SaveControl.displayName = 'SaveControl'

export interface BesignerAppBarProps extends SecondaryAppBarProps {
  detailsUrl: string
  liveUrl?: string
  /** Why there is no live URL (AGL-1271) — shown instead of a bare disabled button. */
  liveUnavailableReason?: string
  onSave: ButtonProps['onClick']
  /**
   * Save AND make it live, as one action (AGL-1152).
   *
   * The editor's Save writes a DRAFT — for a component that is the version
   * document, which the tenant does not read — so an author who saved and
   * watched their site not change had done nothing wrong. The old answer was a
   * separate `Publish again` buried in the File menu, which is a second action
   * for what reads as one intent.
   *
   * Draft saving stays for everyone: it is what co-editing and crash recovery
   * are built on, and a version is still the way to work on something without
   * touching the live site. This is only about making the LIVE outcome
   * reachable from the control the author is already using.
   *
   * Omitted where an editor has no publish concept, and the button then
   * renders exactly as it did before — no chevron, no menu.
   */
  onSaveAndPublish?: () => void
  /** Why publishing is unavailable, shown on the disabled menu item. */
  publishBlockedReason?: string
  onPreview?: ButtonProps['onClick']
  onPropertiesEdit?: ButtonProps['onClick']
  saveAvailable?: boolean
  /** Current-document indicator/switcher (see BesignerDocumentSwitcher). */
  documentSwitcher?: JSX.Children
  /**
   * Who else is in this document (AGL-675). Rendered inside the toolbar
   * rather than beside it: the screen editor passed `<PresenceAvatars />` as
   * a SIBLING of this app bar, so on the first day presence ever produced an
   * entry the avatars turned up as their own block under the toolbar, at the
   * far left. Nobody had seen it because presence had never rendered.
   */
  presence?: JSX.Children
}

export const BesignerAppBarComponent = forwardRef<any, BesignerAppBarProps>(
  (props, ref) => {
    const {
      documentSwitcher,
      liveUrl,
      liveUnavailableReason,
      presence,
      onPreview,
      onPropertiesEdit,
      onSave,
      onSaveAndPublish,
      publishBlockedReason,
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
          {/*
           * Presence leads the control group (AGL-2486). Zach: "We also
           * should probably move all of them to be before the theme mode
           * switcher."
           *
           * It also fixes the lopsided spacing he saw. Sitting last, the
           * cluster had the `Divider`'s `ml: spacing(2) !important` on its
           * right and only the Stack's own `spacing={1}` on its left — an
           * enormous right margin and a small left one, neither of them set
           * by the presence component. Ahead of the group it is bounded by
           * that one Stack rule on both sides.
           */}
          {presence}
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
          <Tooltip title={!liveUrl && liveUnavailableReason ? liveUnavailableReason : ''}>
            {/* span: a disabled control emits no events for the tooltip */}
            <span>
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
            </span>
          </Tooltip>
          {/* Disabled without a handler (AGL-1203): components, layouts and
              templates rendered an enabled Preview button that silently did
              nothing, which reads as a broken feature rather than a missing
              one. All four kinds pass a handler now; this keeps any future
              besigner surface honest. */}
          <Button
            onClick={onPreview}
            disabled={!onPreview}
            size="small"
            color="primary"
            endIcon={<MdiIcon path={ICON_VARIANT_NEW_TAB.path} />}
          >
            {'Preview'}
          </Button>
          {/* Never disabled, however up to date the editor believes it is
              (AGL-1262). A disabled Save is a dead control: the one time it
              matters — the editor's idea of "saved" has drifted from the
              document — the author clicks it, nothing happens, nothing is
              said, and they close the tab believing the work landed. Clicking
              always produces an answer now, and `handleSave` checks the
              stored document before agreeing there is nothing to write. */}
          <SaveControl
            onSave={onSave}
            onSaveAndPublish={onSaveAndPublish}
            publishBlockedReason={publishBlockedReason}
            saveAvailable={saveAvailable}
          />
        </Stack>
      </SecondaryAppBarComponent>
    );
  },
)
BesignerAppBarComponent.displayName = 'BesignerAppBarComponent'

export default BesignerAppBarComponent
