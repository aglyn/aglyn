// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore

/// The button of an upgrade notice that opens the plans screen, or nil where this build may not start a payment to
/// Aglyn (`StoreBilling.buying` is false in a store build): the notice keeps its sentence and shows no button.
func planUpgradeAction(buying: Bool = StoreBilling.buying, _ open: @escaping () -> Void) -> (() -> Void)? {
  buying ? open : nil
}
