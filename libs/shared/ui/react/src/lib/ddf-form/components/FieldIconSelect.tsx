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

import {
  SvgPathIcon,
  GridList,
  CardIconListItem,
  useMdiIcons,
  MdiIcon,
} from '@aglyn/shared/ui/react'

import { createStyles, Theme, WithStyles, withStyles } from '@aglyn/shared/ui/themes'

import useFieldApi from '@data-driven-forms/react-form-renderer/use-field-api'
import Button from '@mui/material/Button'
import ButtonBase from '@mui/material/ButtonBase'
import Collapse from '@mui/material/Collapse'
import Grid from '@mui/material/Grid'
import MuiTextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'

import clsx from 'clsx'
import { forwardRef, Fragment, HTMLProps, useCallback, useState } from 'react'

import { withGridItem } from '../field-hocs'
import { validationMessage } from '../utils'


const styles = (theme: Theme) => createStyles({
  root: {},
  button: {},
  icon: {},
  label: {},
  selected: {},
  preview: {'& $button': {fontSize: theme.typography.pxToRem(38)}},
  collapse: {height: 412},
  collapseInner: {
    paddingTop: theme.spacing(1),
    display: 'flex',
    flexDirection: 'column',
    flexGrow: 1,
    flexShrink: 0,
    alignSelf: 'stretch',
  },
  gridListWrapper: {
    height: '100%',
    marginTop: theme.spacing(1),
    border: `1px solid ${theme.palette.divider}`,
    borderRadius: theme.shape.borderRadius,
  },
  gridList: {
    padding: theme.spacing(1),
    // overflowX: 'hidden',
  },
})

export type Props = HTMLProps<HTMLDivElement> & {
  initialValue
}

const FieldIconSelect = forwardRef<any, Props & WithStyles<typeof styles>>(
  function RefRenderFn(props, ref) {
    const {
      classes,
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
    } = useFieldApi(props)
    const invalidMessage = validationMessage(meta, validateOnMount)
    const helpText = invalidMessage || ((meta.touched || validateOnMount) && meta.warning) || helperText || description
    const value = input.value
    const [open, setOpen] = useState(false)
    const [selected, setSelected] = useState(value)
    const [icons, {applyFilter}, allIcons] = useMdiIcons()
    const selectedIsSame = value === selected

    const handleButtonClick = useCallback(() => {
      setOpen(prev => !prev)
    }, [])
    const handleChooseButtonClick = useCallback(() => {
      input.onChange(selected)
      setOpen(prev => !prev)
    }, [selected])
    const handleFilterChange = useCallback((e) => {
      const value = e.currentTarget.value
      applyFilter(value)
    }, [])
    const handleItemClick = useCallback((e, item: MdiIcon) => {setSelected(item.id)}, [])
    const renderItemContent = useCallback((item) => {
      const isSelected = item.id === selected
      return (
        <CardIconListItem
          item={item}
          label={item.name}
          onActionClick={handleItemClick}
          preview={<SvgPathIcon iconId={item.id}/>}
          selected={isSelected}
        />
      )
    }, [selected, handleItemClick])

    return (
      <Fragment>
        <Grid ref={ref} className={clsx(classes.root, className)} container>
          <Grid spacing={2} container item>
            <Grid className={classes.preview} item>
              <ButtonBase
                className={classes.button}
                onClick={handleButtonClick}
                disableRipple
              >
                <SvgPathIcon className={classes.icon} fontSize="inherit" iconId={value}/>
              </ButtonBase>
            </Grid>
            <Grid item sm>
              <Typography component="div" variant="body1">
                {label}
              </Typography>
              <ButtonBase
                className={clsx(classes.button, classes.opener)}
                onClick={handleButtonClick}
                disableRipple
              >
                <span>Choose icon: <b>{(allIcons.byIconId[value] ?? {}).name ?? '(none)'}</b></span>
                <SvgPathIcon
                  className={classes.icon}
                  iconId={open ? 'chevron-up' : 'chevron-down'}
                />
              </ButtonBase>
            </Grid>
          </Grid>
          <Grid xs={12} item>
            <Collapse
              classes={{wrapperInner: classes.collapseInner, wrapper: classes.collapse}}
              in={open}
            >


              <Grid alignItems="center" spacing={2} container>
                <Grid xs={12} item>
                  <MuiTextField
                    onChange={handleFilterChange}
                    placeholder="Search icons..."
                    size={'small'}
                    fullWidth
                  />
                </Grid>
                <Grid item xs>
                  <Typography component="div" variant="body2">
                    Selected icon: <b>{(allIcons.byIconId[selected] ?? {}).name ?? '(none)'}</b>
                  </Typography>

                  {/* <MuiTextField
                   ref={ref}
                   {...input}
                   disabled={isDisabled}
                   error={Boolean(invalidMessage)}
                   helperText={helpText}
                   inputProps={{ readOnly: isReadOnly, ...inputProps }}
                   label={label}
                   placeholder={placeholder}
                   required={isRequired}
                   fullWidth
                   {...rest}
                   /> */}
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

              <div className={classes.gridListWrapper}>
                <GridList
                  GridContainerProps={{spacing: 2}}
                  GridItemProps={{xs: 6, sm: 3}}
                  ListWrapperProps={{className: classes.gridList}}
                  items={icons}
                  renderItemContent={renderItemContent}
                  {...GridListProps}
                />
              </div>
            </Collapse>
          </Grid>
        </Grid>
      </Fragment>
    )
  },
)

FieldIconSelect.displayName = 'FieldIconSelect'

export default withGridItem(
  withStyles(styles, {name: 'FieldIconSelect'})(FieldIconSelect),
)
