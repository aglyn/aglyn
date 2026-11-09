// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import AglynPluginHost
import AglynUI
import Foundation
import SwiftUI

/*
 * A RIDER'S WAIVER AT CHECK-IN (AGL-4042), as the console's WaiverCheckInStatus draws it in commerce's `posCheckIn`
 * zone: "Waiver signed", "Signed for 2 of 3 riders" or "Waiver needed", matched by email first and, when the email
 * matches nothing, by the name and birth date the site's CRM record of the customer keeps (`contactId`). A rider with no
 * email match and no birth date on file reads "Waiver not matched", and Find by name asks for a date of birth. Sign
 * waiver opens the store's own signing page for the rider, and Check again reads the status once more. Draws nothing for
 * a member who may not see signatures (the route refuses them). The zone hands what the console's does, as `slotProps`;
 * this plugin never imports commerce. The Kotlin kit's WaiverCheckIn.kt.
 */

public let waiversCheckInSlot = "posCheckIn"
public let waiversCheckInWidget = "waivers.check-in-status"
let waiversStatusRoute = "/api/waivers/status"
/// The store's own signing page, at `/{path}` on its site (`WAIVERS_SITE_SIGN_PATH`).
let waiversSiteSignPath = "sign-waiver"
/// The waivers plugin's public page a paired customer display signs on (`WAIVERS_DISPLAY_PAGE_PATH`).
let waiversDisplayPagePath = "/display-sign"
let waiversPluginID = "waivers"

/// The status route's answer.
public struct WaiverStatusAnswer: Equatable, Sendable {
  public var signed: Bool
  public var label: String
  /// False with a `searchName`: no email match and no birth date to match the name with.
  public var matched: Bool?
  public var searchName: String?

  public init(signed: Bool, label: String, matched: Bool? = nil, searchName: String? = nil) {
    self.signed = signed
    self.label = label
    self.matched = matched
    self.searchName = searchName
  }

  public init?(_ json: JSONValue?) {
    guard let json, let label = json["label"]?.stringValue else { return nil }
    self.init(
      signed: json["signed"]?.boolValue == true, label: label, matched: json["matched"]?.boolValue,
      searchName: json["searchName"]?.stringValue)
  }
}

/// What the row shows for an answer (nil: the route answered nothing usable).
public struct WaiverStatusLook: Equatable, Sendable {
  public let label: String
  public let signedInFull: Bool
  public let needed: Bool
  public let notMatched: Bool

  public init(_ status: WaiverStatusAnswer?) {
    label = status?.label ?? "Waiver not on file"
    signedInFull = status?.signed == true && label == "Waiver signed"
    needed = !signedInFull
    notMatched = status?.matched == false && !(status?.searchName ?? "").isEmpty
  }
}

/// The status query the console's widget sends: email, the CRM contact, the name, and the people due when more than one.
public func waiverStatusQuery(
  hostID: String, dayKey: String, email: String?, contactID: String?, name: String?, unitsDue: Int?
) -> [(String, String?)] {
  func present(_ value: String?) -> String? {
    guard let value = value?.trimmingCharacters(in: .whitespaces), !value.isEmpty else { return nil }
    return value
  }
  return [
    ("hostId", hostID), ("dayKey", dayKey), ("email", present(email)), ("contactId", present(contactID)),
    ("name", present(name)), ("people", (unitsDue ?? 0) > 1 ? String(unitsDue ?? 0) : nil),
  ]
}

/// The widget in the `posCheckIn` zone.
struct WaiverCheckInStatusView: View {
  let context: NativePluginContext
  @Environment(\.slotProps) private var props
  @Environment(\.openURL) private var openURL
  @State private var state: LoadState = .loading
  @State private var revision = 0
  @State private var opened = false
  @State private var findingByName = false
  @State private var notice: String?
  /// Sent to the customer display from this row, until the status reads signed.
  @State private var sent = false
  @State private var displayError: String?
  private var display: CustomerDisplayHost? { CustomerDisplayHosts.shared.current }

  enum LoadState: Equatable {
    case loading, hidden
    case ready(WaiverStatusAnswer?)
  }

  private var hostID: String { props["hostId"] ?? context.hostID ?? "" }
  private var dayKey: String { props["dayKey"] ?? "" }
  private var name: String { (props["name"] ?? "").trimmingCharacters(in: .whitespaces) }
  private var compact: Bool { props["placement"] == "check-in-row" }

  var body: some View {
    Group {
      switch state {
      case .hidden:
        EmptyView()
      case .loading:
        ProgressView().controlSize(.small).accessibilityLabel("Checking the waiver")
      case .ready(let status):
        let look = WaiverStatusLook(status)
        let chip = StatusChip(look.label, tone: look.signedInFull ? .success : .warning)
          .accessibilityIdentifier("waiver-status")
        // One row where it fits, else the actions under the status (a phone's narrow sheet).
        ViewThatFits(in: .horizontal) {
          HStack(spacing: AglynSpace.one) {
            chip
            actions(look)
          }
          VStack(alignment: .leading, spacing: AglynSpace.half) {
            chip
            HStack(spacing: AglynSpace.two) { actions(look) }
          }
        }
        if sent && look.needed {
          StatusChip("Sent to the customer display").accessibilityIdentifier("waiver-sent-to-display")
        }
        if let displayError { AglynNotice(displayError, tone: .warning) { self.displayError = nil } }
        if let notice { Text(notice).font(AglynFont.caption).foregroundStyle(.secondary) }
        // Inline rather than a sheet: the zone sits in a row of the register's own sheet, where a second sheet is
        // refused while the first is up.
        if findingByName, let searchName = status?.searchName {
          WaiverNameCheckForm(context: context, hostID: hostID, dayKey: dayKey, name: searchName) {
            findingByName = false
            revision += 1
          }
        }
      }
    }
    .task(id: "\(hostID)|\(dayKey)|\(props["email"] ?? "")|\(props["contactId"] ?? "")|\(name)|\(revision)") { await load() }
  }

  @ViewBuilder private func actions(_ look: WaiverStatusLook) -> some View {
    if look.notMatched {
      Button("Find by name") { findingByName = true }.buttonStyle(.borderless)
        .accessibilityIdentifier("waiver-find-by-name")
    }
    if look.needed {
      Button(compact ? "Sign" : "Sign waiver") { Task { await openSigning() } }.buttonStyle(.borderless)
        .accessibilityIdentifier("waiver-sign")
    }
    if display != nil && look.needed {
      Button("Customer display") { Task { await showOnDisplay() } }.buttonStyle(.borderless)
        .accessibilityIdentifier("waiver-customer-display")
    }
    if (opened || sent) && look.needed {
      Button("Check again") { revision += 1 }.buttonStyle(.borderless)
        .accessibilityIdentifier("waiver-check-again")
    }
  }

  private func load() async {
    let email = props["email"], contact = props["contactId"]
    guard !hostID.isEmpty, !dayKey.isEmpty else { return }
    if (email ?? "").isEmpty && (contact ?? "").isEmpty && name.isEmpty {
      state = .ready(nil)
      return
    }
    do {
      let answer = try await context.api.request(
        waiversStatusRoute,
        query: waiverStatusQuery(
          hostID: hostID, dayKey: dayKey, email: email, contactID: contact, name: name,
          unitsDue: props["unitsDue"].flatMap { Int($0) }))
      state = .ready(WaiverStatusAnswer(answer))
    } catch is CancellationError {
      return
    } catch let error as ConsoleAPIError where error.status == 403 || error.status == 404 {
      // Not this member's to see, or no plan with waivers: say nothing.
      state = .hidden
    } catch {
      state = .ready(nil)
    }
  }

  /// Sends the signing to the register's paired display: the display's own pairing is what lets it sign, so nothing is
  /// minted for it here, and the site is the screen's one parameter.
  private func showOnDisplay() async {
    guard let display else { return }
    displayError = nil
    if await display.show(CustomerDisplayScreen(pluginID: waiversPluginID, path: waiversDisplayPagePath, params: ["host": hostID])) {
      sent = true
    } else {
      displayError = "The customer display didn’t answer. Check that it is on, or hand over this device."
    }
  }

  /// The store's own signing page, on its custom domain else its platform address, for the rider to sign on this device.
  private func openSigning() async {
    notice = nil
    let host = (try? await context.firestore.readOnce(["hosts", hostID]))?.data ?? [:]
    let custom = (host["cname"] as? String)?.trimmingCharacters(in: .whitespaces)
    let domain = (custom?.isEmpty == false ? custom : nil) ?? HostStatus.siteAddress(host["subdomain"] as? String)
    guard let domain, let url = URL(string: "https://\(domain)/\(waiversSiteSignPath)") else {
      notice = "This site has no address to sign on yet."
      return
    }
    opened = true
    openURL(url)
  }
}

/// Find a rider's waiver by name and date of birth (the console's WaiverNameCheckDialog), under the status.
struct WaiverNameCheckForm: View {
  let context: NativePluginContext
  let hostID: String
  let dayKey: String
  let onClose: () -> Void
  @State private var name: String
  @State private var dateOfBirth: Date?
  @State private var answer: WaiverStatusAnswer?
  @State private var busy = false
  @State private var error: String?

  init(context: NativePluginContext, hostID: String, dayKey: String, name: String, onClose: @escaping () -> Void) {
    self.context = context
    self.hostID = hostID
    self.dayKey = dayKey
    self.onClose = onClose
    _name = State(initialValue: name)
  }

  private static func dayKey(_ date: Date) -> String {
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.calendar = Calendar(identifier: .gregorian)
    formatter.dateFormat = "yyyy-MM-dd"
    return formatter.string(from: date)
  }

  var body: some View {
    VStack(alignment: .leading, spacing: AglynSpace.one) {
      Text("Find a waiver by name").font(AglynFont.headline)
      Text(
        "Ask the rider’s date of birth to match their name and birth date with a signed waiver, theirs or one a parent signed for them."
      )
      .font(AglynFont.caption).foregroundStyle(.secondary)
      TextField("Full name", text: $name).textFieldStyle(.roundedBorder).accessibilityIdentifier("waiver-name")
      DatePicker(
        "Date of birth",
        selection: Binding(get: { dateOfBirth ?? Date() }, set: { dateOfBirth = $0; answer = nil }),
        in: ...Date(), displayedComponents: .date
      )
      .accessibilityIdentifier("waiver-dob")
      HStack(spacing: AglynSpace.two) {
        Button("Check") { Task { await check() } }
          .buttonStyle(.borderedProminent)
          .disabled(busy || name.trimmingCharacters(in: .whitespaces).isEmpty || dateOfBirth == nil)
          .accessibilityIdentifier("waiver-check")
        Button("Close", action: onClose).buttonStyle(.borderless)
      }
      if let answer {
        StatusChip(
          answer.matched == true ? answer.label : "No signed waiver for that name and date of birth",
          tone: answer.signed ? .success : .warning)
        .accessibilityIdentifier("waiver-check-answer")
      }
      if let error { AglynNotice(error, tone: .warning) }
    }
    .padding(.vertical, AglynSpace.half)
    .accessibilityIdentifier("waiver-name-check")
  }

  private func check() async {
    guard let dateOfBirth else { return }
    busy = true
    error = nil
    answer = nil
    defer { busy = false }
    do {
      let json = try await context.api.request(
        waiversStatusRoute,
        query: [
          ("hostId", hostID), ("dayKey", dayKey), ("name", name.trimmingCharacters(in: .whitespaces)),
          ("dateOfBirth", Self.dayKey(dateOfBirth)),
        ])
      answer = WaiverStatusAnswer(json)
      if answer == nil { error = "The waiver could not be checked." }
    } catch let failure as ConsoleAPIError {
      error = failure.body?["error"]?.stringValue ?? "The waiver could not be checked."
    } catch {
      self.error = "The waiver could not be checked."
    }
  }
}
