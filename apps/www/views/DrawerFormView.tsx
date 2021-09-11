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

import { NavbarDrawer, NavbarDrawerProps, SvgPathIcon } from '@aglyn/shared/ui/react'
import { alpha, createStyles, ExtendPropsOfWithStyles, withStyles } from '@aglyn/shared/ui/themes'
import { _isStrT } from '@aglyn/shared/util/guards'
import { remap } from '@aglyn/shared/util/tools'
import { Box, Button } from '@mui/material'
import Container from '@mui/material/Container'
import IconButton from '@mui/material/IconButton'
import LinearProgress from '@mui/material/LinearProgress'
import Typography from '@mui/material/Typography'
import React, { forwardRef } from 'react'
import FieldSet from '../components/FieldSet'
import { Fields } from '../forms'


export const drawerFormViewStyles = (theme) => createStyles({
  closeButton: {marginRight: theme.spacing(2)},
  pt2: {paddingTop: theme.spacing(2)},
  wrapper: {position: 'relative'},
  loadingBar: {
    position: 'absolute',
    backgroundColor: alpha(theme.palette.primary.main, 0.86),
    top: 0,
    left: 0,
    width: '100%',
  },
})

export type FormVariant = 'creating' | 'updating'

export interface DrawerFormViewProps extends ExtendPropsOfWithStyles<Partial<NavbarDrawerProps>, typeof drawerFormViewStyles> {
  id: string,
  fields: Fields.FieldGroup
  label: string
  open: boolean
  formVariant: FormVariant,

  loading?: boolean
  error?: string | boolean
  onClose: React.MouseEventHandler
  onSave: React.MouseEventHandler<HTMLButtonElement>
  onUpdate: (fieldId: string) => React.ChangeEventHandler<HTMLTextAreaElement | HTMLInputElement>
}

const DrawerFormView = forwardRef<any, DrawerFormViewProps>(
  function RefRenderFn(props, ref) {
    const {
      id,
      fields,
      open,
      loading,
      error,
      formVariant = 'creating',
      label,
      onClose,
      onSave,
      onUpdate,
      classes,
      ...rest
    } = props

    const isCreating = formVariant === 'creating'
    const actionLabel = isCreating ? 'Create' : 'Update'

    return (
      <NavbarDrawer
        ref={ref}
        appBarLeft={
          <React.Fragment>
            <IconButton
              children={<SvgPathIcon iconId="close"/>}
              className={classes.closeButton}
              color="default"
              edge="start"
              onClick={onClose}
            />
            <Typography
              children={`${actionLabel} ${label}`}
              color="inherit"
              component="div"
              variant="h6"
            />
          </React.Fragment>
        }
        appBarRight={
          <Button
            children={actionLabel}
            color="secondary"
            disabled={loading}
            variant="contained"
            onClick={onSave}
          />
        }
        open={open}
        onClose={onClose}
        {...rest}
      >
        <div className={classes.wrapper}>
          {loading && (
            <React.Fragment>
              <LinearProgress classes={{root: classes.loadingBar}} color="secondary"/>
            </React.Fragment>
          )}


          <Container>
            <br/>
            {error && (_isStrT(error) ? error : 'Error loading...')}
            {!error && (
              <React.Fragment>
                <Typography
                  children={'Unique ID'}
                  variant="subtitle2"
                />
                <Typography
                  children={id ?? '(none)'}
                  variant="subtitle1"
                />
                <FieldSet fields={fields} loading={loading} onUpdate={onUpdate}/>
                <Box mt={2}>
                  <Typography
                    children={'JSON Output'}
                    variant="subtitle2"
                  />
                  <Box
                    bgcolor="background.default"
                    mt={1}
                    overflow="scroll"
                    px={1}
                  >
                  <pre>
                    {JSON.stringify(remap(fields, f => f.value ?? ''), null, 2)}
                  </pre>
                  </Box>
                </Box>
              </React.Fragment>
            )}
          </Container>
        </div>

      </NavbarDrawer>
    )
  },
)

export default withStyles(drawerFormViewStyles, {name: 'DrawerFormView'})(DrawerFormView)
