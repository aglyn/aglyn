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
/*
 * The ids Bookings registers in the Aglyn app (AGL-3621). `plugins.config.json`
 * names each one under `bookings.mobile.contributes`, and the loader refuses
 * any registration it does not name.
 */

export const BOOKINGS_CALENDAR_SCREEN = 'bookings.calendar'
export const BOOKINGS_BOOKING_SCREEN = 'bookings.booking'

export const BOOKINGS_CALENDAR_TAB = 'bookings.calendar-tab'

export const BOOKINGS_TODAY_WIDGET = 'bookings.today'

export const BOOKINGS_TODAY_ACTION = 'bookings.today-action'

export const BOOKINGS_PAGE_LINK = 'bookings.page'
