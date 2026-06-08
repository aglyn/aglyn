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
import { type ColorPickerProps as AglynColorPickerProps } from '@aglyn/besigner-ui-color-picker/color-picker';
import { type UseFieldApiComponentConfig } from '@data-driven-forms/react-form-renderer';
import { type FormControlProps as MuiFormControlProps, type GridProps, type PopperProps, type TextFieldProps } from '@mui/material';
type InternalColorPickerProps = Partial<TextFieldProps> & {
    FormFieldGridProps?: Partial<GridProps>;
    ColorPickerProps?: Partial<AglynColorPickerProps>;
    FormControlProps?: Partial<MuiFormControlProps>;
    PopperProps?: Partial<PopperProps>;
    presetColors?: string[];
};
export type ColorPickerProps = InternalColorPickerProps & UseFieldApiComponentConfig;
export declare const ColorPickerComponent: import("react").ForwardRefExoticComponent<(Omit<Partial<import("@mui/material").FilledTextFieldProps> & {
    FormFieldGridProps?: Partial<GridProps>;
    ColorPickerProps?: Partial<AglynColorPickerProps>;
    FormControlProps?: Partial<MuiFormControlProps>;
    PopperProps?: Partial<PopperProps>;
    presetColors?: string[];
} & UseFieldApiComponentConfig, "ref"> | Omit<Partial<import("@mui/material").OutlinedTextFieldProps> & {
    FormFieldGridProps?: Partial<GridProps>;
    ColorPickerProps?: Partial<AglynColorPickerProps>;
    FormControlProps?: Partial<MuiFormControlProps>;
    PopperProps?: Partial<PopperProps>;
    presetColors?: string[];
} & UseFieldApiComponentConfig, "ref"> | Omit<Partial<import("@mui/material").StandardTextFieldProps> & {
    FormFieldGridProps?: Partial<GridProps>;
    ColorPickerProps?: Partial<AglynColorPickerProps>;
    FormControlProps?: Partial<MuiFormControlProps>;
    PopperProps?: Partial<PopperProps>;
    presetColors?: string[];
} & UseFieldApiComponentConfig, "ref">) & import("react").RefAttributes<any>>;
export default ColorPickerComponent;
