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

import { NavigationDrawerComponent } from '@aglyn/shared-ui-jsx'
import { mdiClose } from '@aglyn/shared-data-mdi'
import { MdiIcon } from '@aglyn/shared-ui-jsx'
import { alpha, createStyles, withStyles } from '@aglyn/shared-ui-theme'
import { _isStrT } from '@aglyn/shared-util-tools'
import { objectRemap } from '@aglyn/shared-util-tools'
import { Box, Button } from '@mui/material'
import Container from '@mui/material/Container'
import IconButton from '@mui/material/IconButton'
import LinearProgress from '@mui/material/LinearProgress'
import Typography from '@mui/material/Typography'
import {
  ChangeEventHandler,
  forwardRef,
  Fragment,
  MouseEventHandler,
} from 'react'
import FieldSet from '../components/FieldSet'
import { Fields } from '../forms'

export const drawerFormViewStyles = (theme) =>
  createStyles({
    closeButton: { marginRight: theme.spacing(2) },
    pt2: { paddingTop: theme.spacing(2) },
    wrapper: { position: 'relative' },
    loadingBar: {
      position: 'absolute',
      backgroundColor: alpha(theme.palette.primary.main, 0.86),
      top: 0,
      left: 0,
      width: '100%',
    },
  })

export type FormVariant = 'creating' | 'updating'

export interface DrawerFormViewProps {
  // extends ExtendPropsOfWithStyles<Partial<NavigationDrawerProps>, typeof drawerFormViewStyles> {
  id: string
  fields: Fields.FieldGroup
  label: string
  open: boolean
  formVariant: FormVariant

  loading?: boolean
  error?: string | boolean
  onClose: MouseEventHandler
  onSave: MouseEventHandler<HTMLButtonElement>
  onUpdate: (
    fieldId: string,
  ) => ChangeEventHandler<HTMLTextAreaElement | HTMLInputElement>
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
      <NavigationDrawerComponent
        ref={ref}
        appBarLeft={
          <Fragment>
            <IconButton
              className={classes.closeButton}
              color="default"
              edge="start"
              onClick={onClose}
            >
              {<MdiIcon path={mdiClose.path} />}
            </IconButton>
            <Typography
              component="div"
              variant="h6"
              sx={{
                color: 'inherit',
              }}
            >{`${actionLabel} ${label}`}</Typography>
          </Fragment>
        }
        appBarRight={
          <Button
            color="secondary"
            disabled={loading}
            variant="contained"
            onClick={onSave}
          >
            {actionLabel}
          </Button>
        }
        open={open}
        onClose={onClose}
        {...rest}
      >
        <div className={classes.wrapper}>
          {loading && (
            <Fragment>
              <LinearProgress
                classes={{ root: classes.loadingBar }}
                color="secondary"
              />
            </Fragment>
          )}

          <Container>
            <br />
            {error && (_isStrT(error) ? error : 'Error loading...')}
            {!error && (
              <Fragment>
                <Typography variant="subtitle2">{'Unique ID'}</Typography>
                <Typography variant="subtitle1">{id ?? '(none)'}</Typography>
                <FieldSet
                  fields={fields}
                  loading={loading}
                  onUpdate={onUpdate}
                />
                <Box
                  sx={{
                    mt: 2,
                  }}
                >
                  <Typography variant="subtitle2">{'JSON Output'}</Typography>
                  <Box
                    sx={{
                      bgcolor: 'background.default',
                      mt: 1,
                      overflow: 'scroll',
                      px: 1,
                    }}
                  >
                    <pre>
                      {JSON.stringify(
                        objectRemap(fields, (f) => f.value ?? ''),
                        null,
                        2,
                      )}
                    </pre>
                  </Box>
                </Box>
              </Fragment>
            )}
          </Container>
        </div>
      </NavigationDrawerComponent>
    )
  },
)

export default withStyles(drawerFormViewStyles, { name: 'DrawerFormView' })(
  DrawerFormView,
)
