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
import { type TextFieldProps as MuiTextFieldProps } from '@mui/material';
import { type UseFieldApiConfig } from '../vendor/data-driven-forms';
export type TextareaProps = MuiTextFieldProps & UseFieldApiConfig & {
    isReadOnly?: boolean;
    isDisabled?: boolean;
    isRequired?: boolean;
    description?: JSX.Node;
    validateOnMount?: boolean;
};
declare const TextareaComponent: import("react").ForwardRefExoticComponent<(Omit<import("@mui/material").FilledTextFieldProps & UseFieldApiConfig & {
    isReadOnly?: boolean;
    isDisabled?: boolean;
    isRequired?: boolean;
    description?: JSX.Node;
    validateOnMount?: boolean;
}, "ref"> | Omit<import("@mui/material").OutlinedTextFieldProps & UseFieldApiConfig & {
    isReadOnly?: boolean;
    isDisabled?: boolean;
    isRequired?: boolean;
    description?: JSX.Node;
    validateOnMount?: boolean;
}, "ref"> | Omit<import("@mui/material").StandardTextFieldProps & UseFieldApiConfig & {
    isReadOnly?: boolean;
    isDisabled?: boolean;
    isRequired?: boolean;
    description?: JSX.Node;
    validateOnMount?: boolean;
}, "ref">) & import("react").RefAttributes<any>>;
export default TextareaComponent;
