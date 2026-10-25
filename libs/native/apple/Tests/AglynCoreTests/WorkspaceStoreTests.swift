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

  var documents: [(String, @MainActor (Result<FirestoreDocument?, Error>) -> Void, Listener)] = []

  @MainActor
  func listenDocument(_ path: [String], _ onChange: @escaping @MainActor (Result<FirestoreDocument?, Error>) -> Void)
    -> FirestoreListening
  {
    let listener = Listener()
    documents.append((path.joined(separator: "/"), onChange, listener))
    return listener
  }

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

  func testADeletedSiteOnScreenIsRemovedNotReplaced() {
    // s2 was on screen and is gone from the loaded list (deleted): the shell leaves for the workspace's Sites.
    let left = Array(sites.prefix(1))
    XCTAssertTrue(WorkspaceStore.shownSiteRemoved(shownOrgID: "a", shownHostID: "s2", orgID: "a", sites: left, ready: true))
    // Still listed, nothing on screen, the sites still loading, or another workspace now shown: nothing was removed.
    XCTAssertFalse(WorkspaceStore.shownSiteRemoved(shownOrgID: "a", shownHostID: "s1", orgID: "a", sites: left, ready: true))
    XCTAssertFalse(WorkspaceStore.shownSiteRemoved(shownOrgID: "a", shownHostID: nil, orgID: "a", sites: left, ready: true))
    XCTAssertFalse(WorkspaceStore.shownSiteRemoved(shownOrgID: "a", shownHostID: "s2", orgID: "a", sites: [], ready: false))
    XCTAssertFalse(WorkspaceStore.shownSiteRemoved(shownOrgID: "b", shownHostID: "s2", orgID: "a", sites: left, ready: true))
    // The last site deleted leaves an empty, loaded list: removed too.
    XCTAssertTrue(WorkspaceStore.shownSiteRemoved(shownOrgID: "a", shownHostID: "s1", orgID: "a", sites: [], ready: true))
  }

  func testAWindowInsideADeletedSiteLeavesEvenWhenItSteppedInAfterThePick() {
    var watch = WorkspaceStore.ShownSiteWatch()
    // A Sites row picks s2 while the window is on the whole workspace, then the window steps inside it with no new pick.
    XCTAssertFalse(watch.update(orgID: "a", pickedHostID: "s1", sites: sites, ready: true, inSite: false))
    XCTAssertFalse(watch.update(orgID: "a", pickedHostID: "s2", sites: sites, ready: true, inSite: false))
    // s2 is deleted while the window is inside it: the store has already fallen back to s1, and the window leaves.
    XCTAssertTrue(watch.update(orgID: "a", pickedHostID: "s1", sites: Array(sites.prefix(1)), ready: true, inSite: true))
    XCTAssertFalse(watch.update(orgID: "a", pickedHostID: "s1", sites: Array(sites.prefix(1)), ready: true, inSite: false))
    // A window on the whole workspace does not leave when its picked site goes.
    var outside = WorkspaceStore.ShownSiteWatch()
    _ = outside.update(orgID: "a", pickedHostID: "s2", sites: sites, ready: true, inSite: false)
    XCTAssertFalse(outside.update(orgID: "a", pickedHostID: "s1", sites: Array(sites.prefix(1)), ready: true, inSite: false))
    // Another workspace opened is a switch, not a deletion.
    var switching = WorkspaceStore.ShownSiteWatch()
    _ = switching.update(orgID: "a", pickedHostID: "s2", sites: sites, ready: true, inSite: true)
    XCTAssertFalse(switching.update(orgID: "b", pickedHostID: nil, sites: [], ready: true, inSite: true))
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

  func testASiteCarriesItsFaviconAndEachWorkspaceItsLogosFromItsOwnDocument() {
    XCTAssertEqual(
      WorkspaceStore.site(from: .init(id: "h", data: ["orgId": "o", "favicon": "media:h/fav"])).favicon, "media:h/fav")
    XCTAssertNil(WorkspaceStore.site(from: .init(id: "h", data: ["favicon": " "])).favicon)

    let reader = FakeReader()
    let store = WorkspaceStore(uid: "u1", reader: reader, defaults: UserDefaults(suiteName: "logos-\(UUID().uuidString)")!)
    store.start()
    reader.emit("users/u1/orgs", [.init(id: "a", data: ["orgName": "Alpha"]), .init(id: "b", data: ["orgName": "Beta"])])
    // The shown workspace's document is read live: the membership index carries no logo.
    let shown = try! XCTUnwrap(reader.documents.first { $0.0 == "orgs/a" })
    shown.1(.success(.init(id: "a", data: ["logoUrl": "/api/media/cdn/org:a/logo", "logoDarkUrl": ""])))
    // A document without a plan is on Free (`effectivePlan`), which the switcher names under each workspace.
    XCTAssertEqual(store.orgLogo, WorkspaceOrgLogo(light: "/api/media/cdn/org:a/logo", dark: nil, plan: "free"))
    XCTAssertFalse(shown.2.removed)

    // The switcher asks for every row's: each other workspace's document is read once.
    store.loadLogos(["a", "b"])
    XCTAssertEqual(reader.documents.filter { $0.0 == "orgs/a" }.count, 1)
    let other = try! XCTUnwrap(reader.documents.first { $0.0 == "orgs/b" })
    other.1(.success(.init(id: "b", data: ["logoUrl": "media:org:b/m1"])))
    XCTAssertEqual(store.orgLogos["b"]?.light, "media:org:b/m1")
    XCTAssertTrue(other.2.removed)
    store.loadLogos(["b"])
    XCTAssertEqual(reader.documents.filter { $0.0 == "orgs/b" }.count, 1)
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

  /// After this person creates a workspace the lists are read again at once (AGL-3920), and what is shown stays meanwhile.
  func testReloadReadsTheListsAgainAndKeepsWhatIsShown() {
    let reader = FakeReader()
    let store = WorkspaceStore(uid: "u1", reader: reader, defaults: UserDefaults(suiteName: "workspace-\(UUID().uuidString)")!)
    store.start()
    reader.emit("users/u1/orgs", [])
    XCTAssertTrue(store.ready)
    XCTAssertTrue(store.orgs.isEmpty)
    store.reload()
    XCTAssertTrue(reader.queries[0].2.removed)
    XCTAssertTrue(store.ready)
    reader.emit("users/u1/orgs", [.init(id: "new", data: ["orgName": "Lane Test Co"])])
    XCTAssertEqual(store.org?.id, "new")
  }

  /// A console link (`/{orgSlug}/hosts/{hostSlug}/…`) moves the switcher onto the workspace and site it names before
  /// its screen reads them (AGL-3911); a site in another workspace is picked once that workspace's sites arrive.
  func testALinkPicksTheWorkspaceAndSiteItNames() {
    let reader = FakeReader()
    let store = WorkspaceStore(uid: "u1", reader: reader, defaults: UserDefaults(suiteName: "workspace-\(UUID().uuidString)")!)
    store.start()
    reader.emit("users/u1/orgs", [.init(id: "a", data: ["slug": "alpha"]), .init(id: "b", data: ["slug": "beta"])])
    reader.emit(
      "users/u1/hostMemberships",
      [.init(id: "s1", data: ["orgId": "a", "subdomain": "one"]), .init(id: "s2", data: ["orgId": "a", "subdomain": "two"])])
    XCTAssertEqual(store.site?.id, "s1")

    XCTAssertTrue(store.select(orgSlug: "alpha", hostSlug: "two"))
    XCTAssertEqual(store.site?.id, "s2")

    XCTAssertFalse(store.select(orgSlug: "h1", hostSlug: nil))
    XCTAssertEqual(store.org?.id, "a")
    XCTAssertEqual(store.site?.id, "s2")

    XCTAssertTrue(store.select(orgSlug: "beta", hostSlug: "shop"))
    XCTAssertEqual(store.org?.id, "b")
    reader.emit(
      "users/u1/hostMemberships",
      [.init(id: "s8", data: ["orgId": "b", "subdomain": "eight"]), .init(id: "s9", data: ["orgId": "b", "subdomain": "shop"])])
    XCTAssertEqual(store.site?.id, "s9")

    XCTAssertTrue(store.select(orgSlug: "beta", hostSlug: nil))
    XCTAssertEqual(store.site?.id, "s9")
  }

  /// A link that launched the app arrives before the person's workspaces do: it is picked once they and the site arrive.
  func testALinkBeforeTheWorkspacesArrivePicksThemWhenTheyDo() {
    let reader = FakeReader()
    let store = WorkspaceStore(uid: "u1", reader: reader, defaults: UserDefaults(suiteName: "workspace-\(UUID().uuidString)")!)
    store.start()
    XCTAssertTrue(store.select(orgSlug: "beta", hostSlug: "shop"))
    reader.emit("users/u1/orgs", [.init(id: "a", data: ["slug": "alpha"]), .init(id: "b", data: ["slug": "beta"])])
    XCTAssertEqual(store.org?.id, "b")
    reader.emit(
      "users/u1/hostMemberships",
      [.init(id: "s8", data: ["orgId": "b", "subdomain": "eight"]), .init(id: "s9", data: ["orgId": "b", "subdomain": "shop"])])
    XCTAssertEqual(store.site?.id, "s9")
  }

  /// A full window is a page, not the whole list: the console's `loadMoreOrgs` (AGL-2336).
  func testAFullWindowOffersMoreAndGrowingItListensAgain() {
    let reader = FakeReader()
    let store = WorkspaceStore(uid: "u1", reader: reader, defaults: UserDefaults(suiteName: "workspace-\(UUID().uuidString)")!)
    store.start()
    reader.emit("users/u1/orgs", (0..<50).map { FirestoreDocument(id: "o\($0)", data: ["orgName": "Org \($0)"]) })
    XCTAssertTrue(store.hasMoreOrgs)
    store.loadMoreOrgs()
    XCTAssertTrue(reader.queries[0].2.removed)
    let grown = reader.queries.last { $0.0.path == "users/u1/orgs" }!
    XCTAssertEqual(grown.0.limit, 100)
    reader.emit("users/u1/orgs", (0..<73).map { FirestoreDocument(id: "o\($0)", data: ["orgName": "Org \($0)"]) })
    XCTAssertEqual(store.orgs.count, 73)
    XCTAssertFalse(store.hasMoreOrgs)
  }

  /// An SSO account signs in as its tenant uid (AGL-3816), and its switcher is that uid's memberships: every one of them.
  func testATenantAccountListsEveryWorkspaceItBelongsTo() {
    let reader = FakeReader()
    let tenantUID = "SsoTenantMemberUid0000000001"
    let store = WorkspaceStore(uid: tenantUID, reader: reader, defaults: UserDefaults(suiteName: "workspace-\(UUID().uuidString)")!)
    store.start()
    XCTAssertEqual(reader.queries[0].0.path, "users/\(tenantUID)/orgs")
    let names = ["Juniper Street Co.", "Eastwood Plumbing", "Northwind Coffee", "Ember Studio", "Test Org", "Aglyn LLC"]
    reader.emit("users/\(tenantUID)/orgs", names.enumerated().map { FirestoreDocument(id: "o\($0.offset)", data: ["orgName": $0.element]) })
    XCTAssertEqual(Set(store.orgs.map(\.name)), Set(names))
    XCTAssertFalse(store.hasMoreOrgs)
  }
}
