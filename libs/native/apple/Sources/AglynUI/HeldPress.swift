// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import SwiftUI

/// A Save pressed while it is held is KEPT, not dropped (AGL-4047, the console's `useHeldSave`, #2643).
///
/// While the data a form is seeded from is only the device cache's copy, its Save is held. A press in that window used to
/// land on a disabled button and do nothing. Now the press is kept: the button shows it is saving from the press, and the
/// save runs once the server's copy is in, over the edits as they are replayed onto that copy, never over the cache's
/// values the press was made on. If no confirmation comes within the guard's wait, the guard's refusal shows and nothing is
/// written. Controls that write on each change (switches, reorder, delete, archive) stay held instead. The Kotlin kit's
/// `HeldPress`.
public struct AglynHeldPress: Equatable, Sendable {
  /// A press is kept, waiting for the server's copy.
  public private(set) var waiting = false
  /// Why the last kept press saved nothing; cleared by the next press.
  public private(set) var refusal: String?
  /// Counts kept presses, so each gets its own wait.
  public private(set) var press = 0

  /// How long a kept press waits for the server's copy: the guard's own wait (`seedConfirmWaitMs`).
  @MainActor public static var confirmWait: Duration = .seconds(12)

  public init() {}

  /// Press Save. True when it should run now (nothing is held); while held, the press is kept and this is false. A press
  /// while one is already kept is the same press.
  public mutating func pressed(checking: Bool) -> Bool {
    guard !waiting else { return false }
    refusal = nil
    guard checking else { return true }
    waiting = true
    press += 1
    return false
  }

  /// The hold changed. True when a kept press should run now, because the server's copy is in.
  public mutating func lifted(checking: Bool) -> Bool {
    guard waiting, !checking else { return false }
    waiting = false
    return true
  }

  /// The wait ran out with the hold still on: the press saves nothing and the guard's refusal shows.
  public mutating func timedOut(_ message: String) {
    guard waiting else { return }
    waiting = false
    refusal = message
  }

  /// The surface was discarded or closed: a kept press is dropped with it, and so is its refusal.
  public mutating func reset() {
    waiting = false
    refusal = nil
  }
}

extension View {
  /// Runs a kept press once `checking` lifts, and refuses it with `refusal` once the guard's wait runs out. `run` is the
  /// surface's save as it is now; it runs a moment after the lift, so it reads the edits replayed onto the server's copy.
  public func aglynHeldPress(
    _ held: Binding<AglynHeldPress>, checking: Bool, refusal: String, run: @escaping @MainActor () -> Void
  ) -> some View {
    self
      .onChange(of: checking) { _, now in
        guard held.wrappedValue.lifted(checking: now) else { return }
        Task { @MainActor in
          await Task.yield()
          run()
        }
      }
      .task(id: held.wrappedValue.press) {
        guard held.wrappedValue.waiting else { return }
        try? await Task.sleep(for: AglynHeldPress.confirmWait)
        guard !Task.isCancelled else { return }
        held.wrappedValue.timedOut(refusal)
      }
  }
}

/// What a form card is held on (AGL-4047): the sentence beside a held Save, and the refusal a kept press shows when the
/// server's copy never comes (`seedCheckingText` and `seedUnconfirmedText` of the guard's subject).
public struct AglynFormHold: Equatable, Sendable {
  public let checking: String
  public let unconfirmed: String

  public init(checking: String, unconfirmed: String) {
    self.checking = checking
    self.unconfirmed = unconfirmed
  }
}
