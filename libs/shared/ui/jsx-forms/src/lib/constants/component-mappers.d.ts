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
import type { ComponentMapper } from '../vendor/data-driven-forms';
export declare const componentMapper: ComponentMapper;
export declare const simpleComponentMapper: {
    select: import("@aglyn/shared-ui-jsx-forms").FieldComponentMap;
    "sub-form": import("@aglyn/shared-ui-jsx-forms").FieldComponentMap;
    switch: import("@aglyn/shared-ui-jsx-forms").FieldComponentMap;
    "text-field": import("@aglyn/shared-ui-jsx-forms").FieldComponentMap;
    textarea: import("@aglyn/shared-ui-jsx-forms").FieldComponentMap;
};
export declare const dateTimeComponentMapper: {
    "time-picker": import("@aglyn/shared-ui-jsx-forms").FieldComponentMap;
    "date-picker": import("@aglyn/shared-ui-jsx-forms").FieldComponentMap;
};
export declare const optionComponentMapper: {
    select: import("@aglyn/shared-ui-jsx-forms").FieldComponentMap;
    switch: import("@aglyn/shared-ui-jsx-forms").FieldComponentMap;
    radio: import("@aglyn/shared-ui-jsx-forms").FieldComponentMap;
    checkbox: import("@aglyn/shared-ui-jsx-forms").FieldComponentMap;
    "dual-list-select": import("@aglyn/shared-ui-jsx-forms").FieldComponentMap;
};
export declare const pickerComponentMapper: {
    "time-picker": import("@aglyn/shared-ui-jsx-forms").FieldComponentMap;
    "date-picker": import("@aglyn/shared-ui-jsx-forms").FieldComponentMap;
    "icon-picker": import("@aglyn/shared-ui-jsx-forms").FieldComponentMap;
    "color-picker": import("@aglyn/shared-ui-jsx-forms").FieldComponentMap;
};
