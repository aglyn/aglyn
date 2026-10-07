// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import XCTest

@testable import AglynCore

/// A reader whose listeners the test drives by hand.
final class FakeReader: FirestoreReader, @unchecked Sendable {
  final class Listener: FirestoreListening {
    var removed = false
    func remove() { removed = true }
  }

  var queries: [(FirestoreQuery, @MainActor (Result<[FirestoreDocument], Error>) -> Void, Listener)] = []

  @MainActor
  func listen(_ query: FirestoreQuery, _ onChange: @escaping @MainActor (Result<[FirestoreDocument], Error>) -> Void)
    -> FirestoreListening
  {
    let listener = Listener()
    queries.append((query, onChange, listener))
    return listener
  }

  @MainActor
  func listenDocument(_ path: [String], _ onChange: @escaping @MainActor (Result<FirestoreDocument?, Error>) -> Void)
    -> FirestoreListening
  { Listener() }

  func setDocument(_ path: [String], _ fields: [String: Any], merge: Bool) async throws {}
  func deleteDocument(_ path: [String]) async throws {}

  @MainActor
  func emit(_ path: String, _ docs: [FirestoreDocument]) {
    queries.last { $0.0.path == path && !$0.2.removed }?.1(.success(docs))
  }
}

@MainActor
final class WorkspaceStoreTests: XCTestCase {
  private let orgs = [
    WorkspaceOrg(id: "a", name: "A", slug: "a", role: "owner"), WorkspaceOrg(id: "b", name: "B", slug: "b", role: "admin"),
  ]
  private let sites = [
    WorkspaceSite(id: "s1", orgID: "a", name: "One", subdomain: "one", role: "admin"),
    WorkspaceSite(id: "s2", orgID: "a", name: "Two", subdomain: "two", role: "admin"),
  ]

  func testReconcileKeepsAPickThatStillExists() {
    XCTAssertEqual(
      WorkspaceStore.reconcile(.init(orgID: "b", hostID: "s2"), orgs: orgs, sites: nil), .init(orgID: "b", hostID: "s2"))
    XCTAssertEqual(
      WorkspaceStore.reconcile(.init(orgID: "a", hostID: "s2"), orgs: orgs, sites: sites), .init(orgID: "a", hostID: "s2"))
  }

  func testReconcileDropsAGoneOrgAndItsSite() {
    XCTAssertEqual(
      WorkspaceStore.reconcile(.init(orgID: "gone", hostID: "s2"), orgs: orgs, sites: sites), .init(orgID: "a", hostID: nil))
    XCTAssertEqual(WorkspaceStore.reconcile(.init(orgID: nil, hostID: nil), orgs: [], sites: nil), .init(orgID: nil, hostID: nil))
  }

  func testReconcileFallsBackToTheFirstSite() {
    XCTAssertEqual(
      WorkspaceStore.reconcile(.init(orgID: "a", hostID: "gone"), orgs: orgs, sites: sites), .init(orgID: "a", hostID: "s1"))
    XCTAssertEqual(WorkspaceStore.reconcile(.init(orgID: "a", hostID: "s1"), orgs: orgs, sites: []), .init(orgID: "a", hostID: nil))
  }

  func testMembershipRowsReadTheConsoleFields() {
    XCTAssertEqual(
      WorkspaceStore.org(from: .init(id: "o", data: ["orgName": "Acme", "slug": "acme", "role": "owner"])),
      WorkspaceOrg(id: "o", name: "Acme", slug: "acme", role: "owner"))
    XCTAssertEqual(WorkspaceStore.org(from: .init(id: "o", data: [:])), WorkspaceOrg(id: "o", name: "o", slug: "o", role: ""))
    XCTAssertEqual(
      WorkspaceStore.site(from: .init(id: "h", data: ["orgId": "o", "subdomain": "shop"])),
      WorkspaceSite(id: "h", orgID: "o", name: "shop", subdomain: "shop", role: ""))
  }

  func testRunsTheConsoleQueriesAndRemembersThePick() {
    let defaults = UserDefaults(suiteName: "workspace-\(UUID().uuidString)")!
    let reader = FakeReader()
    let store = WorkspaceStore(uid: "u1", reader: reader, defaults: defaults)
    store.start()
    XCTAssertFalse(store.ready)
    XCTAssertEqual(reader.queries[0].0.path, "users/u1/orgs")
    XCTAssertEqual(reader.queries[0].0.limit, 50)

    reader.emit(
      "users/u1/orgs",
      [.init(id: "b", data: ["orgName": "Beta"]), .init(id: "a", data: ["orgName": "Alpha", "slug": "alpha"])])
    XCTAssertEqual(store.orgs.map(\.id), ["a", "b"])
    XCTAssertEqual(store.org?.id, "a")
    let sitesQuery = reader.queries[1].0
    XCTAssertEqual(sitesQuery.path, "users/u1/hostMemberships")
    XCTAssertEqual(sitesQuery.equals.first?.field, "orgId")
    XCTAssertEqual(sitesQuery.equals.first?.value as? String, "a")
    XCTAssertEqual(sitesQuery.order.first?.field, "nameLower")
    XCTAssertEqual(sitesQuery.limit, 100)
    XCTAssertFalse(store.ready)

    reader.emit("users/u1/hostMemberships", [.init(id: "s1", data: ["orgId": "a", "displayName": "One"])])
    XCTAssertTrue(store.ready)
    XCTAssertEqual(store.site?.id, "s1")

    store.selectOrg("b")
    XCTAssertTrue(reader.queries[1].2.removed)
    XCTAssertEqual(reader.queries[2].0.equals.first?.value as? String, "b")
    reader.emit("users/u1/hostMemberships", [.init(id: "s9", data: ["orgId": "b"])])
    XCTAssertEqual(store.site?.id, "s9")

    let restored = WorkspaceStore(uid: "u1", reader: FakeReader(), defaults: defaults)
    XCTAssertEqual(
      try? JSONDecoder().decode(WorkspacePick.self, from: defaults.data(forKey: WorkspaceStore.storageKey("u1"))!),
      WorkspacePick(orgID: "b", hostID: "s9"))
    _ = restored
  }
}
