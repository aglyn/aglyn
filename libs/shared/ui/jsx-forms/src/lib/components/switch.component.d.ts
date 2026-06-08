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
import { type FormControlLabelProps as MuiFormControlLabelProps, type FormControlProps as MuiFormControlProps, type FormGroupProps as MuiFormGroupProps, type FormHelperTextProps as MuiFormHelperTextProps, type FormLabelProps as MuiFormLabelProps, type SwitchProps as MuiSwitchProps } from '@mui/material';
import { type UseFieldApiConfig } from '../vendor/data-driven-forms';
export type SwitchBaseProps = MuiSwitchProps & UseFieldApiConfig;
export interface SwitchProps extends SwitchBaseProps {
    isReadOnly?: boolean;
    isDisabled?: boolean;
    isRequired?: boolean;
    label?: JSX.Node;
    helperText?: JSX.Node;
    description?: JSX.Node;
    validateOnMount?: boolean;
    onText?: JSX.Node;
    offText?: JSX.Node;
    FormControlProps?: MuiFormControlProps;
    FormGroupProps?: MuiFormGroupProps;
    FormControlLabelProps?: MuiFormControlLabelProps;
    SwitchProps?: MuiSwitchProps;
    FormLabelProps?: MuiFormLabelProps;
    FormHelperTextProps?: MuiFormHelperTextProps;
}
declare const SwitchComponent: import("react").ForwardRefExoticComponent<Omit<SwitchProps, "ref"> & import("react").RefAttributes<any>>;
export default SwitchComponent;
