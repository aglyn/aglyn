// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import Foundation
import Observation

/// One screen's writes, one at a time (the Kotlin kit's `ActionRunner`):
/// whether one is running, why the last one failed, and what the last one
/// did. A screen's sheets read `busy` and `error`; its banner reads `notice`.
/// The console's own words come through: a route's refusal is shown as the
/// route wrote it, and a rules refusal reads as the role it needs.
@MainActor
@Observable
public final class ActionRunner {
  public private(set) var busy = false
  public var error: String?
  /// What just happened, for the screen's banner.
  public var notice: String?
  @ObservationIgnored private let roleHint: String

  public init(roleHint: String = "an editor or admin") {
    self.roleHint = roleHint
  }

  /// Runs `block` unless another write is running; `onDone` follows a success.
  public func run(
    _ success: String? = nil, onDone: @escaping @MainActor () -> Void = {},
    _ block: @escaping @MainActor () async throws -> Void
  ) {
    guard !busy else { return }
    busy = true
    error = nil
    Task { @MainActor in
      defer { busy = false }
      do {
        try await block()
        if let success { notice = success }
        onDone()
      } catch is CancellationError {
      } catch {
        self.error = describe(error)
      }
    }
  }

  public func clear() {
    error = nil
    notice = nil
  }

  /// A failure in a person's words.
  public func describe(_ failure: Error) -> String {
    let text = (failure as? ConsoleAPIError)?.message ?? (failure as NSError).localizedDescription
    if let api = failure as? ConsoleAPIError, !(api.status == 403 && text.lowercased().contains("insufficient")) {
      return api.message
    }
    if text.range(of: "permission", options: .caseInsensitive) != nil {
      return "That change needs a different role — ask \(roleHint)."
    }
    return "That did not go through. Check the connection and try again."
  }
}
