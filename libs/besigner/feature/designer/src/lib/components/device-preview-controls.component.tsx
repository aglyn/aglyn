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

import { BesignerDeviceFlag } from '@aglyn/besigner'
import {
  ICON_VARIANT_FLUID_RESPONSIVE,
  ICON_VARIANT_LAPTOP,
  ICON_VARIANT_MENU_DOWN,
  ICON_VARIANT_MOBILE,
  ICON_VARIANT_MONITOR_LARGE,
  ICON_VARIANT_MONITOR_SMALL,
  ICON_VARIANT_SYMBOL_CONFIRMED,
  ICON_VARIANT_TABLET,
} from '@aglyn/shared-data-enums'
import { MdiIcon, Menu, MenuProps } from '@aglyn/shared-ui-jsx'
import {
  Button as MuiButton,
  ButtonGroup as MuiButtonGroup,
  Tooltip as MuiTooltip,
} from '@mui/material'
import {
  forwardRef,
  type MouseEvent,
  useCallback,
  useMemo,
  useState,
} from 'react'
import useAglynBesignerFlag from '../hooks/use-aglyn-besigner-flag'

const devicePreviewOptions = [
  {
    children: 'Fluid Responsive',
    value: BesignerDeviceFlag.RESPONSIVE,
    icon: { path: ICON_VARIANT_FLUID_RESPONSIVE.path },
  },
  {
    children: 'XS - Mobile',
    value: BesignerDeviceFlag.XS,
    icon: { path: ICON_VARIANT_MOBILE.path },
  },
  {
    children: 'SM - Tablet',
    value: BesignerDeviceFlag.SM,
    icon: { path: ICON_VARIANT_TABLET.path },
  },
  {
    children: 'MD - Laptop',
    value: BesignerDeviceFlag.MD,
    icon: { path: ICON_VARIANT_LAPTOP.path },
  },
  {
    children: 'LG - Desktop',
    value: BesignerDeviceFlag.LG,
    icon: { path: ICON_VARIANT_MONITOR_SMALL.path },
  },
  {
    children: 'XL - Widescreen',
    value: BesignerDeviceFlag.XL,
    icon: { path: ICON_VARIANT_MONITOR_LARGE.path },
  },
]

export interface DevicePreviewControlsProps extends Partial<MenuProps> {}

const DevicePreviewControlsComponent = forwardRef<
  any,
  DevicePreviewControlsProps
>((props, ref) => {
  const { ...rest } = props

  const [devicePreview, setDevicePreview] =
    useAglynBesignerFlag('devicePreview')
  const [anchorEl, setAnchorEl] = useState<Element>(null)
  const [devicesMenuOpen, setDevicesMenuOpen] = useState(false)
  const activeDevice = useMemo(
    () =>
      devicePreviewOptions.find((i) => i.value === devicePreview) ||
      devicePreviewOptions[0],
    [devicePreview],
  )

  const handleMenuClose = useCallback((event: MouseEvent<HTMLElement>) => {
    setDevicesMenuOpen(false)
  }, [])
  const handleOpenMenu = useCallback((event: MouseEvent<HTMLElement>) => {
    setDevicesMenuOpen(true)
  }, [])
  const handleMenuClick =
    (device: BesignerDeviceFlag) => (event: MouseEvent<HTMLElement>) => {
      setDevicePreview(device)
      setDevicesMenuOpen(false)
    }

  return (
    <Menu
      ref={ref}
      id="aglyn:device-preview"
      onClick={handleMenuClose}
      horizontalOrigin="right"
      items={[
        {
          type: 'subheader',
          children: 'Artboard preview mode',
          sx: { lineHeight: (theme) => theme.typography.pxToRem(32) },
        },
        ...devicePreviewOptions.map((item) => ({
          key: item.value,
          selected: item.value === activeDevice.value,
          disabled: item.value === activeDevice.value,
          onClick: handleMenuClick(item.value),
          endIcon:
            item.value !== activeDevice.value
              ? undefined
              : {
                  path: ICON_VARIANT_SYMBOL_CONFIRMED.path,
                },
          ...item,
        })),
      ]}
      {...rest}
    >
      <MuiButtonGroup size="small" variant="outlined" color="inherit">
        <MuiTooltip title={'Device preview mode'}>
          <MuiButton
            aria-label="device preview mode"
            aria-haspopup="menu"
            aria-controls={devicesMenuOpen ? 'aglyn:device-preview' : undefined}
            aria-expanded={devicesMenuOpen ? 'true' : undefined}
            ref={setAnchorEl}
            onClick={handleOpenMenu}
            startIcon={<MdiIcon fontSize="inherit" {...activeDevice.icon} />}
            endIcon={
              <MdiIcon fontSize="inherit" path={ICON_VARIANT_MENU_DOWN.path} />
            }
            sx={{
              borderColor: 'divider',
              '& .MuiButton-endIcon': { ml: 0.15 },
              '& .MuiButton-startIcon': { mr: 0.85 },
            }}
          >
            {activeDevice.children}
          </MuiButton>
        </MuiTooltip>
      </MuiButtonGroup>
    </Menu>
  )
})
DevicePreviewControlsComponent.displayName = 'DevicePreviewControlsComponent'
DevicePreviewControlsComponent.aglyn = true

export { DevicePreviewControlsComponent }
export default DevicePreviewControlsComponent
