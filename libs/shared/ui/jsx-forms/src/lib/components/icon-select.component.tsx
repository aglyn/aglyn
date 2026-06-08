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

import { DEFAULT_ICON, type Icon, mdiChevronDown, mdiChevronUp } from '@aglyn/shared-data-mdi'
import { CardListItem, GridList, MdiIcon, useMdiIconsFuzzy } from '@aglyn/shared-ui-jsx'
import { generateComponentClassKeys, styled } from '@aglyn/shared-ui-theme'
import { useDebouncedCallback } from '@aglyn/shared-util-vendor'
import {
  Button,
  ButtonBase,
  Collapse,
  Grid,
  Link as MuiLink,
  TextField as MuiTextField,
  Tooltip,
  Typography,
} from '@mui/material'

import {
  forwardRef,
  type HTMLAttributes,
  useCallback,
  useMemo,
  useState,
} from 'react'
import { validationMessage } from '../utils/validation-message'

import {
  useFieldApi,
  type UseFieldApiConfig,
} from '../vendor/data-driven-forms'

const iconUnset = { ...DEFAULT_ICON, id: null, name: '(none)' }
const classKeys = generateComponentClassKeys('AglynIconSelect', [
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

const StyledCollapse = styled(Collapse, {
  name: 'AglynIconSelectCollapse',
})(({ theme }) => ({
  '& .MuiCollapse-wrapper': {
    height: 412,
  },
  '& .MuiCollapse-wrapperInner': {
    paddingTop: theme.spacing(1),
    display: 'flex',
    flexDirection: 'column',
    flexGrow: 1,
    flexShrink: 0,
    alignSelf: 'stretch',
  },
}))

const GridListWrapper = styled('div', {
  name: 'AglynIconSelectListWrapper',
})(({ theme }) => ({
  height: '100%',
  marginTop: theme.spacing(1),
  border: `1px solid ${theme.palette.divider}`,
  borderRadius: theme.shape.borderRadius,
  [`& .${classKeys.gridList}`]: {
    padding: theme.spacing(1),
    // overflowX: 'hidden',
  },
}))

export interface IconSelectProps extends HTMLAttributes<HTMLDivElement> {
  initialValue?: string
  classes?: Partial<typeof classKeys>
}

const IconSelectComponent = forwardRef<any, IconSelectProps>((props, ref) => {
  const {
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
    (meta.touched || validateOnMount) && meta.warning,
    helperText,
    description,
  ].find((i) => Boolean(i))

  const currentValue = input.value
  const [open, setOpen] = useState(false)
  const [icons, allIcons, applyFilter, clearFilter] = useMdiIconsFuzzy()
  const [selected, setSelected] = useState(() => currentValue)

  const [currentIcon, selectedIcon] = useMemo(() => {
    const findIcon = (id: string) => allIcons.find((icon) => icon.id === id)
    const currentIcon = (currentValue && findIcon(currentValue)) || iconUnset
    const selectedIcon = (selected && findIcon(selected)) || iconUnset
    return [currentIcon, selectedIcon]
  }, [currentValue, selected, allIcons])

  const handleButtonClick = useCallback(() => {
    setOpen((prev) => !prev)
  }, [setOpen])
  const handleChooseButtonClick = useCallback(() => {
    input.onChange(selected)
    setOpen((prev) => !prev)
  }, [input, selected])
  const updateFilter = useDebouncedCallback((value?: string) => {
    if (value) {
      applyFilter(value)
    } else {
      clearFilter()
    }
  }, 750)
  const handleFilterChange = useCallback(
    (e) => {
      const target = e.currentTarget
      if (target && target.value) {
        updateFilter(target.value)
      } else {
        updateFilter()
      }
    },
    [updateFilter],
  )
  const handleItemClick = useCallback(
    (e, item: Icon) => {
      setSelected(item.id)
    },
    [setSelected],
  )

  const renderItemContent = useCallback(
    function RenderItemContent(item, key) {
      return (
        <Tooltip
          key={item.key ?? item.id ?? key}
          title={item.name}
          disableInteractive
          enterDelay={375}
          enterNextDelay={745}
        >
          <CardListItem
            item={item}
            onActionClick={handleItemClick}
            selected={selected && selected === item.id}
            renderItem={
              <div>
                <MdiIcon fontSize="medium" path={item.path} />
              </div>
            }
          />
        </Tooltip>
      )
    },
    [selected, handleItemClick],
  )

  return (
    <Grid ref={ref} container>
      <Grid spacing={2} alignItems={'center'} container item>
        <Grid item>
          <ButtonBase
            onClick={handleButtonClick}
            disableRipple
            sx={(theme) => ({ fontSize: theme.typography.pxToRem(38) })}
            title={currentIcon.name || 'Choose icon'}
          >
            <MdiIcon fontSize="inherit" path={currentIcon.path} />
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
            <span>
              <MdiIcon
                fontSize="inherit"
                path={open ? mdiChevronUp.path : mdiChevronDown.path}
              />
            </span>
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
              <Button
                color="secondary"
                onClick={handleChooseButtonClick}
                variant="contained"
              >
                Choose
              </Button>
            </Grid>
          </Grid>

          <GridListWrapper>
            <GridList
              GridContainerProps={{ spacing: 1 }}
              GridItemProps={{ size: { xs: 2 } }}
              ListWrapperProps={{ className: classKeys.gridList }}
              items={icons}
              renderItemContent={renderItemContent}
              {...GridListProps}
            />
          </GridListWrapper>
        </StyledCollapse>
      </Grid>
    </Grid>
  )
})

IconSelectComponent.displayName = 'IconSelectComponent'
IconSelectComponent.aglyn = true

export default IconSelectComponent
