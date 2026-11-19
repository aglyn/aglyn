// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import XCTest

@testable import AglynCore

/// Site pins (AGL-4005, AGL-4165) as the console's `usePinnedHosts` keeps them: shown at once, written as one entry
/// added or removed, and put back when the write is refused.
@MainActor
final class SitePinsTests: XCTestCase {
  /// Records each write; `refuse` makes the next one fail as the rules would.
  final class RecordingReader: FirestoreReader, @unchecked Sendable {
    final class Listener: FirestoreListening { func remove() {} }
    var writes: [(path: [String], fields: [String: Any], merge: Bool)] = []
    var refuse = false

    @MainActor
    func listen(_ query: FirestoreQuery, _ onChange: @escaping @MainActor (Result<[FirestoreDocument], Error>) -> Void)
      -> FirestoreListening
    { Listener() }

    @MainActor
    func listenDocument(_ path: [String], _ onChange: @escaping @MainActor (Result<FirestoreDocument?, Error>) -> Void)
      -> FirestoreListening
    { Listener() }

    func setDocument(_ path: [String], _ fields: [String: Any], merge: Bool) async throws {
      writes.append((path, fields, merge))
      if refuse { throw ConsoleAPIError(status: 403, message: "refused") }
    }

    func deleteDocument(_ path: [String]) async throws {}
  }

  private func settle() async {
    for _ in 0..<5 { await Task.yield() }
  }

  private func stored(_ pins: [(String, String)]) -> [String: Any] {
    ["pinnedHosts": pins.map { ["orgId": $0.0, "hostId": $0.1] }]
  }

  func testAPinIsShownAtOnceAndWrittenAsOneEntry() async throws {
    let reader = RecordingReader()
    let store = AccountPreferencesStore(uid: "u1", reader: reader)
    store.apply(stored([("o1", "h1"), ("o2", "h2")]))
    XCTAssertEqual(store.pinnedHosts(in: "o1"), ["h1"])

    XCTAssertEqual(store.toggleHostPin("h3", orgID: "o1"), .pinned)
    XCTAssertEqual(store.pinnedHosts(in: "o1"), ["h1", "h3"], "the pin shows before the write answers")
    await settle()
    let write = try XCTUnwrap(reader.writes.last)
    XCTAssertEqual(write.path, ["users", "u1"])
    XCTAssertTrue(write.merge)
    let change = try XCTUnwrap(write.fields["pinnedHosts"] as? FirestoreArrayChange)
    XCTAssertEqual(change.kind, .union)
    XCTAssertEqual(change.elements.count, 1)
    XCTAssertEqual((change.elements.first as? [String: String]) ?? [:], ["orgId": "o1", "hostId": "h3"])

    XCTAssertEqual(store.toggleHostPin("h1", orgID: "o1"), .unpinned)
    XCTAssertEqual(store.pinnedHosts(in: "o1"), ["h3"])
    await settle()
    let removed = try XCTUnwrap(reader.writes.last?.fields["pinnedHosts"] as? FirestoreArrayChange)
    XCTAssertEqual(removed.kind, .remove)
    XCTAssertEqual((removed.elements.first as? [String: String]) ?? [:], ["orgId": "o1", "hostId": "h1"])
    XCTAssertEqual(store.pinnedHosts(in: "o2"), ["h2"], "another workspace's pins stay")
  }

  func testAPinThatMovesWorkspaceWritesTheList() async throws {
    let reader = RecordingReader()
    let store = AccountPreferencesStore(uid: "u1", reader: reader)
    store.apply(stored([("o1", "h1"), ("o2", "h2")]))
    XCTAssertEqual(store.toggleHostPin("h1", orgID: "o2"), .pinned)
    await settle()
    let list = try XCTUnwrap(reader.writes.last?.fields["pinnedHosts"] as? [[String: Any]])
    XCTAssertEqual(list.map { $0["hostId"] as? String }, ["h2", "h1"])
    XCTAssertEqual(store.pinnedHosts(in: "o2"), ["h2", "h1"])
    XCTAssertEqual(store.pinnedHosts(in: "o1"), [])
  }

  func testARefusedWritePutsTheStoredPinsBack() async {
    let reader = RecordingReader()
    reader.refuse = true
    let store = AccountPreferencesStore(uid: "u1", reader: reader)
    store.apply(stored([("o1", "h1")]))
    store.toggleHostPin("h2", orgID: "o1")
    XCTAssertEqual(store.pinnedHosts(in: "o1"), ["h1", "h2"])
    await settle()
    XCTAssertEqual(store.pinnedHosts(in: "o1"), ["h1"], "the rules refused it, so the pin is gone again")
    XCTAssertNotNil(store.writeError)
  }

  func testAPinMadeOnAnotherDeviceArrives() {
    let store = AccountPreferencesStore(uid: "u1", reader: RecordingReader())
    store.apply(stored([("o1", "h1")]))
    store.apply(stored([("o1", "h1"), ("o1", "h9")]))
    XCTAssertEqual(store.pinnedHosts(in: "o1"), ["h1", "h9"])
  }

  func testReplaceOneWritesTheList() async throws {
    let reader = RecordingReader()
    let store = AccountPreferencesStore(uid: "u1", reader: reader)
    store.apply(stored([("o1", "h1"), ("o1", "h2")]))
    store.replaceHostPin("h1", with: "h5", orgID: "o1")
    XCTAssertEqual(store.pinnedHosts(in: "o1"), ["h5", "h2"])
    await settle()
    let list = try XCTUnwrap(reader.writes.last?.fields["pinnedHosts"] as? [[String: Any]])
    XCTAssertEqual(list.map { $0["hostId"] as? String }, ["h5", "h2"])
    XCTAssertFalse(store.hostPinsFull(in: "o1"))
  }

  func testAFullWorkspaceAsksInsteadOfWriting() async {
    let reader = RecordingReader()
    let store = AccountPreferencesStore(uid: "u1", reader: reader)
    let max = ContractValues.shared.pinnedHostsMax
    store.apply(stored((0..<max).map { ("o1", "h\($0)") }))
    XCTAssertTrue(store.hostPinsFull(in: "o1"))
    XCTAssertEqual(store.toggleHostPin("new", orgID: "o1"), .full)
    await settle()
    XCTAssertTrue(reader.writes.isEmpty)
  }
}

final class RestArrayChangeTests: XCTestCase {
  func testAnArrayChangeTravelsAsATransform() throws {
    var transforms: [[String: Any]] = []
    let fields = RestFirestoreReader.encodeFields(
      ["pinnedHosts": FirestoreArrayChange.union([["orgId": "o1", "hostId": "h1"]]), "name": "x"], prefix: [],
      transforms: &transforms)
    XCTAssertNil(fields["pinnedHosts"], "the transform writes it, not the fields")
    XCTAssertNotNil(fields["name"])
    let transform = try XCTUnwrap(transforms.first)
    XCTAssertEqual(transform["fieldPath"] as? String, "pinnedHosts")
    let values = (transform["appendMissingElements"] as? [String: Any])?["values"] as? [[String: Any]]
    XCTAssertEqual(values?.count, 1)
    XCTAssertEqual(RestFirestoreReader.leafPaths(["pinnedHosts": FirestoreArrayChange.remove(["a"]), "name": "x"], prefix: []), ["name"])

    transforms = []
    _ = RestFirestoreReader.encodeFields(["pinnedHosts": FirestoreArrayChange.remove(["a"])], prefix: [], transforms: &transforms)
    XCTAssertNotNil(transforms.first?["removeAllFromArray"])
  }
}
