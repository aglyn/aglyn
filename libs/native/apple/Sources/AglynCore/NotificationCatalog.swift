// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import Foundation

/// The member notification types, grouped by category, with each type's
/// label, console default and level: `notification-catalog.generated.json`,
/// generated from the console's own catalog
/// (`tools/scripts/generate-mobile-notification-catalog.mjs`), bundled here.
public struct NotificationCatalog: Decodable, Sendable {
  public struct Level: Decodable, Hashable, Sendable {
    public let id: String
    public let label: String
  }

  public struct Entry: Decodable, Hashable, Sendable, Identifiable {
    public let type: String
    public let label: String
    public let consoleDefault: Bool
    public let level: String
    public var id: String { type }
  }

  public struct Category: Decodable, Hashable, Sendable, Identifiable {
    public let id: String
    public let label: String
    public let types: [Entry]
  }

  public let levels: [Level]
  public let categories: [Category]

  /// The bundled catalog.
  public static let shared: NotificationCatalog = {
    guard let url = Bundle.module.url(forResource: "notification-catalog.generated", withExtension: "json"),
      let data = try? Data(contentsOf: url),
      let catalog = try? JSONDecoder().decode(NotificationCatalog.self, from: data)
    else { return NotificationCatalog(levels: [], categories: []) }
    return catalog
  }()

  public init(levels: [Level], categories: [Category]) {
    self.levels = levels
    self.categories = categories
  }

  public func entry(_ type: String?) -> Entry? {
    guard let type else { return nil }
    return categories.lazy.flatMap(\.types).first { $0.type == type }
  }

  /// A notification's level the way the console's `notificationLevel` reads
  /// it: the level its emitter stamped, else its type's level, else info.
  public func level(stamped: String?, type: String?) -> String {
    if let stamped, levels.contains(where: { $0.id == stamped }) { return stamped }
    return entry(type)?.level ?? "info"
  }
}

/// The account-scope push answer the settings screen shows for one type
/// (`accountPushSwitch` in `mobile-push.ts`): the account's push answer for
/// the type, then for its category; then its console answers in the same
/// order; then the legacy category mute; then the type's console default.
/// `settings` is `users/{uid}.notificationSettings` as read.
public func accountPushSwitch(
  settings: [String: Any]?, type: String, category: String, consoleDefault: Bool,
  legacyPrefs: [String: Any]? = nil
) -> Bool {
  let types = settings?["accountTypes"] as? [String: Any]
  let account = settings?["account"] as? [String: Any]
  func answer(_ scope: [String: Any]?, _ key: String, _ channel: String) -> Bool? {
    guard let value = (scope?[key] as? [String: Any])?[channel] as? NSNumber,
      CFGetTypeID(value) == CFBooleanGetTypeID()
    else { return nil }
    return value.boolValue
  }
  for channel in ["push", "console"] {
    if let value = answer(types, type, channel) ?? answer(account, category, channel) { return value }
  }
  if let mute = legacyPrefs?[category] as? NSNumber, CFGetTypeID(mute) == CFBooleanGetTypeID(), !mute.boolValue {
    return false
  }
  return consoleDefault
}
