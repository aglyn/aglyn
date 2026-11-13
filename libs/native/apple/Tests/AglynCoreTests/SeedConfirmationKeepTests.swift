// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import Foundation
import XCTest

@testable import AglynCore

/// A confirmed listener stays confirmed through a short fall back to the cache, and lapses by the wall clock
/// (AGL-4047, the console's `listen-confirmation.spec.ts`, #2670). Kotlin's SeedConfirmationKeepTest asserts the same.
final class SeedConfirmationKeepTests: XCTestCase {
  private let start = Date(timeIntervalSince1970: 1_000_000)

  func testAnUnconfirmedListenerReportsTheCacheAsItIs() {
    var keep = SeedConfirmationKeep()
    XCTAssertTrue(keep.report(fromCache: true, now: start, keptFor: 60), "never confirmed: nothing to keep")
    XCTAssertFalse(keep.keeping)
    XCTAssertFalse(keep.report(fromCache: false, now: start, keptFor: 60))
    XCTAssertTrue(keep.confirmed)
  }

  func testAConfirmationIsKeptThroughAShortFallAndRenewedByTheServer() {
    var keep = SeedConfirmationKeep()
    _ = keep.report(fromCache: false, now: start, keptFor: 60)
    XCTAssertFalse(keep.report(fromCache: true, now: start + 1, keptFor: 60), "kept: still confirmed")
    XCTAssertEqual(keep.keptUntil, start + 61, "counted from the first fall")
    XCTAssertFalse(keep.report(fromCache: true, now: start + 30, keptFor: 60), "a second cached snapshot keeps the deadline")
    XCTAssertEqual(keep.keptUntil, start + 61)
    XCTAssertFalse(keep.report(fromCache: false, now: start + 40, keptFor: 60), "the server answers again")
    XCTAssertFalse(keep.keeping)
    XCTAssertFalse(keep.report(fromCache: true, now: start + 200, keptFor: 60), "a later fall is kept afresh")
    XCTAssertEqual(keep.keptUntil, start + 260)
  }

  func testAKeptConfirmationLapsesAtItsDeadline() {
    var keep = SeedConfirmationKeep()
    _ = keep.report(fromCache: false, now: start, keptFor: 60)
    _ = keep.report(fromCache: true, now: start, keptFor: 60)
    XCTAssertFalse(keep.lapseIfOverdue(now: start + 59))
    XCTAssertTrue(keep.lapseIfOverdue(now: start + 60))
    XCTAssertFalse(keep.confirmed)
    XCTAssertTrue(keep.report(fromCache: true, now: start + 61, keptFor: 60), "lapsed: the cache is the cache again")
    XCTAssertFalse(keep.keeping, "and is not kept again until the server confirms")
  }

  func testACachedSnapshotPastTheDeadlineLapsesItWithoutTheWatch() {
    var keep = SeedConfirmationKeep()
    _ = keep.report(fromCache: false, now: start, keptFor: 60)
    _ = keep.report(fromCache: true, now: start, keptFor: 60)
    XCTAssertTrue(keep.report(fromCache: true, now: start + 600, keptFor: 60), "a device that slept past it")
    XCTAssertFalse(keep.confirmed)
  }

  func testNoKeepLapsesAtTheFall() {
    var keep = SeedConfirmationKeep()
    _ = keep.report(fromCache: false, now: start, keptFor: 0)
    XCTAssertTrue(keep.report(fromCache: true, now: start, keptFor: 0))
  }

  func testAResetForgetsTheConfirmation() {
    var keep = SeedConfirmationKeep()
    _ = keep.report(fromCache: false, now: start, keptFor: 60)
    keep.reset()
    XCTAssertTrue(keep.report(fromCache: true, now: start, keptFor: 60), "a refused listener's confirmation never counts")
  }

  @MainActor
  func testTheKeeperLapsesByTheWallClockAndRedeliversAsTheCaches() async throws {
    let savedTick = SeedConfirmationKeeper.tick
    SeedConfirmationKeeper.tick = .milliseconds(10)
    defer { SeedConfirmationKeeper.tick = savedTick }
    var clock = start
    let keeper = SeedConfirmationKeeper(now: { clock })
    var lapses = 0
    keeper.onLapse = { lapses += 1 }

    XCTAssertFalse(keeper.report(fromCache: false))
    XCTAssertFalse(keeper.report(fromCache: true), "kept")
    try await Task.sleep(for: .milliseconds(60))
    XCTAssertEqual(lapses, 0, "the wall clock has not reached the deadline")

    clock = start + 61  // the device slept, or a minute went by
    for _ in 0..<50 where lapses == 0 { try await Task.sleep(for: .milliseconds(10)) }
    XCTAssertEqual(lapses, 1)
    XCTAssertTrue(keeper.report(fromCache: true), "lapsed")
    try await Task.sleep(for: .milliseconds(40))
    XCTAssertEqual(lapses, 1, "it lapses once")
  }

  @MainActor
  func testTheServerAnsweringStopsTheWatch() async throws {
    let savedTick = SeedConfirmationKeeper.tick
    SeedConfirmationKeeper.tick = .milliseconds(10)
    defer { SeedConfirmationKeeper.tick = savedTick }
    var clock = start
    let keeper = SeedConfirmationKeeper(now: { clock })
    var lapses = 0
    keeper.onLapse = { lapses += 1 }

    _ = keeper.report(fromCache: false)
    _ = keeper.report(fromCache: true)
    XCTAssertFalse(keeper.report(fromCache: false), "the server confirmed again")
    clock = start + 600
    try await Task.sleep(for: .milliseconds(60))
    XCTAssertEqual(lapses, 0)
  }
}
