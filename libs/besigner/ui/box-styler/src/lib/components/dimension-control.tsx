/**
 * @license
 * Copyright 2023 Aglyn LLC
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
  buildCssMeasurement,
  CssUnit,
  isGlobalUnit,
  type Measurement,
  parseCssMeasurement,
} from '@aglyn/shared-data-enums'
import {
  Button,
  Collapse,
  FormControl,
  FormHelperText,
  IconButton,
  Input,
  InputAdornment,
  InputLabel,
  ListSubheader,
  Menu,
  MenuItem,
  Select,
  Stack,
  Tooltip,
} from '@mui/material'
import { observer } from 'mobx-react-lite'
import { useCallback, useEffect, useState } from 'react'

interface DimensionControlProps {
  dimension: string
  onChange?: (dimension: Measurement) => void
}

const cssUnits = Object.entries(CssUnit)
const buildLocalValue = (dimension: string) => ({
  raw: dimension,
  ...parseCssMeasurement(dimension),
})

export const DimensionControl = observer((props: DimensionControlProps) => {
  const { dimension, onChange } = props
  const [parsed, setParsed] = useState(buildLocalValue(dimension))
  useEffect(() => setParsed(buildLocalValue(dimension)), [dimension])
  const [menuOpen, setMenuOpen] = useState(false)
  const [iconRef, setIconRef] = useState<any>()
  const [btnRef, setBtnRef] = useState<any>()
  const toggleMenu = () => setMenuOpen((prev) => !prev)
  const handleChange = useCallback(
    (type: 'quantity' | 'unit') => (newValue: any) => {
      const res: any = {
        raw: undefined,
        quantity: undefined,
        unit: undefined,
      }
      switch (true) {
        case type === 'unit' && isGlobalUnit(newValue):
          res.raw = `${newValue}`
          res.quantity = undefined
          res.unit = newValue
          break
        case type === 'unit' && !newValue:
          res.raw = undefined
          res.quantity = undefined
          res.unit = undefined
          break
        case type === 'unit':
          res.raw = buildCssMeasurement({
            value: parsed.value,
            unit: newValue,
          })
          res.quantity = parsed.value
          res.unit = newValue
          break
        default:
          res.raw = buildCssMeasurement({
            value: newValue,
            unit: parsed.unit,
          })
          res.quantity = newValue
          res.unit = parsed.unit
          break
      }
      setParsed(res)
      onChange && onChange(res.raw)
      setMenuOpen(false)
    },
    [onChange, parsed],
  )

  const unitModifier = (
    <IconButton
      ref={setIconRef}
      onClick={toggleMenu}
      onMouseDown={(e) => e.preventDefault()}
      sx={{
        fontSize: `0.65rem`,
        padding: 0,
        borderRadius: `2px`,
      }}
    >
      {parsed.unit || 'default'}
    </IconButton>
  )

  return (
    <div>
      <FormControl sx={{ m: 0, width: '7ch' }} variant="standard">
        <Tooltip
          componentsProps={{ tooltip: { sx: { bgcolor: 'background.paper' } } }}
          title={
            <Stack direction="row" alignItems="center" justifyContent="center">
              <FormControl sx={{ w: 1, flexGrow: 1 }}>
                <InputLabel>Css Unit</InputLabel>
                <Select
                  // onClose={handleClose}
                  // onOpen={handleOpen}
                  // value={age}

                  label="Unit"
                  value={parsed?.unit || ''}
                  onChange={(e) => {
                    const val = e.target.value as string
                    if (val) handleChange('unit')(val)
                    else {
                      handleChange('unit')(undefined)
                      handleChange('quantity')(undefined)
                    }
                  }}
                  sx={{ '&': { minHeight: 'unset' } }}
                  inputProps={{
                    sx: { '&': { minHeight: 'unset', px: 1, py: 0.2 } },
                  }}
                  MenuProps={{ disablePortal: true }}
                >
                  <ListSubheader>{'Dimension Units'}</ListSubheader>
                  <MenuItem value={''}>
                    <em>{'default'}</em>
                  </MenuItem>
                  {cssUnits.map(([key, value]) => (
                    <MenuItem key={key} value={value}>
                      {key}
                    </MenuItem>
                  ))}
                </Select>
                <Collapse in={Boolean(parsed?.raw)}>
                  <FormControl sx={{ m: 1, width: '25ch' }} variant="filled">
                    <Input
                      type="text"
                      endAdornment={
                        <InputAdornment position="end">kg</InputAdornment>
                      }
                      inputProps={{
                        'aria-label': 'weight',
                      }}
                    />
                    <FormHelperText id="filled-weight-helper-text">
                      Weight
                    </FormHelperText>
                  </FormControl>
                </Collapse>
              </FormControl>
            </Stack>
          }
        >
          <Button
            onClick={toggleMenu}
            sx={{
              fontSize: (theme) => theme.typography.pxToRem(10),
              padding: 0,
              borderRadius: `2px`,
              minHeight: 'unset',
              minWidth: 'unset',
              // textTransform: 'unset',
            }}
          >
            {parsed.raw || 'default'}
          </Button>
        </Tooltip>

        {!parsed.unit || isGlobalUnit(parsed.unit) ? (
          unitModifier
        ) : (
          <Input
            value={parsed.value || ''}
            type={'number'}
            placeholder={'--'}
            onChange={(e) => handleChange('quantity')(e.target.value)}
            endAdornment={
              <InputAdornment position="end" sx={{ margin: 0 }}>
                {unitModifier}
              </InputAdornment>
            }
            sx={{
              padding: 0,
              fontSize: `0.65rem`,
              maxWidth: 50,
              paddingRight: 0,
              ':before': {
                border: 'none',
              },
              [`.MuiInput-input`]: {
                padding: 0,
                paddingRight: `2px !important`,
                textAlign: 'right',
              },
            }}
          />
        )}
        <Menu
          onClose={toggleMenu}
          open={menuOpen}
          anchorEl={iconRef}
          variant={'selectedMenu'}
        >
          <ListSubheader>{'Dimension Unit'}</ListSubheader>
          <MenuItem
            onClick={(event) => handleChange('unit')('')}
            selected={!parsed.unit}
          >
            <em>{'default'}</em>
          </MenuItem>
          {cssUnits.map(([key, value]) => (
            <MenuItem
              onClick={(event) => handleChange('unit')(value)}
              key={key}
              selected={value === parsed.unit}
            >
              {key}
            </MenuItem>
          ))}
        </Menu>
      </FormControl>
    </div>
  )
})
DimensionControl.displayName = 'DimensionControl'

export default DimensionControl
