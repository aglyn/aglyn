/**
 * @license
 * Copyright 2021 Aglyn LLC
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

import { getIcon, defaultIconFailover } from '@aglyn/shared-data-mdi'
import {
  generateComponentClassKeys,
  styled,
} from '@aglyn/shared-feature-themes'

import useFieldApi from '@data-driven-forms/react-form-renderer/use-field-api'
import { UseFieldApiConfig } from '@data-driven-forms/react-form-renderer/use-field-api/use-field-api'
import { Tooltip } from '@mui/material'
import Button from '@mui/material/Button'
import ButtonBase from '@mui/material/ButtonBase'
import MuiLink from '@mui/material/Link'
import Collapse from '@mui/material/Collapse'
import Grid from '@mui/material/Grid'
import MuiTextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'

import { forwardRef, Fragment, HTMLProps, useCallback, useMemo, useState } from 'react'
import { CardIconListItem } from '../../components/card-icon-list-item'
import { GridList } from '../../components/grid-list'
import { SvgPathIcon } from '../../components/svg-path-icon'
import { MdiIcon, useMdiIcons } from '../../hooks/use-mdi-icons'

import { withGridItem } from '../field-hocs'
import { validationMessage } from '../utils'


const iconUnset = {...defaultIconFailover, id: '', name: '(none)'}
const classKeys = generateComponentClassKeys('AglynFieldIconSelect', [
  'root',
  'button',
  'icon',
  'label',
  'selected',
  'opener',
  'preview',
  'collapse',
  'collapseInner',
  'gridListWrapper',
  'gridList',
])

const StyledCollapse = styled(Collapse)(({theme}) => ({
  ['& .MuiCollapse-wrapper']: {
    height: 412
  },
  ['& .MuiCollapse-wrapperInner']: {
    paddingTop: theme.spacing(1),
    display: 'flex',
    flexDirection: 'column',
    flexGrow: 1,
    flexShrink: 0,
    alignSelf: 'stretch',
  },
}))

const GridListWrapper = styled('div')(({theme}) => ({
  height: '100%',
  marginTop: theme.spacing(1),
  border: `1px solid ${theme.palette.divider}`,
  borderRadius: theme.shape.borderRadius,
  [`& .${classKeys.gridList}`]: {
    padding: theme.spacing(1),
    // overflowX: 'hidden',
  }
}))

export interface FieldIconSelectProps extends HTMLProps<HTMLDivElement> {
  initialValue
  classes?: Partial<typeof classKeys>
}

const FieldIconSelect = forwardRef<any, FieldIconSelectProps>(
  function RefRenderFn(props, ref) {
    const {
      className,
      input,
      isReadOnly,
      isDisabled,
      placeholder,
      isRequired,
      label,
      helperText,
      description,
      validateOnMount,
      meta,
      inputProps,
      GridListProps,
      ...rest
    } = useFieldApi(props as UseFieldApiConfig)

    const invalidMessage = validationMessage(meta, validateOnMount)
    const helperContent = [
      invalidMessage,
      ((meta.touched || validateOnMount) && meta.warning),
      helperText,
      description
    ].find((i) => Boolean(i))
    const currentValue = input.value
    const currentIcon = useMemo(() => {
      console.log('currentValue', currentValue)
      return currentValue
        ? getIcon(currentValue, {failoverIcon: iconUnset})
        : iconUnset
    }, [currentValue])
    const [open, setOpen] = useState(false)
    const [icons, applyFilter, clearFilter] = useMdiIcons()
    const [selected, setSelected] = useState(() => currentValue)
    const selectedIcon = useMemo(() => {
      console.log('selected', selected)
      return selected
        ? getIcon(selected, {failoverIcon: iconUnset})
        : iconUnset
    }, [selected, getIcon])


    const handleButtonClick = useCallback(() => {
      setOpen((prev) => !prev)
    }, [setOpen])
    const handleChooseButtonClick = useCallback(() => {
      input.onChange(selected)
      setOpen((prev) => !prev)
    }, [selected, setOpen])
    const handleFilterChange = useCallback((e) => {
      const target = e.currentTarget
      if (target && target.value) {applyFilter(target.value)}
      else {clearFilter()}
    }, [applyFilter, clearFilter])
    const handleItemClick = useCallback((e, item: MdiIcon) => {
      setSelected(item.id)
    }, [setSelected])
    const renderItemContent = useCallback(function RenderItemContent(item) {
      return (
        <Tooltip key={item.id} title={item.name} disableInteractive enterDelay={375} enterNextDelay={745}>
          <CardIconListItem
            item={item}
            onActionClick={handleItemClick}
            selected={selected && selected === item.id}
            preview={<SvgPathIcon fontSize="medium" iconIds={item.id} />}
          />
        </Tooltip>
      )
    }, [selected, handleItemClick])

    return (
      <Fragment>
        <Grid ref={ref} container>
          <Grid spacing={2} alignItems={"center"} container item>
            <Grid item>
              <ButtonBase
                onClick={handleButtonClick}
                disableRipple
                sx={(theme) => ({fontSize: theme.typography.pxToRem(38)})}
                title={currentIcon.name || 'Choose icon'}
              >
                <SvgPathIcon fontSize="inherit" iconIds={currentValue} />
              </ButtonBase>
            </Grid>
            <Grid item sm>
              <Typography component="div" variant="caption">
                {label}
              </Typography>
              <MuiLink
                onClick={handleButtonClick}
                variant="button"
                component="button"
                color="secondary"
                sx={{
                  display: 'flex',
                  flexDirection: 'row',
                  justifyContent: 'flex-start',
                }}
              >
                <span><SvgPathIcon iconIds={open ? 'chevron-up' : 'chevron-down'} /></span>
                <span>{currentIcon.name}</span>
              </MuiLink>
            </Grid>
          </Grid>
          <Grid xs={12} item>
            <StyledCollapse in={open}>
              <Grid alignItems="center" spacing={2} container>
                <Grid xs={12} item>
                  <MuiTextField
                    onChange={handleFilterChange}
                    placeholder="Search icons..."
                    size="small"
                    helperText={helperContent}
                    fullWidth
                  />
                </Grid>
                <Grid item xs>
                  <Typography component="div" variant="body2">
                    Selected icon: <b>{selectedIcon.name}</b>
                  </Typography>
                </Grid>
                <Grid item>
                  <Button color="secondary" onClick={handleChooseButtonClick} variant="contained">
                    Choose
                  </Button>
                </Grid>
              </Grid>

              <GridListWrapper>
                <GridList
                  GridContainerProps={{spacing: 1}}
                  GridItemProps={{xs: 2}}
                  ListWrapperProps={{className: classKeys.gridList}}
                  items={icons}
                  renderItemContent={renderItemContent}
                  {...GridListProps}
                />
              </GridListWrapper>
            </StyledCollapse>
          </Grid>
        </Grid>
      </Fragment>
    )
  },
)

FieldIconSelect.displayName = 'FieldIconSelect'

export default withGridItem(FieldIconSelect)
