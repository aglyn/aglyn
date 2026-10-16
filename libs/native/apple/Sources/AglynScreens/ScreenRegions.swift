// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import Foundation

/// The countries a `country` field offers: the platform's own region list, named in the person's language, as the
/// console builds its picker from the browser's (`utils/country-options.ts`). A code is the two letters Stripe and
/// Stripe Tax expect; Stripe stays the validator.
enum ScreenRegions {
  /// Two-letter codes the platform names that are not countries a customer is billed in. Degrade-safe like the
  /// console's: one missing from this list shows one extra row that Stripe would refuse with a clear message.
  static let notCountries: Set<String> = ["EU", "EZ", "UN", "QO", "XA", "XB", "ZZ"]

  /// Every region the platform can name, as `(code, name)`, by name in the locale's order.
  static func choices(locale: Locale = .current) -> [(value: String, label: String)] {
    Locale.Region.isoRegions
      .map(\.identifier)
      .filter { $0.count == 2 && $0.allSatisfy { $0.isASCII && $0.isLetter } && !notCountries.contains($0) }
      .compactMap { code -> (value: String, label: String)? in
        // A code the platform cannot name is echoed back unchanged, which is the test.
        guard let name = locale.localizedString(forRegionCode: code), name != code else { return nil }
        return (code, name)
      }
      .sorted { $0.label.compare($1.label, options: [.caseInsensitive, .diacriticInsensitive], locale: locale) == .orderedAscending }
  }
}
