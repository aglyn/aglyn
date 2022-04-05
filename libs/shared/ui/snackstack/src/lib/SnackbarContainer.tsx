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

import {styled} from '@mui/material'
import clsx from 'clsx'
import {type FC, memo} from 'react'
import {type SnackbarProviderProps} from './types'
import {SNACKBAR_INDENTS} from './utils/constants'


const collapse = {
    // Material-UI 4.12.x and above uses MuiCollapse-root; earlier versions use
    // Mui-Collapse-container.  https://github.com/mui-org/material-ui/pull/24084
    container: '& > .MuiCollapse-container, & > .MuiCollapse-root',
    wrapper: '& > .MuiCollapse-container > .MuiCollapse-wrapper, & > .MuiCollapse-root > .MuiCollapse-wrapper',
};

const xsWidthMargin = 16;

const componentName = 'SnackbarContainer';

const classes = {
    root: `${componentName}-root`,
    rootDense: `${componentName}-rootDense`,
    top: `${componentName}-top`,
    bottom: `${componentName}-bottom`,
    left: `${componentName}-left`,
    right: `${componentName}-right`,
    center: `${componentName}-center`,
};

const Root = styled('div')(({ theme }) => ({
    [`&.${classes.root}`]: {
        boxSizing: 'border-box',
        display: 'flex',
        maxHeight: '100%',
        position: 'fixed',
        zIndex: theme.zIndex.snackbar,
        height: 'auto',
        width: 'auto',
        transition: 'top 300ms ease 0ms, right 300ms ease 0ms, bottom 300ms ease 0ms, left 300ms ease 0ms, margin 300ms ease 0ms, max-width 300ms ease 0ms',
        // container itself is invisible and should not block clicks, clicks should be passed to its children
        pointerEvents: 'none',
        [collapse.container]: {
            pointerEvents: 'all',
        },
        [collapse.wrapper]: {
            padding: `${SNACKBAR_INDENTS.snackbar.default}px 0px`,
            transition: 'padding 300ms ease 0ms',
        },
        maxWidth: `calc(100% - ${SNACKBAR_INDENTS.view.default * 2}px)`,
        [theme.breakpoints.down('sm')]: {
            width: '100%',
            maxWidth: `calc(100% - ${xsWidthMargin * 2}px)`,
        },
    },
    [`&.${classes.rootDense}`]: {
        [collapse.wrapper]: {
            padding: `${SNACKBAR_INDENTS.snackbar.dense}px 0px`,
        },
    },
    [`&.${classes.top}`]: {
        top: SNACKBAR_INDENTS.view.default - SNACKBAR_INDENTS.snackbar.default,
        flexDirection: 'column',
    },
    [`&.${classes.bottom}`]: {
        bottom: SNACKBAR_INDENTS.view.default - SNACKBAR_INDENTS.snackbar.default,
        flexDirection: 'column-reverse',
    },
    [`&.${classes.left}`]: {
        left: SNACKBAR_INDENTS.view.default,
        [theme.breakpoints.up('sm')]: {
            alignItems: 'flex-start',
        },
        [theme.breakpoints.down('sm')]: {
            left: `${xsWidthMargin}px`,
        },
    },
    [`&.${classes.right}`]: {
        right: SNACKBAR_INDENTS.view.default,
        [theme.breakpoints.up('sm')]: {
            alignItems: 'flex-end',
        },
        [theme.breakpoints.down('sm')]: {
            right: `${xsWidthMargin}px`,
        },
    },
    [`&.${classes.center}`]: {
        left: '50%',
        transform: 'translateX(-50%)',
        [theme.breakpoints.up('sm')]: {
            alignItems: 'center',
        },
    },
}));

interface SnackbarContainerProps {
    children: JSX.Element | JSX.Element[];
    className?: string;
    dense: SnackbarProviderProps['dense'];
    anchorOrigin: NonNullable<SnackbarProviderProps['anchorOrigin']>;
}

const SnackbarContainerRaw: FC<SnackbarContainerProps> = (props) => {
    const { className, anchorOrigin, dense, ...other } = props;

    const combinedClassname = clsx(
        classes[anchorOrigin.vertical],
        classes[anchorOrigin.horizontal],
        { [classes.rootDense]: dense },
        classes.root, // root should come after others to override maxWidth
        className,
    );

    return (
        <Root className={combinedClassname} {...other} />
    );
};
const SnackbarContainer = memo(SnackbarContainerRaw)

export {SnackbarContainer}
export default SnackbarContainer
