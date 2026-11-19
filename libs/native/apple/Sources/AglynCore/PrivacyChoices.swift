// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import Foundation

/// "Your Privacy Choices" (Console chrome row 3; the owner's decision of 2026-11-19): the person's analytics choice, kept
/// on THIS device, never on the account. It is read before telemetry starts (`AglynFirebase.startTelemetry`) and applied
/// at once when the switch moves. With nothing stored the apps do what the build does today: a release build on
/// production sends Analytics; a debug build sends nothing whatever the choice. Crash reports are not part of it. The
/// Kotlin kit's `PrivacyChoices.kt`.
public enum PrivacyChoices {
  /// The device setting's key.
  public static let analyticsKey = "aglyn.privacyChoices.analytics"

  /// The stored choice; true (allowed) when the person never chose.
  public static func analyticsAllowed(_ defaults: UserDefaults = .standard) -> Bool {
    defaults.object(forKey: analyticsKey) as? Bool ?? true
  }

  /// Stores the choice on this device and applies it at once.
  public static func setAnalytics(_ allowed: Bool, _ defaults: UserDefaults = .standard) {
    defaults.set(allowed, forKey: analyticsKey)
    Telemetry.setAnalytics(allowed)
  }
}
