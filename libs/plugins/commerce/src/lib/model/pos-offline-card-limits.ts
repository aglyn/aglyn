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
 * The ceilings of cards taken offline on the app's own reader (AGL-4039), in
 * a module of their own with no imports: the commerce settings read them at
 * load, and pulling the offline register's model into the eager bundle for
 * two numbers would cost every console page.
 *
 * There is no small default: a store's own limit per sale and daily limit
 * per device are empty until it sets them, so offline cards run up to
 * Stripe's own ceiling per sale with no daily limit.
 */

/** How long cards may wait on a device before the register asks, more firmly, to reconnect. */
export const POS_OFFLINE_CARD_RECONNECT_WITHIN_MS = 24 * 60 * 60 * 1000

/** Stripe's own ceiling for one payment collected offline (10,000 USD). */
export const POS_OFFLINE_CARD_MAX_SALE_CENTS_LIMIT = 1_000_000
