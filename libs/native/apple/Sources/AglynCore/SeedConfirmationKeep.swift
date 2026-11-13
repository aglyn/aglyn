// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import Foundation

/// A listener the server confirmed stays confirmed through a short fall back to the device cache (AGL-4047, the
/// console's `listen-confirmation.ts`, #2670).
///
/// A confirmed listener reads `fromCache` again whenever the device drops off the network for a moment, though its
/// values did not move. A form seeded from it then held its next Save, and refused it once the guard's wait ran out.
/// Such a fall is not what the guard exists for: a cached snapshot that FOLLOWS a confirmation on the same listener
/// holds nothing older than that confirmation, since the cache only moves forward, and up to the fall the listener
/// heard every change as it happened. So the confirmation is kept for ``keptFor`` from the first cached snapshot: the
/// listener keeps reporting `fromCache` false. If the server has not confirmed it again by then, the confirmation
/// LAPSES and the listener reports `fromCache` true like any unconfirmed one, so a save waits for the server. The
/// deadline is read from the wall clock, so a device that slept through it lapses as it wakes. The Kotlin kit's
/// `SeedConfirmationKeep`.
public struct SeedConfirmationKeep: Equatable, Sendable {
  /// How long a confirmation is kept after the fall: the console's `SEED_CONFIRMATION_KEPT_MS`.
  public static let defaultKeptFor: TimeInterval = 60
  /// How long a confirmation is kept. A test that pins the lapse sets it, and puts back ``defaultKeptFor``.
  @MainActor public static var keptFor: TimeInterval = defaultKeptFor

  /// The server's latest word on this listener was a confirmation, and it has not lapsed.
  public private(set) var confirmed = false
  /// When a confirmation kept through a fall lapses; nil while none is being kept.
  public private(set) var keptUntil: Date?

  public init() {}

  /// A confirmation is being kept through a fall back to the cache.
  public var keeping: Bool { keptUntil != nil }

  /// A snapshot arrived. Returns the `fromCache` the listener reports: the snapshot's own, except that a cached
  /// snapshot following a confirmation reads false until the keep's deadline.
  public mutating func report(fromCache: Bool, now: Date, keptFor: TimeInterval) -> Bool {
    guard fromCache else {
      confirmed = true
      keptUntil = nil
      return false
    }
    if confirmed, keptFor > 0 {
      let until = keptUntil ?? now.addingTimeInterval(keptFor)
      keptUntil = until
      if now < until { return false }
    }
    reset()
    return true
  }

  /// The wall clock passed a kept confirmation's deadline: it lapses. True when it lapsed now.
  public mutating func lapseIfOverdue(now: Date) -> Bool {
    guard let until = keptUntil, now >= until else { return false }
    reset()
    return true
  }

  /// The listener was refused or torn down: nothing it said before counts.
  public mutating func reset() {
    confirmed = false
    keptUntil = nil
  }
}

/// One listener's keep, with the watch that lapses it. While a confirmation is kept it reads the wall clock every
/// ``tick``; on the lapse it calls `onLapse`, which re-delivers the last snapshot as the cache's.
@MainActor
public final class SeedConfirmationKeeper {
  /// How often a kept confirmation reads the wall clock. Short, so a device that slept lapses within it of waking.
  public static var tick: Duration = .seconds(1)

  private var keep = SeedConfirmationKeep()
  private var watch: Task<Void, Never>?
  private let now: () -> Date
  /// Runs once a kept confirmation lapses.
  public var onLapse: (() -> Void)?

  public init(now: @escaping () -> Date = Date.init) {
    self.now = now
  }

  /// A snapshot arrived: the `fromCache` to report for it.
  public func report(fromCache: Bool) -> Bool {
    let reported = keep.report(fromCache: fromCache, now: now(), keptFor: SeedConfirmationKeep.keptFor)
    if keep.keeping {
      if watch == nil { startWatch() }
    } else {
      stopWatch()
    }
    return reported
  }

  /// The listener was refused or removed.
  public func reset() {
    keep.reset()
    stopWatch()
  }

  /// Lapses a kept confirmation whose deadline the wall clock has passed, and says so.
  @discardableResult
  public func lapseIfOverdue() -> Bool {
    guard keep.lapseIfOverdue(now: now()) else { return false }
    stopWatch()
    onLapse?()
    return true
  }

  private func startWatch() {
    watch = Task { @MainActor [weak self] in
      while !Task.isCancelled {
        try? await Task.sleep(for: Self.tick)
        guard !Task.isCancelled, let self else { return }
        if self.lapseIfOverdue() { return }
      }
    }
  }

  private func stopWatch() {
    watch?.cancel()
    watch = nil
  }
}
