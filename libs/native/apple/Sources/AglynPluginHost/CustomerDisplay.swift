// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import Foundation
import Observation

/*
 * THE CUSTOMER DISPLAY SEAM (AGL-4042), as core's plugin-customer-display has it in the console: a register with a
 * connected customer display registers itself while it can show something, and any plugin's widget on that screen asks
 * for it and hands it a screen, one of the asking plugin's own public console pages (`/kiosk/{pluginId}{path}`) with a
 * few short parameters. Neither side names the other plugin. The paired display is the authorization: the page reads
 * the display's own credential, never anything minted here. The Kotlin kit's CustomerDisplay.kt.
 */

/// What a plugin asks a paired display to show.
public struct CustomerDisplayScreen: Equatable, Sendable {
  /// The plugin whose public page it is.
  public let pluginID: String
  /// The page's path beneath `/kiosk/{pluginId}`, with its leading slash: `/display-sign`.
  public let path: String
  /// A few short, plain parameters; never a customer's details.
  public let params: [String: String]

  public init(pluginID: String, path: String, params: [String: String] = [:]) {
    self.pluginID = pluginID
    self.path = path
    self.params = params
  }
}

/// What a register with a connected display offers.
public struct CustomerDisplayHost: Sendable {
  /// Puts a plugin's screen on the display; false when it could not.
  public let show: @MainActor @Sendable (CustomerDisplayScreen) async -> Bool
  /// Takes a plugin's own screen off the display, only while it is the one showing.
  public let close: @MainActor @Sendable (_ pluginID: String) async -> Void

  public init(
    show: @escaping @MainActor @Sendable (CustomerDisplayScreen) async -> Bool,
    close: @escaping @MainActor @Sendable (_ pluginID: String) async -> Void
  ) {
    self.show = show
    self.close = close
  }
}

/// The register's display while it has one to show things on; nil otherwise.
@MainActor
@Observable
public final class CustomerDisplayHosts {
  public static let shared = CustomerDisplayHosts()

  public private(set) var current: CustomerDisplayHost?
  @ObservationIgnored private var currentToken = 0
  @ObservationIgnored private var nextToken = 0

  public init() {}

  /// Registers a host; withdraw it with the returned token when the display goes.
  public func register(_ host: CustomerDisplayHost) -> Int {
    nextToken += 1
    currentToken = nextToken
    current = host
    return nextToken
  }

  /// Withdraws a host, only if it is still the current one.
  public func withdraw(_ token: Int) {
    guard token == currentToken else { return }
    current = nil
  }
}
