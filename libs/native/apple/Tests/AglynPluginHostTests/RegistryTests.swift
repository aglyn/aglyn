// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import SwiftUI
import XCTest

@testable import AglynPluginHost

@MainActor
final class RegistryTests: XCTestCase {
  private func entry(
    _ id: String = "a", contributes: [String: [String]] = ["screens": ["a.list"]],
    register: @escaping @MainActor (NativePluginRegistrar) -> Void = { $0.screen("a.list", title: "A") { _, _ in EmptyView() } }
  ) -> NativePluginManifestEntry {
    NativePluginManifestEntry(id: id, contributes: contributes, register: register)
  }

  func testLoadsAPluginWhoseRegistrarMatchesItsDeclaration() {
    let registry = NativePluginRegistry()
    let result = NativePluginLoader.load([entry()], into: registry)
    XCTAssertEqual(result, NativePluginLoadResult(loaded: ["a"], failed: []))
    XCTAssertEqual(registry.screen("a.list")?.pluginID, "a")
  }

  func testRefusesAnUndeclaredRegistrationAndKeepsLoadingTheOthers() {
    let registry = NativePluginRegistry()
    let result = NativePluginLoader.load(
      [
        entry(register: { $0.tab("a.tab", title: "A", icon: "x", screen: "a.list", order: 1) }),
        entry("b", contributes: ["screens": ["b.list"]], register: { $0.screen("b.list", title: "B") { _, _ in EmptyView() } }),
      ], into: registry)
    XCTAssertEqual(result.loaded, ["b"])
    XCTAssertEqual(result.failed.first?.pluginID, "a")
    XCTAssertTrue(result.failed.first?.error.contains("does not declare") == true)
  }

  func testRefusesAnIDOutsideThePluginsOwn() {
    let registry = NativePluginRegistry()
    let result = NativePluginLoader.load(
      [entry(contributes: ["screens": ["b.list"]], register: { $0.screen("b.list", title: "B") { _, _ in EmptyView() } })],
      into: registry)
    XCTAssertTrue(result.failed.first?.error.contains("registers only its own") == true)
  }

  func testReportsADeclaredIDTheRegistrarNeverRegistersAndLeavesNothingBehind() {
    let registry = NativePluginRegistry()
    let result = NativePluginLoader.load([entry(contributes: ["screens": ["a.list"], "widgets": ["a.card"]])], into: registry)
    XCTAssertTrue(result.failed.first?.error.contains("never registers widgets \"a.card\"") == true)
    XCTAssertNil(registry.screen("a.list"))
    XCTAssertTrue(registry.widgets(for: .aglyn).isEmpty)
  }

  func testRefusesASecondRegistrationOfTheSameID() {
    let registry = NativePluginRegistry()
    let result = NativePluginLoader.load(
      [
        entry(register: {
          $0.screen("a.list", title: "A") { _, _ in EmptyView() }
          $0.screen("a.list", title: "A again") { _, _ in EmptyView() }
        })
      ], into: registry)
    XCTAssertTrue(result.failed.first?.error.contains("already registered") == true)
  }

  func testRefusesADeepLinkThatIsNotAConsolePath() {
    let registry = NativePluginRegistry()
    let result = NativePluginLoader.load(
      [entry(contributes: ["deepLinks": ["a.link"]], register: { $0.deepLink("a.link", path: "a", screen: "a.list") })],
      into: registry)
    XCTAssertTrue(result.failed.first?.error.contains("starts with /") == true)
  }

  func testFiltersByAppAndPlacementAndOrders() {
    let registry = NativePluginRegistry()
    _ = NativePluginLoader.load(
      [
        entry(
          contributes: ["screens": ["a.list", "a.register"], "quickActions": ["a.one", "a.two"]],
          register: {
            $0.screen("a.list", title: "A") { _, _ in EmptyView() }
            $0.screen("a.register", title: "Register", apps: [.pos], placement: .register) { _, _ in EmptyView() }
            $0.quickAction("a.two", title: "Two", icon: "x", order: 2, screen: "a.list")
            $0.quickAction("a.one", title: "One", icon: "x", order: 1, screen: "a.list")
          })
      ], into: registry)
    XCTAssertEqual(registry.quickActions(for: .aglyn).map(\.id), ["a.one", "a.two"])
    XCTAssertEqual(registry.screens(for: .pos, placement: .register).map(\.id), ["a.register"])
    XCTAssertEqual(registry.screens(for: .aglyn).map(\.id), ["a.list"])
  }
}

@MainActor
final class BesignerOnlyTests: XCTestCase {
  func testTheContextOpensOnlyBesignerPathsUnderTheSite() {
    var opened: [String] = []
    let context = NativePluginContext(
      uid: "u", orgID: "o", hostID: "h", orgSlug: "acme", hostSlug: "shop", firestore: NullReader(),
      api: ConsoleAPIClient(origin: "https://console.test", getIDToken: { _ in "t" }),
      navigate: { _, _ in }, openBesigner: { opened.append($0) })
    XCTAssertTrue(context.openBesigner("/screens/s1/versions/v1/besigner"))
    XCTAssertFalse(context.openBesigner("/products/orders"))
    XCTAssertEqual(opened, ["/acme/hosts/shop/screens/s1/versions/v1/besigner"])
  }

  func testTheContextHandsAHostThePluginsWidgetsInAnamedSlot() {
    let registry = NativePluginRegistry()
    _ = NativePluginLoader.load(
      [
        entry(
          contributes: ["widgets": ["a.late", "a.early", "a.home"]],
          register: {
            $0.widget("a.late", title: "Late", order: 2, slot: "commerceSettings") { _ in EmptyView() }
            $0.widget("a.early", title: "Early", order: 1, slot: "commerceSettings") { _ in EmptyView() }
            $0.widget("a.home", title: "Home", order: 1) { _ in EmptyView() }
          })
      ], into: registry)
    let bare = NativePluginContext(
      uid: "u", orgID: "o", hostID: "h", orgSlug: "acme", hostSlug: "shop", firestore: NullReader(),
      api: ConsoleAPIClient(origin: "https://console.test", getIDToken: { _ in "t" }),
      navigate: { _, _ in }, openBesigner: { _ in })
    XCTAssertEqual(bare.slotWidgets("commerceSettings").map(\.id), [], "a shell that hosts no slots hands none")
    let hosted = NativePluginContext(
      uid: "u", orgID: "o", hostID: "h", orgSlug: "acme", hostSlug: "shop", firestore: NullReader(),
      api: ConsoleAPIClient(origin: "https://console.test", getIDToken: { _ in "t" }),
      navigate: { _, _ in }, openBesigner: { _ in },
      slotWidgets: { registry.widgets(for: .aglyn, slot: $0) })
    XCTAssertEqual(hosted.slotWidgets("commerceSettings").map(\.id), ["a.early", "a.late"])
    XCTAssertEqual(hosted.slotWidgets("elsewhere").map(\.id), [])
  }
}

private final class NullReader: FirestoreReader, @unchecked Sendable {
  @MainActor
  func listen(_ query: FirestoreQuery, _ onChange: @escaping @MainActor (Result<[FirestoreDocument], Error>) -> Void)
    -> FirestoreListening
  { NoListener() }

  @MainActor
  func listenDocument(_ path: [String], _ onChange: @escaping @MainActor (Result<FirestoreDocument?, Error>) -> Void)
    -> FirestoreListening
  { NoListener() }

  func setDocument(_ path: [String], _ fields: [String: Any], merge: Bool) async throws {}
  func deleteDocument(_ path: [String]) async throws {}
}
