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
import { type UseFieldApiConfig } from '@data-driven-forms/react-form-renderer';
import { type ToggleButtonGroupProps, type ToggleButtonProps as MuiToggleButtonProps } from '@mui/material';
export type ToggleButtonProps = UseFieldApiConfig & {
    ToggleButtonProps?: Partial<MuiToggleButtonProps>;
    ToggleButtonGroupProps?: Partial<ToggleButtonGroupProps>;
};
export declare const ToggleButtonComponent: {
    (props: ToggleButtonProps): import("react/jsx-runtime").JSX.Element;
    displayName: string;
};
export default ToggleButtonComponent;
