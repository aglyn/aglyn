// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import Foundation

/// Whether a buyer moment (or the `texts` channel) is on in a store's
/// `buyerNotifications` map, ported from `buyerNotificationEnabled`: ONLY an
/// explicit `false` is off. An absent map, an absent key and a malformed value
/// all read as on, so a schema slip can never silence a store's messages.
public func buyerNotificationEnabled(_ settings: Any?, _ key: String) -> Bool {
  guard let settings = settings as? [String: Any] else { return true }
  guard let value = settings[key] as? NSNumber, CFGetTypeID(value) == CFBooleanGetTypeID() else { return true }
  return value.boolValue
}
