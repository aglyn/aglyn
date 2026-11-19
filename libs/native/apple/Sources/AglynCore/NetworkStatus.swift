// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import Foundation
import Network
import Observation

/// Whether the device has a network connection (the console's `useOnlineStatus`, AGL-1056): the shell says "Offline" while it
/// has none, so nobody keeps editing while every write quietly fails.
@MainActor
@Observable
public final class NetworkStatus {
  public private(set) var online = true
  nonisolated(unsafe) private let monitor = NWPathMonitor()

  /// The console's words for the indicator's tooltip.
  public static let detail =
    "Your device has lost its network connection. Changes you make now cannot be saved until it comes back."

  public init() {
    monitor.pathUpdateHandler = { [weak self] path in
      let satisfied = path.status == .satisfied
      Task { @MainActor in self?.set(online: satisfied) }
    }
    monitor.start(queue: DispatchQueue(label: "com.aglyn.network-status"))
  }

  deinit { monitor.cancel() }

  /// What the path last said; a test sets it directly.
  func set(online: Bool) {
    if self.online != online { self.online = online }
  }
}
