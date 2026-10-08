// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import Foundation

/// The channels the console's settings page edits per category and type.
public enum NotificationChannel: String, CaseIterable, Sendable, Identifiable {
  case console, email, push
  public var id: String { rawValue }

  public var label: String {
    switch self {
    case .console: "In the app"
    case .email: "Email"
    case .push: "Push"
    }
  }
}

/// Where an answer is stored: the account, one workspace, or one site.
public enum NotificationScope: Hashable, Sendable {
  case account
  case org(String)
  case host(String)
}

/// The console's notification settings, as its settings page reads and
/// writes them (`notifications.ts`): `users/{uid}.notificationSettings`
/// holds answers per channel at the account's categories and types and at
/// each workspace's and site's, and a missing answer inherits from the
/// layer above. The settings cases replay the TypeScript's answers.
public enum NotificationSettings {
  public static let field = "notificationSettings"
  public static let legacyField = "notificationPrefs"

  public static func categoryLayer(_ settings: [String: Any]?, _ scope: NotificationScope) -> [String: Any]? {
    switch scope {
    case .account: settings?["account"] as? [String: Any]
    case .org(let id): (settings?["orgs"] as? [String: Any])?[id] as? [String: Any]
    case .host(let id): (settings?["hosts"] as? [String: Any])?[id] as? [String: Any]
    }
  }

  public static func typeLayer(_ settings: [String: Any]?, _ scope: NotificationScope) -> [String: Any]? {
    switch scope {
    case .account: settings?["accountTypes"] as? [String: Any]
    case .org(let id): (settings?["orgTypes"] as? [String: Any])?[id] as? [String: Any]
    case .host(let id): (settings?["hostTypes"] as? [String: Any])?[id] as? [String: Any]
    }
  }

  static func layerPath(_ scope: NotificationScope, types: Bool) -> [String] {
    switch scope {
    case .account: [types ? "accountTypes" : "account"]
    case .org(let id): [types ? "orgTypes" : "orgs", id]
    case .host(let id): [types ? "hostTypes" : "hosts", id]
    }
  }

  /// A stored boolean, and only a boolean: a number is not an answer.
  private static func bool(_ value: Any?) -> Bool? {
    if let number = value as? NSNumber {
      return CFGetTypeID(number) == CFBooleanGetTypeID() ? number.boolValue : nil
    }
    return value as? Bool
  }

  /// A scope's own answer for a category, or nil to inherit (`notificationScopePref`).
  public static func scopePref(_ settings: [String: Any]?, _ scope: NotificationScope, category: String, _ channel: NotificationChannel) -> Bool? {
    bool((categoryLayer(settings, scope)?[category] as? [String: Any])?[channel.rawValue])
  }

  /// A scope's own answer for a type, or nil to inherit (`notificationScopeTypePref`).
  public static func scopeTypePref(_ settings: [String: Any]?, _ scope: NotificationScope, type: String, _ channel: NotificationChannel) -> Bool? {
    bool((typeLayer(settings, scope)?[type] as? [String: Any])?[channel.rawValue])
  }

  /// The account card's switch for a category: its answer, the legacy console mute, its default.
  public static func categoryValue(
    _ catalog: NotificationCatalog, _ settings: [String: Any]?, legacy: [String: Any]?, category: String,
    _ channel: NotificationChannel
  ) -> Bool {
    if let own = scopePref(settings, .account, category: category, channel) { return own }
    if channel == .console, bool(legacy?[category]) == false { return false }
    let defaults = catalog.categories.first { $0.id == category }?.channelDefaults
    return channel == .email ? (defaults?.email ?? false) : (defaults?.console ?? true)
  }

  /// One type at the account layer: its answer, its category's, the legacy mute, its default.
  public static func typeValue(
    _ catalog: NotificationCatalog, _ settings: [String: Any]?, legacy: [String: Any]?, type: String,
    _ channel: NotificationChannel
  ) -> Bool {
    let category = catalog.category(of: type)
    if let own = scopeTypePref(settings, .account, type: type, channel) { return own }
    if let own = scopePref(settings, .account, category: category, channel) { return own }
    if channel == .console, bool(legacy?[category]) == false { return false }
    let entry = catalog.entry(type)
    if channel == .email {
      return entry?.emailDefault ?? catalog.categories.first { $0.id == category }?.channelDefaults?.email ?? false
    }
    return entry?.consoleDefault ?? true
  }

  /// The workspaces and sites with an answer of their own (`notificationOverriddenScopes`).
  public static func overriddenScopes(_ settings: [String: Any]?) -> (orgIDs: [String], hostIDs: [String]) {
    func answered(_ layer: [String: Any]?) -> Bool {
      (layer ?? [:]).values.contains { (($0 as? [String: Any]) ?? [:]).values.contains { bool($0) != nil } }
    }
    func named(_ categories: [String: Any]?, _ types: [String: Any]?) -> [String] {
      Set((categories ?? [:]).keys).union((types ?? [:]).keys).sorted().filter {
        answered(categories?[$0] as? [String: Any]) || answered(types?[$0] as? [String: Any])
      }
    }
    return (
      named(settings?["orgs"] as? [String: Any], settings?["orgTypes"] as? [String: Any]),
      named(settings?["hosts"] as? [String: Any], settings?["hostTypes"] as? [String: Any])
    )
  }

  /// The merge that sets or clears (`nil`) one answer: clearing deletes the
  /// key, and a cell left with no answers is deleted whole.
  public static func answerWrite(
    _ settings: [String: Any]?, _ scope: NotificationScope, key: String, types: Bool, _ channel: NotificationChannel,
    _ value: Bool?
  ) -> [String: Any] {
    let layer = types ? typeLayer(settings, scope) : categoryLayer(settings, scope)
    let cell = layer?[key] as? [String: Any] ?? [:]
    let leaf: Any =
      if let value { [channel.rawValue: value] }
      else if cell.keys.allSatisfy({ $0 == channel.rawValue }) { FirestoreSentinel.delete }
      else { [channel.rawValue: FirestoreSentinel.delete] }
    let path = layerPath(scope, types: types) + [key]
    return [field: path.reversed().reduce(leaf) { inner, segment in [segment: inner] }]
  }

  /// Puts a type back on its category at the account: every channel at once.
  public static func resetTypeWrite(_ type: String) -> [String: Any] {
    [field: ["accountTypes": [type: FirestoreSentinel.delete]]]
  }

  /// Whether a digest is on: everything is until switched off (`digestEnabled`).
  public static func digestEnabled(_ prefs: [String: Any]?, key: String) -> Bool { bool(prefs?[key]) != false }

  /// Whether a person asked for a workspace's weekly insights.
  public static func insightSubscribed(_ value: [String: Any]?, orgID: String) -> Bool {
    !orgID.isEmpty && bool(value?[orgID]) == true
  }
}
