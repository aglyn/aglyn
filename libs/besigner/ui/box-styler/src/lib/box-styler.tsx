/**
 * @license
 * Copyright 2022 Aglyn LLC
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
  Measurement,
  parseCssMeasurement,
} from '@aglyn/shared-data-enums'
import '@aglyn/shared-data-jsx'
import {
  alpha,
  darken,
  generateComponentClassKeys,
  styled,
} from '@aglyn/shared-ui-theme'
import {
  FormControl,
  IconButton,
  Input,
  InputAdornment,
  ListSubheader,
  Menu,
  MenuItem,
  Stack,
} from '@mui/material'
import clsx from 'clsx'
import { forwardRef, useCallback, useEffect, useMemo, useState } from 'react'

export const classKeys = generateComponentClassKeys('BoxStyler', [
  'box',
  'margin',
  'padding',
  'row',
  'node',
  'legendItem',
  'legendSwatch',
])

const Box = styled('div')(({ theme }) => {
  return {
    display: 'flex',
    flexDirection: 'column',
    borderRadius: 1,
    fontSize: '0.72rem',
    color: theme.palette.surface.contrastText,

    [`&.${classKeys.margin}, &.${classKeys.padding}`]: {
      flexShrink: 0.36,
    },
    [`&.${classKeys.node}`]: {
      flexShrink: 0.52,
    },
    [`> *`]: {
      width: '100%',
      textAlign: 'center',
    },

    [`&:not(.${classKeys.row})`]: {
      justifyContent: 'space-around',
    },
    [`&.${classKeys.row}`]: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    [`&.${classKeys.margin}`]: {
      height: 184,
      minWidth: 258,
      borderStyle: 'dashed',
      borderWidth: 1,
      borderColor: theme.palette.warning.dark,
      backgroundColor: alpha(theme.palette.surface.main, 0.96),
    },
    [`&.${classKeys.padding}`]: {
      height: 104,
      minWidth: 168,
      borderStyle: 'dashed',
      borderWidth: 1,
      borderColor: theme.palette.success.dark,
      backgroundColor: alpha(darken(theme.palette.surface.main, 0.12), 0.96),
    },
    [`&.${classKeys.node}`]: {
      minHeight: 24,
      minWidth: 78,
      maxWidth: 168,
      borderStyle: 'solid',
      borderWidth: 1,
      borderColor: theme.palette.info.dark,
      backgroundColor: alpha(darken(theme.palette.surface.main, 0.24), 0.96),
      // background: [
      //   'linear-gradient(',
      //   '65deg, ',
      //   `${alpha(theme.palette.tertiary.main, 0.59)}, `,
      //   `${alpha(theme.palette.secondary.main, 0.59)}`,
      //   ') border-box',
      // ].join(''),
    },
  }
})

interface DimensionControlProps {
  dimension: string
  onChange?: (dimension: Measurement) => void
}

const buildLocalValue = (dimension: string) => ({
  raw: dimension,
  ...parseCssMeasurement(dimension),
})

const DimensionControl = (props: DimensionControlProps) => {
  const { dimension, onChange } = props
  const [parsed, setParsed] = useState(buildLocalValue(dimension))
  useEffect(() => setParsed(buildLocalValue(dimension)), [dimension])
  const [menuOpen, setMenuOpen] = useState(false)
  const [iconRef, setIconRef] = useState<any>()
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
            quantity: parsed.quantity,
            unit: newValue,
          })
          res.quantity = parsed.quantity
          res.unit = newValue
          break
        default:
          res.raw = buildCssMeasurement({
            quantity: newValue,
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

  console.log('parsed', parsed)

  return (
    <div>
      <FormControl sx={{ m: 0, width: '7ch' }} variant="standard">
        {!parsed.unit || isGlobalUnit(parsed.unit) ? (
          unitModifier
        ) : (
          <Input
            value={parsed.quantity || ''}
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
          {Object.entries(CssUnit).map(([key, value]) => (
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
}

const Legend = styled(Stack)(({ theme }) => {
  return {
    [`.${classKeys.legendSwatch}`]: {
      borderStyle: 'solid',
      borderWidth: 1,
      content: '" "',
      width: 10,
      height: 10,
      [`&.${classKeys.margin}`]: {
        borderStyle: 'dashed',
        borderColor: theme.palette.warning.dark,
      },
      [`&.${classKeys.padding}`]: {
        borderStyle: 'dashed',
        borderColor: theme.palette.success.dark,
      },
      [`&.${classKeys.node}`]: {
        borderColor: theme.palette.info.dark,
      },
    },
  }
})

type BoxStylerWrapperProps = JSX.ComponentProps<typeof Box>
export type Measurements = {
  marginTop?: string
  marginLeft?: string
  marginRight?: string
  marginBottom?: string
  paddingTop?: string
  paddingLeft?: string
  paddingRight?: string
  paddingBottom?: string
}

export interface BoxStylerProps
  extends Omit<BoxStylerWrapperProps, 'onChange'> {
  measurements?: Measurements
  width?: Measurement
  height?: Measurement
  onChange?: (measurements?: Measurements) => void
}

const BoxStyler = forwardRef<any, BoxStylerProps>((props, ref) => {
  const {
    measurements: measurementsProp,
    width,
    height,
    onChange,
    ...rest
  } = props

  const measurements = useMemo<Measurements>(
    () => ({
      ...measurementsProp,
    }),
    [measurementsProp],
  )

  const handleChange =
    (key: keyof Measurements) => (dimension: Measurement) => {
      const res = { ...measurements, [key]: dimension }
      onChange && onChange(res)
    }

  const size = (dimension: any) => <span>{dimension?.quantity ?? '--'}</span>

  return (
    <Box ref={ref} {...rest}>
      <Box className={classKeys.margin}>
        <DimensionControl
          dimension={measurements?.marginTop}
          onChange={handleChange('marginTop')}
        />
        <Box className={classKeys.row}>
          <DimensionControl
            dimension={measurements?.marginLeft}
            onChange={handleChange('marginLeft')}
          />
          <Box className={classKeys.padding}>
            <DimensionControl
              dimension={measurements?.paddingTop}
              onChange={handleChange('paddingTop')}
            />
            <Box className={classKeys.row}>
              <DimensionControl
                dimension={measurements?.paddingLeft}
                onChange={handleChange('paddingLeft')}
              />
              <Box className={classKeys.node}>
                <Box className={classKeys.row}>
                  <span>Node</span>
                  {/*{size(width)}*/}
                  {/*{' x '}*/}
                  {/*{size(height)}*/}
                </Box>
              </Box>
              <DimensionControl
                dimension={measurements?.paddingRight}
                onChange={handleChange('paddingRight')}
              />
            </Box>
            <DimensionControl
              dimension={measurements?.paddingBottom}
              onChange={handleChange('paddingBottom')}
            />
          </Box>
          <DimensionControl
            dimension={measurements?.marginRight}
            onChange={handleChange('marginRight')}
          />
        </Box>
        <DimensionControl
          dimension={measurements?.marginBottom}
          onChange={handleChange('marginBottom')}
        />
      </Box>

      <Legend
        direction="row"
        alignItems="center"
        justifyContent="space-around"
        spacing={1}
        marginTop={0.5}
        marginBottom={1}
      >
        <Stack
          direction="row"
          alignItems="center"
          justifyContent="start"
          className={classKeys.legendItem}
          spacing={1}
        >
          <div className={clsx(classKeys.legendSwatch, classKeys.margin)} />
          <div>{'Margin'}</div>
        </Stack>
        <Stack
          direction="row"
          alignItems="center"
          justifyContent="start"
          className={classKeys.legendItem}
          spacing={1}
        >
          <div className={clsx(classKeys.legendSwatch, classKeys.padding)} />
          <div>{'Padding'}</div>
        </Stack>
        <Stack
          direction="row"
          alignItems="center"
          justifyContent="start"
          className={classKeys.legendItem}
          spacing={1}
        >
          <div className={clsx(classKeys.legendSwatch, classKeys.node)} />
          <div>{'Node'}</div>
        </Stack>
      </Legend>
    </Box>
  )
})
BoxStyler.displayName = 'BoxStyler'
BoxStyler.defaultProps = {}
BoxStyler.aglyn = true
export { BoxStyler }
export default BoxStyler
