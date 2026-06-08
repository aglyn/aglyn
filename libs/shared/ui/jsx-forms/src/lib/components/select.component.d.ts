/**
 * @license
 * Copyright 2023 Aglyn LLC
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
import { type FormControlProps as MuiFormControlProps, type MenuItemProps as MuiMenuItemProps, type SelectProps as MuiSelectProps } from '@mui/material';
import { type UseFieldApiConfig } from '../vendor/data-driven-forms';
export type SelectBaseProps = MuiSelectProps & UseFieldApiConfig;
export interface SelectProps extends SelectBaseProps {
    isReadOnly?: boolean;
    isDisabled?: boolean;
    isRequired?: boolean;
    description?: JSX.Node;
    validateOnMount?: boolean;
    FormControlProps?: Partial<MuiFormControlProps>;
    disableDefaultOption?: boolean;
    defaultOption?: MuiMenuItemProps;
}
export declare const SelectComponent: import("react").ForwardRefExoticComponent<SelectProps & import("react").RefAttributes<any>>;
export default SelectComponent;
