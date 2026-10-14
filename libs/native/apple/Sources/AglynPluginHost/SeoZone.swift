// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import SwiftUI

/// What the site's SEO page hands the widgets in its `hostSeo` zone (the console's `ConsoleHostSeoZoneProps`): the stored
/// `seo` settings, as the form was seeded with them, and the way to propose values for the form.
public struct SeoZone: @unchecked Sendable {
  /// The site's stored `seo` settings.
  public let seo: [String: Any]?
  /// Puts `values` in the SEO form as unsaved edits, keyed by the form's field names (`seo.title`, `seo.entity.description`,
  /// `seo.agent.whenToUse`). The same key twice applies once; the form's Save is the write.
  public let proposeDraft: @MainActor ([String: String], String) -> Void

  public init(seo: [String: Any]?, proposeDraft: @escaping @MainActor ([String: String], String) -> Void) {
    self.seo = seo
    self.proposeDraft = proposeDraft
  }
}

private struct SeoZoneKey: EnvironmentKey {
  static let defaultValue: SeoZone? = nil
}

extension EnvironmentValues {
  /// The SEO page's zone, while one of its widgets is drawn; nil anywhere else.
  public var seoZone: SeoZone? {
    get { self[SeoZoneKey.self] }
    set { self[SeoZoneKey.self] = newValue }
  }
}
