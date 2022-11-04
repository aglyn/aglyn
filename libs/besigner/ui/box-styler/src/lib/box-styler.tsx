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
  StackProps,
} from '@mui/material'
import { emphasize } from '@mui/system/colorManipulator'
import clsx from 'clsx'
import { forwardRef, useCallback, useEffect, useMemo, useState } from 'react'

export const classKeys = generateComponentClassKeys('BoxStyler', [
  'box',
  'row',
  'label',
  'margin',
  'padding',
  'contents',
  'legendItem',
  'legendSwatch',
  'legendLabel',
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
    [`&:not(.${classKeys.row})`]: {
      justifyContent: 'space-around',
    },
    [`&.${classKeys.row}`]: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    [`> *`]: {
      width: '100%',
      textAlign: 'center',
    },
    [`&.${classKeys.contents}`]: {
      // flexShrink: 0.52,
      position: 'relative',
      minHeight: 24,
      minWidth: 78,
      maxWidth: 168,
      borderStyle: 'solid',
      borderWidth: 1,
      borderColor: theme.palette.info.dark,
      color: theme.palette.getContrastText(
        alpha(darken(theme.palette.surface.main, 0.26), 0.12),
      ),
      backgroundColor: alpha(darken(theme.palette.surface.main, 0.26), 0.12),

      ':before': {
        content: '""',
        position: 'absolute',
        left: '-0.09em',
        top: '-0.29em',
        width: '0',
        height: '0.5em',
        background: 'transparent',
        borderRight: `0.5em solid ${alpha(theme.palette.info.dark, 0.36)}`,
        borderBottom: '0.5em solid transparent',
        borderTop: '0.5em solid transparent',
        transform: 'rotate(45deg)',
      },
    },
    [`&.${classKeys.margin}`]: {
      position: 'relative',
      height: 184,
      minWidth: 258,
      borderStyle: 'dashed',
      borderWidth: 1,
      borderColor: theme.palette.warning.dark,
      backgroundColor: alpha(theme.palette.surface.main, 0.96),
      color: theme.palette.getContrastText(
        alpha(theme.palette.surface.main, 0.96),
      ),

      [`> .${classKeys.label}`]: {
        borderColor: theme.palette.warning.dark,
        backgroundColor: alpha(
          emphasize(theme.palette.warning.dark, 0.36),
          0.12,
        ),

        ':before': {
          borderRightColor: alpha(theme.palette.warning.dark, 0.36),
        },
      },
    },
    [`&.${classKeys.padding}`]: {
      position: 'relative',
      height: 104,
      minWidth: 168,
      padding: 2,
      borderStyle: 'dashed',
      borderWidth: 1,
      borderColor: theme.palette.success.dark,
      backgroundColor: alpha(darken(theme.palette.surface.main, 0.12), 0.96),
      color: theme.palette.getContrastText(
        alpha(darken(theme.palette.surface.main, 0.12), 0.96),
      ),
      background: [
        'linear-gradient(',
        '65deg, ',
        `${alpha(theme.palette.tertiary.main, 0.12)}, `,
        `${alpha(theme.palette.secondary.main, 0.12)}`,
        ') content-box',
      ].join(''),

      [`> .${classKeys.label}`]: {
        borderColor: theme.palette.success.dark,
        backgroundColor: alpha(
          emphasize(theme.palette.success.dark, 0.36),
          0.12,
        ),

        ':before': {
          borderRightColor: alpha(theme.palette.success.dark, 0.36),
        },
      },
    },
    [`.${classKeys.label}`]: {
      width: 'auto',
      position: 'absolute',
      textAlign: 'left',
      left: 0,
      top: 0,
      paddingLeft: theme.spacing(0.5),
      paddingRight: theme.spacing(0.5),
      paddingTop: theme.spacing(0.25),
      paddingBottom: theme.spacing(0.25),
      borderBottom: `1px solid ${theme.palette.text.secondary}`,
      borderRight: `1px solid ${theme.palette.text.secondary}`,
      color: theme.palette.getContrastText(
        alpha(theme.palette.surface.main, 0.76),
      ),
      backgroundColor: alpha(emphasize(theme.palette.surface.main, 0.36), 0.12),

      ':before': {
        content: '""',
        position: 'absolute',
        left: '-0.09em',
        top: '-0.29em',
        width: '0',
        height: '0.5em',
        background: 'transparent',
        borderRight: `0.5em solid ${alpha(theme.palette.surface.main, 0.36)}`,
        borderBottom: '0.5em solid transparent',
        borderTop: '0.5em solid transparent',
        transform: 'rotate(45deg)',
      },
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

interface MarginStylerProps extends MarginMeasurements {
  onChange: (key: keyof Measurements) => (dimension: Measurement) => void
  children?: JSX.Children
}

const MarginStyler = (props: MarginStylerProps) => {
  const {
    marginTop,
    marginRight,
    marginBottom,
    marginLeft,
    onChange,
    children,
  } = props

  return (
    <Box className={classKeys.margin}>
      <div className={classKeys.label}>{'Margin'}</div>
      <DimensionControl
        dimension={marginTop}
        onChange={onChange('marginTop')}
      />
      <Box className={classKeys.row}>
        <DimensionControl
          dimension={marginLeft}
          onChange={onChange('marginLeft')}
        />

        {children}

        <DimensionControl
          dimension={marginRight}
          onChange={onChange('marginRight')}
        />
      </Box>
      <DimensionControl
        dimension={marginBottom}
        onChange={onChange('marginBottom')}
      />
    </Box>
  )
}

interface PaddingStylerProps extends PaddingMeasurements {
  onChange: (key: keyof Measurements) => (dimension: Measurement) => void
  children?: JSX.Children
}

const PaddingStyler = (props: PaddingStylerProps) => {
  const {
    paddingTop,
    paddingRight,
    paddingBottom,
    paddingLeft,
    onChange,
    children,
  } = props

  return (
    <Box className={classKeys.padding}>
      <div className={classKeys.label}>{'Padding'}</div>
      <DimensionControl
        dimension={paddingTop}
        onChange={onChange('paddingTop')}
      />
      <Box className={classKeys.row}>
        <DimensionControl
          dimension={paddingLeft}
          onChange={onChange('paddingLeft')}
        />

        {children}

        <DimensionControl
          dimension={paddingRight}
          onChange={onChange('paddingRight')}
        />
      </Box>
      <DimensionControl
        dimension={paddingBottom}
        onChange={onChange('paddingBottom')}
      />
    </Box>
  )
}

const Contents = () => {
  // const size = (dimension: any) => <span>{dimension?.quantity ?? '--'}</span>

  return (
    <Box className={classKeys.contents}>
      <Box className={classKeys.row}>
        <span>Contents</span>
        {/*{size(width)}*/}
        {/*{' x '}*/}
        {/*{size(height)}*/}
      </Box>
    </Box>
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
    },
    [`.${classKeys.margin}`]: {
      [`.${classKeys.legendSwatch}`]: {
        borderStyle: 'dashed',
        borderColor: theme.palette.warning.dark,
      },
    },
    [`.${classKeys.padding}`]: {
      [`.${classKeys.legendSwatch}`]: {
        borderStyle: 'dashed',
        borderColor: theme.palette.success.dark,
      },
    },
    [`.${classKeys.contents}`]: {
      [`.${classKeys.legendSwatch}`]: {
        borderStyle: 'solid',
        borderColor: theme.palette.info.dark,
      },
    },
    [`.${classKeys.legendLabel}`]: {
      color: theme.palette.text.secondary,
      textTransform: 'capitalize',
    },
  }
})

interface LegendItemProps extends Partial<StackProps> {
  item: 'margin' | 'padding' | 'contents'
}
const LegendItem = (props: LegendItemProps) => {
  const { item, className, ...rest } = props

  return (
    <Stack
      direction="row"
      alignItems="center"
      justifyContent="start"
      className={clsx(
        classKeys.legendItem,
        { [classKeys[item]]: Boolean(classKeys[item]) },
        className,
      )}
      spacing={1}
      {...rest}
    >
      <div className={classKeys.legendSwatch} />
      <div className={classKeys.legendLabel}>{item}</div>
    </Stack>
  )
}

type BoxStylerWrapperProps = JSX.ComponentProps<typeof Box>

export type PaddingMeasurements = Partial<
  Pick<
    CSSStyleDeclaration,
    'paddingTop' | 'paddingRight' | 'paddingBottom' | 'paddingLeft'
  >
>
export type MarginMeasurements = Partial<
  Pick<
    CSSStyleDeclaration,
    'marginTop' | 'marginRight' | 'marginBottom' | 'marginLeft'
  >
>

export type Measurements = PaddingMeasurements & MarginMeasurements

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

  return (
    <Box ref={ref} {...rest}>
      <MarginStyler
        onChange={handleChange}
        marginTop={measurements?.marginTop}
        marginRight={measurements?.marginRight}
        marginBottom={measurements?.marginBottom}
        marginLeft={measurements?.marginLeft}
      >
        <PaddingStyler
          onChange={handleChange}
          paddingTop={measurements?.paddingTop}
          paddingRight={measurements?.paddingRight}
          paddingBottom={measurements?.paddingBottom}
          paddingLeft={measurements?.paddingLeft}
        >
          <Contents />
        </PaddingStyler>
      </MarginStyler>

      <Legend
        direction="row"
        alignItems="center"
        justifyContent="space-around"
        spacing={1}
        marginTop={1}
        marginBottom={2}
      >
        <LegendItem item={'margin'} />
        <LegendItem item={'padding'} />
        <LegendItem item={'contents'} />
      </Legend>
    </Box>
  )
})
BoxStyler.displayName = 'BoxStyler'
BoxStyler.defaultProps = {}
BoxStyler.aglyn = true
export { BoxStyler }
export default BoxStyler
