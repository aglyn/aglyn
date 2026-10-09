// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import AglynPluginHost
import Foundation
import SwiftUI

/// Every spec screen the app has: core's and each plugin's.
@MainActor
public final class ScreenCatalog {
  public static let shared = ScreenCatalog()
  public private(set) var specs: [String: ScreenSpec] = [:]

  public init() {}

  public func add(_ list: [ScreenSpec]) {
    for spec in list { specs[spec.id] = spec }
  }

  public func spec(_ id: String) -> ScreenSpec? { specs[id] }

  /// The screens the shell lists in one group, in order.
  public func group(_ name: String) -> [ScreenSpec] {
    specs.values.filter { $0.group == name }.sorted { ($0.order, $0.id) < ($1.order, $1.id) }
  }

  /// The plugin screens contributing to a core screen's zone, in order.
  public func zone(_ name: String) -> [ScreenSpec] {
    specs.values.filter { $0.zones.contains(name) }.sorted { ($0.order, $0.id) < ($1.order, $1.id) }
  }

  /// Parses a spec file: `{ "screens": [ … ] }`.
  nonisolated public static func parse(_ data: Data) -> [ScreenSpec] {
    guard let json = JSONValue.decode(data) else { return [] }
    return json["screens"].array.compactMap(ScreenSpec.init)
  }

  /// Every `*.screens.json` a bundle carries.
  nonisolated public static func load(from bundle: Bundle, folder: String? = nil) -> [ScreenSpec] {
    let urls = (bundle.urls(forResourcesWithExtension: "json", subdirectory: folder) ?? [])
      .filter { $0.lastPathComponent.hasSuffix(".screens.json") }
      .sorted { $0.lastPathComponent < $1.lastPathComponent }
    return urls.flatMap { url in (try? Data(contentsOf: url)).map(parse) ?? [] }
  }
}

/// Spec screens as plugin-host contributions.
public enum SpecScreens {
  /// The deep-link ids a spec registers: `<screen id>.link`, `.link2`, …
  public static func linkIDs(_ spec: ScreenSpec) -> [String] {
    spec.links.indices.map { $0 == 0 ? "\(spec.id).link" : "\(spec.id).link\($0 + 1)" }
  }

  /// What a set of specs contributes, for a registrar's declaration.
  public static func declaration(_ specs: [ScreenSpec]) -> NativeContributionDeclaration {
    NativeContributionDeclaration(
      screens: specs.map(\.id).sorted(),
      deepLinks: specs.flatMap(linkIDs).sorted())
  }

  /// Registers each spec as a screen and each of its links as a deep link,
  /// and adds the specs to the catalog so split views find their details.
  @MainActor
  public static func register(_ specs: [ScreenSpec], into registrar: NativePluginRegistrar) {
    ScreenCatalog.shared.add(specs)
    for spec in specs {
      registrar.screen(spec.id, title: spec.label, requiresSite: spec.requiresSite, icon: spec.icon) { context, params in
        SpecScreenView(spec: spec, context: context, params: params)
      }
      for (index, path) in spec.links.enumerated() {
        registrar.deepLink(linkIDs(spec)[index], path: path, screen: spec.id)
      }
    }
  }
}

/// The app's own console areas (workspace, team, settings, billing, site
/// admin, your account, support and staff), declared in
/// `libs/native/screens/*.screens.json` and loaded like a plugin named
/// `core`, so links resolve and screens open the way a plugin's do.
@MainActor
public enum CoreScreens {
  public static let pluginID = "core"

  public static var specs: [ScreenSpec] { ScreenCatalog.load(from: .module) }

  /// The manifest entry the shell loads ahead of the plugins'.
  public static var manifestEntry: NativePluginManifestEntry {
    let specs = specs
    return NativePluginManifestEntry(
      id: pluginID, contributes: SpecScreens.declaration(specs),
      register: { registrar in SpecScreens.register(specs, into: registrar) })
  }
}
