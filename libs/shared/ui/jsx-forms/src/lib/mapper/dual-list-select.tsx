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

/**
 * Ported from `@data-driven-forms/mui-component-mapper` (Apache-2.0) and
 * updated for the current MUI APIs (Grid `size`, `ListItemButton` instead of
 * the removed `ListItem button` prop).
 */

import type { ReactNode } from 'react'

import {
  Button,
  type ButtonProps,
  Checkbox,
  FormControl,
  type FormControlProps,
  FormHelperText,
  type FormHelperTextProps,
  FormLabel,
  type FormLabelProps,
  Grid,
  type GridProps,
  IconButton,
  type IconButtonProps,
  List,
  ListItem,
  ListItemButton,
  type ListItemButtonProps,
  ListItemIcon,
  type ListItemIconProps,
  ListItemText,
  type ListItemTextProps,
  type ListProps,
  Paper,
  type PaperProps,
  TextField,
  type TextFieldProps,
  Toolbar,
  type ToolbarProps,
  Typography,
  type TypographyProps,
} from '@mui/material'
import { styled } from '@mui/material/styles'

import SortIcon from '@mui/icons-material/ArrowUpward'

import clsx from 'clsx'

import DualListSelectCommon from '@data-driven-forms/common/dual-list-select'

import FormFieldGrid from './form-field-grid'
import { type ExtendedFieldMeta, validationError } from './validation-error'

const PREFIX = 'DualListSelectWrapper'

const classes = {
  allToLeftIcon: `${PREFIX}-allToLeftIcon`,
  upsideDown: `${PREFIX}-upsideDown`,
  list: `${PREFIX}-list`,
  button: `${PREFIX}-button`,
  buttonsGrid: `${PREFIX}-buttonsGrid`,
  filter: `${PREFIX}-filter`,
  toolbar: `${PREFIX}-toolbar`,
}

const StyledDualListSelect = styled(FormFieldGrid)(({ theme }) => ({
  [`& .${classes.allToLeftIcon}`]: {
    transform: 'scaleX(-1)',
  },

  [`& .${classes.upsideDown}`]: {
    transform: 'scaleY(-1)',
  },

  [`& .${classes.list}`]: {
    height: 300,
    overflow: 'auto',
  },

  [`& .${classes.button}`]: {
    display: 'flex',
    justifyContent: 'center',
    margin: theme.spacing(0.5, 0),
  },

  [`& .${classes.buttonsGrid}`]: {
    height: '100%',
    alignContent: 'center',
  },

  [`& .${classes.filter}`]: {
    width: '100%',
  },

  [`& .${classes.toolbar}`]: {
    paddingLeft: 16,
    paddingRight: 16,
  },
}))

interface ListOption {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  value: any
  label: string
  icon?: ReactNode
  isCheckbox?: boolean
  secondaryActions?: ReactNode
  ListItemProps?: ListItemButtonProps
  ListItemIconProps?: ListItemIconProps
  ListItemTextProps?: ListItemTextProps
}

interface ListInternalProps {
  value?: ListOption[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  optionClick: (e: any, value: any) => void
  noOptionsTitle: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  filterValue: any
  filterValueText: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  selectedValues: any[]
  ListProps?: ListProps
  ListItemProps?: ListItemButtonProps
  ListItemIconProps?: ListItemIconProps
  ListItemTextProps?: ListItemTextProps
  checkboxVariant?: boolean
  PaperProps?: PaperProps
  LeftPaperProps?: PaperProps
}

const ListInternal = ({
  value = [],
  optionClick,
  noOptionsTitle,
  filterValue,
  filterValueText,
  selectedValues,
  ListProps = {},
  ListItemProps,
  ListItemIconProps,
  ListItemTextProps,
  checkboxVariant,
  PaperProps,
  LeftPaperProps,
}: ListInternalProps) => (
  <Paper
    {...PaperProps}
    {...LeftPaperProps}
    className={clsx(
      PaperProps && PaperProps.className,
      LeftPaperProps && LeftPaperProps.className,
    )}
  >
    <List
      component="div"
      role="list"
      dense
      {...ListProps}
      className={clsx(classes.list, ListProps.className)}
    >
      {value.length < 1 && (
        <ListItemButton disabled {...ListItemProps}>
          <ListItemText primary={filterValue ? filterValueText : noOptionsTitle} />
        </ListItemButton>
      )}
      {value.length > 0 &&
        value.map(
          ({
            value,
            label,
            icon,
            isCheckbox,
            secondaryActions,
            ListItemProps: ListItemPropsItem,
            ListItemIconProps: ListItemIconPropsItem,
            ListItemTextProps: ListItemTextPropsItem,
          }) => (
            <ListItem
              key={value}
              disablePadding
              {...(secondaryActions && { secondaryAction: secondaryActions })}
            >
              <ListItemButton
                selected={selectedValues.includes(value)}
                onClick={(e) =>
                  optionClick(
                    isCheckbox || checkboxVariant ? { ...e, ctrlKey: true } : e,
                    value,
                  )
                }
                sx={{ cursor: 'pointer' }}
                {...ListItemProps}
                {...ListItemPropsItem}
              >
                {(icon || isCheckbox || checkboxVariant) && (
                  <ListItemIcon {...ListItemIconProps} {...ListItemIconPropsItem}>
                    {isCheckbox || checkboxVariant ? (
                      <Checkbox
                        edge="start"
                        checked={selectedValues.includes(value)}
                        tabIndex={-1}
                        disableRipple
                      />
                    ) : (
                      icon
                    )}
                  </ListItemIcon>
                )}
                <ListItemText
                  primary={label}
                  {...ListItemTextProps}
                  {...ListItemTextPropsItem}
                />
              </ListItemButton>
            </ListItem>
          ),
        )}
    </List>
  </Paper>
)

interface ToolbarInternalProps {
  ToolbarProps?: ToolbarProps
  LeftToolbarProps?: ToolbarProps
  filterOptions: (value: string) => void
  filterOptionsTitle: string
  FilterFieldProps?: TextFieldProps
  sortOptions: () => void
  SortIconButtonProps?: IconButtonProps
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  SortIconProps?: any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  LeftSortIconProps?: any
  LeftFilterFieldProps?: TextFieldProps
  LeftSortIconButtonProps?: IconButtonProps
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  filter: any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sortDesc: any
  isValue?: boolean
}

const ToolbarInternal = ({
  ToolbarProps,
  LeftToolbarProps,
  filterOptions,
  filterOptionsTitle,
  FilterFieldProps,
  sortOptions,
  SortIconButtonProps,
  SortIconProps,
  LeftSortIconProps,
  LeftFilterFieldProps,
  LeftSortIconButtonProps,
  filter,
  sortDesc,
  isValue = false,
}: ToolbarInternalProps) => (
  <Toolbar
    variant="dense"
    {...ToolbarProps}
    {...LeftToolbarProps}
    className={clsx(
      classes.toolbar,
      ToolbarProps && ToolbarProps.className,
      LeftToolbarProps && LeftToolbarProps.className,
    )}
  >
    <TextField
      aria-label={isValue ? 'value-search' : 'options-search'}
      label={filterOptionsTitle}
      onChange={({ target: { value } }) => filterOptions(value)}
      value={filter}
      type="search"
      {...FilterFieldProps}
      {...LeftFilterFieldProps}
      className={clsx(
        classes.filter,
        FilterFieldProps && FilterFieldProps.className,
        LeftFilterFieldProps && LeftFilterFieldProps.className,
      )}
    />
    <IconButton
      aria-label={isValue ? 'sort value' : 'sort options'}
      edge="end"
      onClick={sortOptions}
      color="inherit"
      {...SortIconButtonProps}
      {...LeftSortIconButtonProps}
      size="large"
    >
      <SortIcon
        {...SortIconProps}
        {...LeftSortIconProps}
        className={clsx(
          !sortDesc && classes.upsideDown,
          SortIconProps && SortIconProps.className,
          LeftSortIconProps && LeftSortIconProps.className,
        )}
      />
    </IconButton>
  </Toolbar>
)

export interface DualListSelectProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handleOptionsClick: (e: any, value: any) => void
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rightValues: any[]
  noValueTitle?: string
  filterValueText?: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  leftValues: any[]
  noOptionsTitle?: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  state: any
  filterOptionsText?: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handleValuesClick: (e: any, value: any) => void
  handleMoveRight: () => void
  moveRightTitle?: string
  handleClearLeftValues: () => void
  moveAllRightTitle?: string
  handleClearRightValues: () => void
  moveAllLeftTitle?: string
  handleMoveLeft: () => void
  moveLeftTitle?: string
  allToRight?: boolean
  allToLeft?: boolean
  checkboxVariant?: boolean
  isRequired?: boolean
  meta: ExtendedFieldMeta
  validateOnMount?: boolean
  label?: string
  helperText?: string
  description?: string
  filterOptionsTitle?: string
  leftTitle?: string
  filterOptions: (value: string) => void
  sortOptions: () => void
  sortValues: () => void
  filterValueTitle?: string
  filterValues: (value: string) => void
  rightTitle?: string
  isFilterable?: boolean
  // MUI component props
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  FormFieldGridProps?: any
  InternalGridProps?: GridProps
  ListGridProps?: GridProps
  LeftListGridProps?: GridProps
  ListProps?: ListProps
  LeftListProps?: ListProps
  ButtonsGridProps?: GridProps
  ButtonsInternalGridProps?: GridProps
  ButtonGridProps?: GridProps
  ToRightGridProps?: GridProps
  IconButtonProps?: ButtonProps
  ToRightIconButtonProps?: ButtonProps
  AllToRightGridProps?: GridProps
  AllToRightIconButtonProps?: ButtonProps
  AllToLeftGridProps?: GridProps
  AllToLeftIconButtonProps?: ButtonProps
  ToLeftGridProps?: GridProps
  ToLeftIconButtonProps?: ButtonProps
  RightListGridProps?: GridProps
  RightListProps?: ListProps
  ListItemProps?: ListItemButtonProps
  ListItemIconProps?: ListItemIconProps
  ListItemTextProps?: ListItemTextProps
  LeftListItemProps?: ListItemButtonProps
  LeftListItemIconProps?: ListItemIconProps
  LeftItemTextProps?: ListItemTextProps
  RightListItemProps?: ListItemButtonProps
  RightListItemIconProps?: ListItemIconProps
  RightItemTextProps?: ListItemTextProps
  FormControlProps?: FormControlProps
  FormLabelProps?: FormLabelProps
  FormHelperTextProps?: FormHelperTextProps
  TitleProps?: TypographyProps
  ToolbarProps?: ToolbarProps
  FilterFieldProps?: TextFieldProps
  SortIconButtonProps?: IconButtonProps
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  SortIconProps?: any
  LeftToolbarProps?: ToolbarProps
  LeftFilterFieldProps?: TextFieldProps
  LeftSortIconButtonProps?: IconButtonProps
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  LeftSortIconProps?: any
  LeftTitleProps?: TypographyProps
  RightToolbarProps?: ToolbarProps
  RightFilterFieldProps?: TextFieldProps
  RightSortIconButtonProps?: IconButtonProps
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  RightSortIconProps?: any
  RightTitleProps?: TypographyProps
  PaperProps?: PaperProps
  LeftPaperProps?: PaperProps
  RightPaperProps?: PaperProps
}

const DualListSelect = ({
  handleOptionsClick,
  rightValues,
  noValueTitle = 'No selected',
  filterValueText = 'Remove your filter to see all selected',
  leftValues,
  noOptionsTitle = 'No available options',
  state,
  filterOptionsText = 'Remove your filter to see all options',
  handleValuesClick,
  handleMoveRight,
  moveRightTitle = 'Move selected to right',
  handleClearLeftValues,
  moveAllRightTitle = 'Move all to right',
  handleClearRightValues,
  moveAllLeftTitle = 'Move all to left',
  handleMoveLeft,
  moveLeftTitle = 'Move selected to left',
  allToRight = true,
  allToLeft = true,
  checkboxVariant,
  isRequired,
  meta,
  validateOnMount,
  label,
  helperText,
  description,
  filterOptionsTitle = 'Filter options',
  leftTitle = 'Options',
  filterOptions,
  sortOptions,
  sortValues,
  filterValueTitle = 'Filter selected value',
  filterValues,
  rightTitle = 'Selected',
  isFilterable = true,
  // Props
  FormFieldGridProps,
  InternalGridProps,
  ListGridProps,
  LeftListGridProps,
  ListProps,
  LeftListProps,
  ButtonsGridProps,
  ButtonsInternalGridProps,
  ButtonGridProps,
  ToRightGridProps,
  IconButtonProps,
  ToRightIconButtonProps,
  AllToRightGridProps,
  AllToRightIconButtonProps,
  AllToLeftGridProps,
  AllToLeftIconButtonProps,
  ToLeftGridProps,
  ToLeftIconButtonProps,
  RightListGridProps,
  RightListProps,
  ListItemProps,
  ListItemIconProps,
  ListItemTextProps,
  LeftListItemProps,
  LeftListItemIconProps,
  LeftItemTextProps,
  RightListItemProps,
  RightListItemIconProps,
  RightItemTextProps,
  FormControlProps,
  FormLabelProps,
  FormHelperTextProps,
  TitleProps,
  ToolbarProps,
  FilterFieldProps,
  SortIconButtonProps,
  SortIconProps,
  LeftToolbarProps,
  LeftFilterFieldProps,
  LeftSortIconButtonProps,
  LeftSortIconProps,
  LeftTitleProps,
  RightToolbarProps,
  RightFilterFieldProps,
  RightSortIconButtonProps,
  RightSortIconProps,
  RightTitleProps,
  PaperProps,
  LeftPaperProps,
  RightPaperProps,
}: DualListSelectProps) => {
  const invalid = validationError(meta, validateOnMount)
  const text =
    invalid ||
    ((meta.touched || validateOnMount) && meta.warning) ||
    helperText ||
    description

  return (
    <StyledDualListSelect {...FormFieldGridProps}>
      <FormControl
        fullWidth
        required={isRequired}
        error={!!invalid}
        component="fieldset"
        {...FormControlProps}
      >
        <FormLabel component="legend" {...FormLabelProps}>
          {label}
        </FormLabel>
        <Grid container {...InternalGridProps}>
          <Grid size={{ xs: 12, md: 5 }} {...ListGridProps} {...LeftListGridProps}>
            {leftTitle && (
              <Typography
                variant="h6"
                gutterBottom
                {...TitleProps}
                {...LeftTitleProps}
              >
                {leftTitle}
              </Typography>
            )}
            {isFilterable && (
              <ToolbarInternal
                ToolbarProps={ToolbarProps}
                LeftToolbarProps={LeftToolbarProps}
                filterOptions={filterOptions}
                filterOptionsTitle={filterOptionsTitle}
                FilterFieldProps={FilterFieldProps}
                sortOptions={sortOptions}
                SortIconButtonProps={SortIconButtonProps}
                SortIconProps={SortIconProps}
                LeftSortIconProps={LeftSortIconProps}
                LeftFilterFieldProps={LeftFilterFieldProps}
                LeftSortIconButtonProps={LeftSortIconButtonProps}
                filter={state.filterOptions}
                sortDesc={state.sortLeftDesc}
              />
            )}
            <ListInternal
              optionClick={handleOptionsClick}
              value={leftValues}
              noOptionsTitle={noOptionsTitle}
              filterValue={state.filterOptions}
              filterValueText={filterOptionsText}
              selectedValues={state.selectedLeftValues}
              checkboxVariant={checkboxVariant}
              ListProps={{ ...ListProps, ...LeftListProps }}
              ListItemProps={{ ...ListItemProps, ...LeftListItemProps }}
              ListItemIconProps={{ ...ListItemIconProps, ...LeftListItemIconProps }}
              ListItemTextProps={{ ...ListItemTextProps, ...LeftItemTextProps }}
              PaperProps={PaperProps}
              LeftPaperProps={LeftPaperProps}
            />
          </Grid>
          <Grid size={{ xs: 12, md: 2 }} {...ButtonsGridProps}>
            <Grid
              container
              {...ButtonsInternalGridProps}
              className={clsx(
                classes.buttonsGrid,
                ButtonsInternalGridProps && ButtonsInternalGridProps.className,
              )}
            >
              {allToRight && (
                <Grid
                  size={{ md: 12, sm: 3 }}
                  {...ButtonGridProps}
                  {...AllToRightGridProps}
                  className={clsx(
                    classes.button,
                    ButtonGridProps && ButtonGridProps.className,
                    AllToRightGridProps && AllToRightGridProps.className,
                  )}
                >
                  <Button
                    variant="outlined"
                    size="small"
                    disabled={leftValues.length === 0}
                    onClick={handleClearLeftValues}
                    aria-label={moveAllRightTitle}
                    {...IconButtonProps}
                    {...AllToRightIconButtonProps}
                  >
                    &#8811;
                  </Button>
                </Grid>
              )}
              <Grid
                size={{ md: 12, sm: 3 }}
                {...ButtonGridProps}
                {...ToRightGridProps}
                className={clsx(
                  classes.button,
                  ButtonGridProps && ButtonGridProps.className,
                  ToRightGridProps && ToRightGridProps.className,
                )}
              >
                <Button
                  variant="outlined"
                  size="small"
                  disabled={leftValues.length === 0}
                  onClick={handleMoveRight}
                  aria-label={moveRightTitle}
                  {...IconButtonProps}
                  {...ToRightIconButtonProps}
                >
                  &gt;
                </Button>
              </Grid>
              <Grid
                size={{ md: 12, sm: 3 }}
                {...ButtonGridProps}
                {...ToLeftGridProps}
                className={clsx(
                  classes.button,
                  ButtonGridProps && ButtonGridProps.className,
                  ToLeftGridProps && ToLeftGridProps.className,
                )}
              >
                <Button
                  variant="outlined"
                  size="small"
                  disabled={rightValues.length === 0}
                  onClick={handleMoveLeft}
                  aria-label={moveLeftTitle}
                  {...IconButtonProps}
                  {...ToLeftIconButtonProps}
                >
                  &lt;
                </Button>
              </Grid>
              {allToLeft && (
                <Grid
                  size={{ md: 12, sm: 3 }}
                  {...ButtonGridProps}
                  {...AllToLeftGridProps}
                  className={clsx(
                    classes.button,
                    ButtonGridProps && ButtonGridProps.className,
                    AllToLeftGridProps && AllToLeftGridProps.className,
                  )}
                >
                  <Button
                    variant="outlined"
                    size="small"
                    disabled={rightValues.length === 0}
                    onClick={handleClearRightValues}
                    aria-label={moveAllLeftTitle}
                    {...IconButtonProps}
                    {...AllToLeftIconButtonProps}
                  >
                    &#8810;
                  </Button>
                </Grid>
              )}
            </Grid>
          </Grid>
          <Grid size={{ xs: 12, md: 5 }} {...ListGridProps} {...RightListGridProps}>
            {rightTitle && (
              <Typography
                variant="h6"
                gutterBottom
                {...TitleProps}
                {...RightTitleProps}
              >
                {rightTitle}
              </Typography>
            )}
            {isFilterable && (
              <ToolbarInternal
                ToolbarProps={ToolbarProps}
                LeftToolbarProps={RightToolbarProps}
                filterOptions={filterValues}
                filterOptionsTitle={filterValueTitle}
                FilterFieldProps={FilterFieldProps}
                sortOptions={sortValues}
                SortIconButtonProps={SortIconButtonProps}
                SortIconProps={SortIconProps}
                LeftSortIconProps={RightSortIconProps}
                LeftFilterFieldProps={RightFilterFieldProps}
                LeftSortIconButtonProps={RightSortIconButtonProps}
                filter={state.filterValue}
                sortDesc={state.sortRightDesc}
                isValue
              />
            )}
            <ListInternal
              checkboxVariant={checkboxVariant}
              optionClick={handleValuesClick}
              value={rightValues}
              noOptionsTitle={noValueTitle}
              filterValue={state.filterValue}
              filterValueText={filterValueText}
              selectedValues={state.selectedRightValues}
              ListProps={{ ...ListProps, ...RightListProps }}
              ListItemProps={{ ...ListItemProps, ...RightListItemProps }}
              ListItemIconProps={{ ...ListItemIconProps, ...RightListItemIconProps }}
              ListItemTextProps={{ ...ListItemTextProps, ...RightItemTextProps }}
              PaperProps={PaperProps}
              LeftPaperProps={RightPaperProps}
            />
          </Grid>
        </Grid>
        {text && (
          <FormHelperText {...FormHelperTextProps}>{text}</FormHelperText>
        )}
      </FormControl>
    </StyledDualListSelect>
  )
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const DualListSelectWrapper = (props: any) => (
  <DualListSelectCommon {...props} DualListSelect={DualListSelect} />
)

export default DualListSelectWrapper
