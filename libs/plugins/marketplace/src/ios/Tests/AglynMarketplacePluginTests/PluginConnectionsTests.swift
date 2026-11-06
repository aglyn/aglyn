// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import XCTest

@testable import AglynMarketplacePlugin

/// A site's connections for an installed plugin (AGL-4196): the console's `plugin-connection-card.spec.ts`, and the
/// Kotlin `PluginConnectionsTest`.
final class PluginConnectionsTests: XCTestCase {
  private func entry(
    connection: JSONValue = .null, credentialsSet: Bool = true, planAllows: Bool = true
  ) -> PluginConnectionEntry {
    let json: JSONValue = .object([
      "listingId": "listing-1", "connectionId": "gbp", "provider": "google", "label": "Google Business Profile",
      "resources": .array([.object(["id": "accounts", "label": "Account"]), .object(["id": "locations", "label": "Location"])]),
      "connection": connection, "credentialsSet": .bool(credentialsSet), "planAllows": .bool(planAllows),
    ])
    return PluginConnectionEntry(json)!
  }

  private func view(status: String = "connected", ready: Bool = false, choices: [String: JSONValue] = [:], lastSync: Double? = nil)
    -> JSONValue
  {
    .object([
      "status": .string(status), "ready": .bool(ready), "choices": .object(choices),
      "lastSyncAtMs": lastSync.map(JSONValue.number) ?? .null, "lastError": .null,
    ])
  }

  func testPhases() {
    XCTAssertEqual(pluginConnectionPhase(entry(), configured: false), .notConfigured)
    XCTAssertEqual(pluginConnectionPhase(entry(credentialsSet: false), configured: true), .notSetUp)
    XCTAssertEqual(pluginConnectionPhase(entry(), configured: true), .notConnected)
    XCTAssertEqual(pluginConnectionPhase(entry(connection: view()), configured: true), .choosing)
    XCTAssertEqual(pluginConnectionPhase(entry(connection: view(ready: true)), configured: true), .connected)
    XCTAssertEqual(pluginConnectionPhase(entry(connection: view(status: "reconnect_required")), configured: true), .reconnect)
    XCTAssertEqual(pluginConnectionPhase(entry(connection: view(status: "error")), configured: true), .error)
  }

  func testChipsSayWhatTheConsoleSays() {
    XCTAssertEqual(PluginConnectionPhase.connected.chip.label, "Connected")
    XCTAssertEqual(PluginConnectionPhase.notSetUp.chip.label, "Waiting on the publisher")
    XCTAssertEqual(PluginConnectionPhase.reconnect.chip.label, "Reconnect needed")
  }

  func testResourcesInOrder() {
    XCTAssertEqual(nextPluginConnectionResource(entry())?.id, "accounts")
    let one = entry(connection: view(choices: ["accounts": .object(["id": "a", "label": "A"])]))
    XCTAssertEqual(nextPluginConnectionResource(one)?.id, "locations")
    XCTAssertEqual(one.connection?.choices["accounts"]?.label, "A")
  }

  func testNextSync() {
    XCTAssertEqual(pluginConnectionNextSync(PluginConnectionState(view(ready: true, lastSync: 1000)), intervalHours: 2), .at(1000 + 7_200_000))
    XCTAssertEqual(pluginConnectionNextSync(PluginConnectionState(view(ready: true)), intervalHours: 2), .soon)
    XCTAssertNil(pluginConnectionNextSync(PluginConnectionState(view(ready: false)), intervalHours: 2))
    XCTAssertNil(pluginConnectionNextSync(PluginConnectionState(view(status: "reconnect_required", ready: true)), intervalHours: 2))
  }

  func testStatusDecodes() {
    let status = PluginConnectionsStatus(
      .object(["configured": true, "planAllows": false, "connections": .array([.object(["listingId": "l", "connectionId": "c"])])]))
    XCTAssertTrue(status.configured)
    XCTAssertFalse(status.planAllows)
    XCTAssertEqual(status.connections.map(\.id), ["l/c"])
  }

  func testDeclaredConnections() {
    let manifest: [String: Any] = ["connections": [["id": "gbp", "label": "Google Business Profile", "sync": ["intervalHours": 6]], ["id": "x"]]]
    XCTAssertEqual(declaredPluginConnections(manifest), [DeclaredPluginConnection(id: "gbp", label: "Google Business Profile", intervalHours: 6)])
    XCTAssertEqual(declaredPluginConnections(nil), [])
  }

  func testReturnToIsTheSitePluginPage() {
    XCTAssertEqual(
      pluginConnectionReturnTo(origin: "https://app.aglyn.com/", orgSlug: "acme", hostSlug: "main", listingID: "listing-1"),
      "https://app.aglyn.com/acme/hosts/main/admin/plugins/listing-1")
  }

  func testRefusalReason() {
    let error = ConsoleAPIError(status: 403, message: "No", body: .object(["reason": "plan"]))
    XCTAssertEqual(pluginConnectionRefusalReason(error), "plan")
    XCTAssertNil(pluginConnectionRefusalReason(ConsoleAPIError(status: 404, message: "Not found")))
  }

  func testWaitAndShares() {
    XCTAssertEqual(
      pluginConnectionTooSoonText("Google Business Profile", retryAfterMs: 41_200),
      "Google Business Profile synced moments ago. You can sync it again in 42 seconds.")
    XCTAssertEqual(pluginConnectionSharesText(["a.example.com", "b.example.com"]), "Shares data with: a.example.com, b.example.com")
    XCTAssertNil(pluginConnectionSharesText([]))
    XCTAssertNil(pluginConnectionNextSync(PluginConnectionState(view(status: "error", ready: true, lastSync: 5)), intervalHours: 2))
  }

  func testCopyMatchesTheConsole() {
    XCTAssertEqual(pluginConnectionsPlanRefusal, "Connecting a plugin to another service comes with the Starter, Pro and Custom plans.")
    XCTAssertEqual(pluginConnectionsSiteKey, "marketplace.siteConnections")
  }
}
