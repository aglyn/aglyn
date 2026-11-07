// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynPluginHost
import AglynUI
import Foundation
import Observation
import SwiftUI

/*
 * SELLING A CARD READER AT THE PLATFORM'S OWN STORE'S REGISTER (AGL-4038), as the console's PosHardwareBuyer has it:
 * on a sale that has one, the buyer is attached to it here (found by email, name or workspace), the buyer accepts the
 * terms of sale before paying (on the customer display, on this tablet, or by the booth sign), and each reader's serial
 * is taken, or the reader registered to the buyer's store by its code. Every reader sold without a buyer waits on the To
 * attach list. Draws nothing on any store but the platform's own hardware seller (`status`). The route
 * (`/api/commerce/pos-hardware-sale`) does all of it. The Kotlin kit's PosHardwareSale.kt.
 */

let posHardwareSaleRoute = "/api/commerce/pos-hardware-sale"
/// The display page the terms open at, beneath `/kiosk/commerce`.
let posHardwareTermsScreenPath = "/hardware-terms"
/// The printable booth sign, a public page of this plugin.
let posHardwareTermsSignPath = "/kiosk/commerce/hardware-terms-sign"
/// How often the register asks whether the buyer accepted on the display.
let posHardwareTermsPoll: Duration = .milliseconds(2_500)

/// A sale on the To attach list, as `pending` and `attach` answer it.
struct HardwareToAttachRow: Identifiable, Hashable {
  let id: String
  let number: String
  let registerNumber: Int?
  let online: Bool
  let kiosk: Bool
  let offline: Bool
  let lines: [(quantity: Int, name: String)]
  let totalCents: Int
  let createdAtMs: Double
  let contactEmail: String?
  let invited: Bool
  let awaitingWorkspace: Bool

  static func == (a: Self, b: Self) -> Bool { a.id == b.id }
  func hash(into hasher: inout Hasher) { hasher.combine(id) }

  init?(_ json: JSONValue) {
    guard let id = json["id"]?.stringValue else { return nil }
    self.id = id
    number = json["number"]?.stringValue ?? ""
    registerNumber = json["registerNumber"]?.numberValue.map { Int($0) }
    online = json["online"]?.boolValue == true
    kiosk = json["kiosk"]?.boolValue == true
    offline = json["offline"]?.boolValue == true
    lines = (json["lines"]?.arrayValue ?? []).map {
      (Int($0["quantity"]?.numberValue ?? 0), $0["name"]?.stringValue ?? "")
    }
    totalCents = Int(json["totalCents"]?.numberValue ?? 0)
    createdAtMs = json["createdAtMs"]?.numberValue ?? 0
    contactEmail = json["contactEmail"]?.stringValue
    invited = json["invited"]?.boolValue == true
    awaitingWorkspace = json["awaitingWorkspace"]?.boolValue == true
  }

  var linesLabel: String {
    lines.map { "\($0.quantity) × \($0.name)" }.joined(separator: ", ") + " · " + posMoney(totalCents, currency: "usd")
  }

  var detail: String {
    [
      registerNumber.map { "\(online ? "Online order" : "Sale") #\($0)" } ?? number,
      Date(timeIntervalSince1970: createdAtMs / 1000).formatted(date: .abbreviated, time: .shortened),
      kiosk ? "at the kiosk" : nil, offline ? "rung offline" : nil,
      invited ? "invited \(contactEmail ?? "")".trimmingCharacters(in: .whitespaces) : contactEmail,
      awaitingWorkspace ? "has an account, no workspace yet" : nil,
    ].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · ")
  }
}

/// One way the hardware can go: a person's workspace store, the store chosen at setup, or an invitation.
struct HardwareBuyerOption: Identifiable, Hashable {
  let id: String
  let label: String
  let detail: String?
  let choice: JSONValue
  /// A store chosen with no card reader location yet: the booth asks for its address.
  let needsAddress: Bool
  let storeChosen: Bool
}

/// Every option a `find` answer offers, people first (the console's `optionsOf`).
func hardwareBuyerOptions(_ found: JSONValue) -> [HardwareBuyerOption] {
  func workspaceOptions(uid: String, workspace: JSONValue, who: String) -> [HardwareBuyerOption] {
    let orgID = workspace["orgId"]?.stringValue ?? ""
    let name = workspace["name"]?.stringValue ?? ""
    let plan = workspace["posPlan"]?.boolValue == true ? nil : "No point of sale plan yet: they add it when they set the reader up"
    var options: [HardwareBuyerOption] = (workspace["stores"]?.arrayValue ?? []).map { store in
      let hostID = store["hostId"]?.stringValue ?? ""
      let hasLocation = store["hasLocation"]?.boolValue == true
      let detail = [plan, hasLocation ? nil : "No card reader location on this store yet: you can enter its address here"]
        .compactMap { $0 }.joined(separator: ". ")
      return HardwareBuyerOption(
        id: "\(uid):\(orgID):\(hostID)", label: "\(who) · \(name) · \(store["name"]?.stringValue ?? "")",
        detail: detail.isEmpty ? nil : detail,
        choice: ["uid": .string(uid), "orgId": .string(orgID), "hostId": .string(hostID)], needsAddress: !hasLocation,
        storeChosen: true)
    }
    options.append(
      HardwareBuyerOption(
        id: "\(uid):\(orgID):", label: "\(who) · \(name) · choose the store at setup", detail: plan,
        choice: ["uid": .string(uid), "orgId": .string(orgID)], needsAddress: false, storeChosen: false))
    return options
  }
  var options: [HardwareBuyerOption] = []
  for person in found["people"]?.arrayValue ?? [] {
    let uid = person["uid"]?.stringValue ?? ""
    let name = person["name"]?.stringValue ?? ""
    let who = "\(name.isEmpty ? "No name" : name) (\(person["email"]?.stringValue ?? ""))"
    let workspaces = person["workspaces"]?.arrayValue ?? []
    if workspaces.isEmpty {
      options.append(
        HardwareBuyerOption(
          id: "\(uid)::", label: "\(who) · no workspace yet", detail: "It joins the workspace they create.",
          choice: ["uid": .string(uid)], needsAddress: false, storeChosen: false))
    }
    for workspace in workspaces { options += workspaceOptions(uid: uid, workspace: workspace, who: who) }
  }
  for workspace in found["workspaces"]?.arrayValue ?? [] {
    guard let owner = workspace["owner"], case .object = owner, let uid = owner["uid"]?.stringValue else { continue }
    let name = owner["name"]?.stringValue ?? ""
    let who = "\(name.isEmpty ? "Owner" : name) (\(owner["email"]?.stringValue ?? ""))"
    for option in workspaceOptions(uid: uid, workspace: workspace, who: who) where !options.contains(where: { $0.id == option.id }) {
      options.append(option)
    }
  }
  return options
}

private func hardwareRefusal(_ error: Error, _ fallback: String) -> String {
  (error as? ConsoleAPIError)?.body?["error"]?.stringValue ?? fallback
}

private func hardwareReason(_ error: Error) -> String? { (error as? ConsoleAPIError)?.body?["reason"]?.stringValue }

/// The route, for one store.
struct PosHardwareSaleAPI {
  let api: ConsoleAPIClient
  let hostID: String

  func call(_ action: String, _ fields: [String: JSONValue] = [:], attemptKey: String? = nil) async throws -> JSONValue? {
    var body: [String: JSONValue] = ["action": .string(action), "hostId": .string(hostID)]
    body.merge(fields) { _, given in given }
    return try await api.request(posHardwareSaleRoute, method: .post, body: .object(body), idempotencyKey: attemptKey)
  }
}

private func newHardwareKey() -> String { "attach-\(UUID().uuidString.lowercased())" }

/// Whether this store is the platform's own hardware seller, once per register.
@MainActor
@Observable
final class PosHardwareSeller {
  private(set) var seller = false
  @ObservationIgnored private var asked = false

  func check(_ api: PosHardwareSaleAPI) async {
    guard !asked else { return }
    asked = true
    seller = (try? await api.call("status"))??["seller"]?.boolValue == true
  }
}

/// The open sale's card reader part, in the checkout: attach the buyer, the terms of sale, the readers.
struct PosHardwareSaleSection: View {
  let context: NativePluginContext
  let saleOrderID: String
  let productIDs: [String]
  @State private var seller = PosHardwareSeller()
  @State private var sells = false
  @State private var attaching = false
  @State private var attached: (message: String, storeChosen: Bool, needsAddress: Bool)?
  @State private var notice: (String, AglynTone)?

  private var api: PosHardwareSaleAPI { PosHardwareSaleAPI(api: context.api, hostID: context.hostID ?? "") }

  var body: some View {
    // A stack, not a Group: an empty Group has no view for `.task` to run on, and this one is empty until it loads.
    VStack(spacing: 0) {
      if seller.seller && sells {
        VStack(alignment: .leading, spacing: AglynSpace.two) {
          Text("Card reader").font(AglynFont.headline)
          if let notice { AglynNotice(notice.0, tone: notice.1) { self.notice = nil } }
          HStack(alignment: .top) {
            Text(attached?.message ?? "This sale has a card reader. Attach it to the buyer’s workspace.")
              .font(AglynFont.subheadline).foregroundStyle(attached == nil ? AnyShapeStyle(.secondary) : AnyShapeStyle(AglynColor.success))
            Spacer()
            Button(attached == nil ? "Attach buyer" : "Change") { attaching = true }.buttonStyle(.bordered)
              .accessibilityIdentifier("pos-hardware-attach-buyer")
          }
          // The terms of sale, accepted before paying (Terms 4.28).
          PosHardwareTermsRow(context: context, api: api, saleOrderID: saleOrderID) { notice = $0 }
          PosHardwareReadersRow(
            api: api, saleOrderID: saleOrderID, storeChosen: attached?.storeChosen == true,
            needsAddress: attached?.needsAddress == true
          ) { notice = $0 }
        }
        .padding(AglynSpace.two)
        .background(AglynColor.paper, in: RoundedRectangle(cornerRadius: AglynRadius.card, style: .continuous))
        .accessibilityIdentifier("pos-hardware-sale")
      }
    }
    .task(id: saleOrderID) { await load() }
    .sheet(isPresented: $attaching) {
      PosHardwareAttachSheet(api: api, target: ["registerOrderId": .string(saleOrderID)], summary: nil) { message, storeChosen, needsAddress in
        // The row says it; no banner repeats it.
        attached = (message, storeChosen, needsAddress)
        notice = nil
      }
    }
  }

  /// A store that sells hardware, and a sale with a product that names a hardware SKU.
  private func load() async {
    await seller.check(api)
    guard seller.seller, let hostID = context.hostID else { return }
    for productID in Set(productIDs) {
      let doc = try? await context.firestore.readOnce(["hosts", hostID, "products", productID])
      if let sku = doc?.data["hardwareSku"] as? String, !sku.isEmpty {
        sells = true
        return
      }
    }
  }
}

/// The terms of sale before the buyer pays: on the customer display, on this tablet, or by the booth sign.
private struct PosHardwareTermsRow: View {
  let context: NativePluginContext
  let api: PosHardwareSaleAPI
  let saleOrderID: String
  let notify: ((String, AglynTone)) -> Void
  @State private var acceptance: (method: String, atMs: Double)?
  @State private var waiting = false
  @State private var tablet: (sections: String, url: String, summary: [String])?
  @State private var busy = false
  @Environment(\.openURL) private var openURL

  private var display: CustomerDisplayHost? { CustomerDisplayHosts.shared.current }

  private static let methodLabels = ["tablet": "on this tablet", "display": "on the customer display", "notice": "by the receipt and booth sign"]

  var body: some View {
    VStack(alignment: .leading, spacing: AglynSpace.one) {
      if let acceptance, acceptance.method != "notice" {
        Text(
          "Terms of sale accepted \(Self.methodLabels[acceptance.method] ?? "") at \(Date(timeIntervalSince1970: acceptance.atMs / 1000).formatted(date: .omitted, time: .shortened))."
        )
        .font(AglynFont.subheadline).foregroundStyle(AglynColor.success)
        .accessibilityIdentifier("pos-hardware-terms-accepted")
      } else {
        Text(
          waiting
            ? "Waiting for the buyer to accept the terms of sale on the display…"
            : "Before the buyer pays, have them accept the terms of sale. If no screen can be used, the receipt and the booth sign state the terms, and paying is agreeing."
        )
        .font(AglynFont.subheadline).foregroundStyle(.secondary)
        HStack(spacing: AglynSpace.two) {
          if display != nil {
            if waiting {
              Button("Take off display") { Task { await takeOff() } }.buttonStyle(.borderless)
            } else {
              Button("Show on display") { Task { await showOnDisplay() } }.buttonStyle(.borderless).disabled(busy)
                .accessibilityIdentifier("pos-hardware-terms-display")
            }
          }
          Button("Accept on this tablet") { Task { await openTablet() } }.buttonStyle(.borderless).disabled(busy)
            .accessibilityIdentifier("pos-hardware-terms-tablet")
        }
      }
      Button("Print the booth sign") {
        if let url = URL(string: context.api.origin + posHardwareTermsSignPath) { openURL(url) }
      }
      .buttonStyle(.borderless).font(AglynFont.caption)
    }
    .task(id: saleOrderID) { await refresh() }
    .task(id: waiting) {
      // Waiting on the display: asked until the buyer accepts there.
      while waiting && !Task.isCancelled {
        try? await Task.sleep(for: posHardwareTermsPoll)
        if let held = await refresh(), held != "notice" {
          waiting = false
          notify(("The buyer accepted the terms of sale on the display.", .success))
        }
      }
    }
    .sheet(isPresented: Binding(get: { tablet != nil }, set: { if !$0 { tablet = nil } })) {
      if let tablet {
        PosHardwareTermsSheet(sections: tablet.sections, url: tablet.url, summary: tablet.summary) {
          try await acceptOnTablet()
        }
      }
    }
  }

  @discardableResult
  private func refresh() async -> String? {
    guard let answer = try? await api.call("terms-status", ["registerOrderId": .string(saleOrderID)]) else { return nil }
    let held = answer["acceptance"]
    if let method = held?["method"]?.stringValue {
      acceptance = (method, held?["atMs"]?.numberValue ?? 0)
      return method
    }
    return nil
  }

  private func showOnDisplay() async {
    guard let display else { return }
    busy = true
    defer { busy = false }
    do {
      _ = try await api.call("terms-on-display", ["registerOrderId": .string(saleOrderID)])
      guard await display.show(CustomerDisplayScreen(pluginID: "commerce", path: posHardwareTermsScreenPath, params: ["order": saleOrderID]))
      else { throw ConsoleAPIError(status: 0, message: "not shown") }
      waiting = true
    } catch {
      notify((hardwareRefusal(error, "The terms could not be shown on the display. Hand them this tablet instead."), .warning))
    }
  }

  private func takeOff() async {
    waiting = false
    await display?.close("commerce")
  }

  private func openTablet() async {
    busy = true
    defer { busy = false }
    do {
      let view = try await api.call("terms")
      tablet = (
        view?["sections"]?.stringValue ?? "", view?["url"]?.stringValue ?? "",
        (view?["summary"]?.arrayValue ?? []).compactMap(\.stringValue)
      )
    } catch {
      notify((hardwareRefusal(error, "The terms could not be shown."), .warning))
    }
  }

  private func acceptOnTablet() async throws {
    do {
      let answer = try await api.call("accept-terms", ["registerOrderId": .string(saleOrderID)])
      if let held = answer?["acceptance"], let method = held["method"]?.stringValue {
        acceptance = (method, held["atMs"]?.numberValue ?? 0)
      }
      notify(("The buyer accepted the terms of sale.", .success))
    } catch {
      throw ConsoleAPIError(status: 0, message: hardwareRefusal(error, "The acceptance did not go through. Try again."))
    }
  }
}

/// The terms handed to the buyer on this tablet: the summary, the full Terms, and a box to tick.
private struct PosHardwareTermsSheet: View {
  let sections: String
  let url: String
  let summary: [String]
  let accept: () async throws -> Void
  @State private var agreed = false

  var body: some View {
    AglynFormSheet("Terms of sale for your card reader hardware", confirm: "Accept", working: "Accepting…", canConfirm: agreed) {
      try await accept()
    } content: {
      Section {
        Text("Hand this tablet to the buyer. This purchase is made under our Terms, Sections \(sections). In short:")
        ForEach(summary, id: \.self) { line in Label(line, systemImage: "circle.fill").labelStyle(BulletLabelStyle()) }
        if let link = URL(string: url) {
          Link(url.replacingOccurrences(of: #"^https?://"#, with: "", options: .regularExpression), destination: link)
        }
        Toggle(
          "I have read the terms of sale (Sections \(sections)) and accept them for this purchase.", isOn: $agreed
        )
        .accessibilityIdentifier("pos-hardware-terms-agree")
      }
    }
  }
}

private struct BulletLabelStyle: LabelStyle {
  func makeBody(configuration: Configuration) -> some View {
    HStack(alignment: .firstTextBaseline, spacing: AglynSpace.one) {
      Text("•")
      configuration.title
    }
  }
}

/// The sale's readers onto the buyer's store: serial numbers, and with the store chosen, registering a reader by its code.
private struct PosHardwareReadersRow: View {
  let api: PosHardwareSaleAPI
  let saleOrderID: String
  let storeChosen: Bool
  let needsAddress: Bool
  let notify: ((String, AglynTone)) -> Void
  @State private var serials = ""
  @State private var code = ""
  @State private var busy = false
  @State private var attemptKey = newHardwareKey()
  @State private var askAddress = false
  @State private var line1 = ""
  @State private var city = ""
  @State private var state = ""
  @State private var postalCode = ""
  @State private var country = "US"

  private var list: [String] {
    serials.split(whereSeparator: { $0.isWhitespace || $0 == "," || $0 == ";" }).map(String.init).filter { !$0.isEmpty }
  }
  private var addressComplete: Bool {
    !line1.trimmingCharacters(in: .whitespaces).isEmpty && !city.trimmingCharacters(in: .whitespaces).isEmpty
      && !postalCode.trimmingCharacters(in: .whitespaces).isEmpty && country.wholeMatch(of: #/[A-Z]{2}/#) != nil
  }

  var body: some View {
    VStack(alignment: .leading, spacing: AglynSpace.one) {
      HStack(alignment: .top) {
        VStack(alignment: .leading, spacing: AglynSpace.half) {
          TextField("Reader serial numbers", text: $serials).textFieldStyle(.roundedBorder)
            .accessibilityIdentifier("pos-hardware-serials")
          Text("Scan or type each reader's serial. It sets itself up when the buyer adds it.")
            .font(AglynFont.caption).foregroundStyle(.secondary)
        }
        Button("Save") { Task { await saveSerials() } }.buttonStyle(.bordered).disabled(busy || list.isEmpty)
          .accessibilityIdentifier("pos-hardware-serials-save")
      }
      if storeChosen && askAddress {
        Text(
          "Their store has no address for card readers yet. Enter it with the buyer to register the reader now: the reader is set up for this country. Or leave it, and they add it on their POS devices card."
        )
        .font(AglynFont.caption).foregroundStyle(.secondary)
        TextField("Street", text: $line1).textFieldStyle(.roundedBorder)
        HStack {
          TextField("City", text: $city).textFieldStyle(.roundedBorder)
          TextField("State", text: $state).textFieldStyle(.roundedBorder)
        }
        HStack {
          TextField("Postal code", text: $postalCode).textFieldStyle(.roundedBorder)
          TextField("Country", text: Binding(get: { country }, set: { country = String($0.uppercased().prefix(2)) }))
            .textFieldStyle(.roundedBorder)
        }
      }
      if storeChosen {
        HStack(alignment: .top) {
          VStack(alignment: .leading, spacing: AglynSpace.half) {
            TextField("Code on the reader", text: $code).textFieldStyle(.roundedBorder)
            Text("Register it to the buyer's store now, while they are here.").font(AglynFont.caption).foregroundStyle(.secondary)
          }
          Button("Register") { Task { await register() } }.buttonStyle(.bordered)
            .disabled(busy || code.trimmingCharacters(in: .whitespaces).count < 3 || (askAddress && !addressComplete))
        }
      }
    }
    .onAppear { askAddress = needsAddress }
    .onChange(of: needsAddress) { _, value in askAddress = value }
  }

  private func saveSerials() async {
    busy = true
    defer { busy = false }
    do {
      _ = try await api.call(
        "serials", ["registerOrderId": .string(saleOrderID), "serials": .array(list.map(JSONValue.string))])
      notify((list.count == 1 ? "Serial number saved" : "Serial numbers saved", .success))
    } catch {
      notify((hardwareRefusal(error, "That did not work. Try again."), .warning))
    }
  }

  private func register() async {
    busy = true
    defer { busy = false }
    var fields: [String: JSONValue] = [
      "registerOrderId": .string(saleOrderID), "registrationCode": .string(code.trimmingCharacters(in: .whitespaces)),
    ]
    if askAddress {
      fields["address"] = [
        "line1": .string(line1), "city": .string(city), "state": .string(state), "postalCode": .string(postalCode),
        "country": .string(country),
      ]
    }
    do {
      let answer = try await api.call("register-at-booth", fields, attemptKey: attemptKey)
      code = ""
      attemptKey = newHardwareKey()
      let saved = answer?["storeAddressSaved"]?.boolValue == true
      if saved { askAddress = false }
      notify((saved ? "Reader registered to their store, and the store’s address saved" : "Reader registered to their store", .success))
    } catch {
      if hardwareReason(error) == "needs-address" {
        askAddress = true
        // A new attempt: the request with the address is a different one.
        attemptKey = newHardwareKey()
      }
      notify((hardwareRefusal(error, "That did not work. Try again."), .warning))
    }
  }
}

/// Finding the buyer and saying whose the card reader is: by an exact email, a person's name or a workspace's name.
struct PosHardwareAttachSheet: View {
  let api: PosHardwareSaleAPI
  /// `registerOrderId` for the open sale, or `orderId` for a sale on the To attach list.
  let target: [String: JSONValue]
  let summary: String?
  let onAttached: (_ message: String, _ storeChosen: Bool, _ needsAddress: Bool) -> Void
  @State private var query = ""
  @State private var searched = ""
  @State private var found: JSONValue?
  @State private var chosen: String?
  @State private var busy = false
  @State private var error: String?
  @State private var attemptKey = newHardwareKey()
  @Environment(\.dismiss) private var dismiss

  private var options: [HardwareBuyerOption] { found.map(hardwareBuyerOptions) ?? [] }

  var body: some View {
    NavigationStack {
      Form {
        if let summary { Section { Text(summary).foregroundStyle(.secondary) } }
        Section {
          HStack {
            TextField("Email, name or workspace", text: $query)
              .autocorrectionDisabled()
              #if os(iOS)
                .textInputAutocapitalization(.never)
              #endif
              .onSubmit { Task { await search() } }
              .accessibilityIdentifier("pos-hardware-buyer-query")
            Button("Search") { Task { await search() } }
              .disabled(busy || query.trimmingCharacters(in: .whitespaces).count < 2)
          }
        } footer: {
          Text("Every lookup is recorded. Ask the buyer before you search for them.")
        }
        if found?["noAccount"]?.boolValue == true {
          Section {
            Text(
              "No account uses \(searched). Sell anyway: we email them an invitation, and the card reader joins their workspace when they sign up."
            )
            Button("Invite them") { Task { await attach(["email": .string(searched)], storeChosen: false, needsAddress: false) } }
              .disabled(busy)
          }
        } else if found != nil && options.isEmpty {
          Section { Text("Nobody matches. Try their exact email address.").foregroundStyle(.secondary) }
        }
        if !options.isEmpty {
          Section("Buyer") {
            ForEach(options) { option in
              Button {
                chosen = option.id
              } label: {
                HStack {
                  VStack(alignment: .leading, spacing: AglynSpace.half) {
                    Text(option.label).foregroundStyle(.primary).frame(maxWidth: .infinity, alignment: .leading)
                    if let detail = option.detail { Text(detail).font(AglynFont.caption).foregroundStyle(.secondary) }
                  }
                  Spacer()
                  if chosen == option.id { Image(systemName: "checkmark").foregroundStyle(AglynColor.primary) }
                }
                .contentShape(Rectangle())
              }
              // A choice reads as a row, not as tinted button text.
              .buttonStyle(.plain)
              .accessibilityIdentifier("pos-hardware-buyer-\(option.id)")
            }
          }
        }
        if let error { Section { AglynNotice(error, tone: .warning) } }
      }
      .formStyle(.grouped)
      .navigationTitle("Who is the card reader for?")
      #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
      #endif
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
        ToolbarItem(placement: .confirmationAction) {
          Button("Attach") {
            if let option = options.first(where: { $0.id == chosen }) {
              Task { await attach(option.choice, storeChosen: option.storeChosen, needsAddress: option.needsAddress) }
            }
          }
          .disabled(busy || chosen == nil)
          .accessibilityIdentifier("pos-hardware-attach")
        }
      }
    }
    .aglynSheetMinimumSize(width: 520, height: 520)
  }

  private func search() async {
    let text = query.trimmingCharacters(in: .whitespaces)
    guard text.count >= 2 else { return }
    busy = true
    error = nil
    defer { busy = false }
    do {
      found = try await api.call("find", ["query": .string(text)])
      searched = text
      chosen = nil
    } catch {
      self.error = hardwareRefusal(error, "The lookup did not answer")
    }
  }

  private func attach(_ choice: JSONValue, storeChosen: Bool, needsAddress: Bool) async {
    busy = true
    error = nil
    defer { busy = false }
    var fields = target
    fields["buyer"] = choice
    do {
      let answer = try await api.call("attach", fields, attemptKey: attemptKey)
      let outcome = answer?["outcome"]?.stringValue
      let message =
        outcome == "waiting"
        ? "Buyer attached. The card reader joins their workspace as soon as the sale is paid."
        : outcome == "attached"
          ? "Card reader attached to the buyer’s workspace."
          : choice["email"] != nil
            ? "Invitation sent. The card reader joins their workspace when they sign up."
            : "Attached to their account. It joins the workspace they create."
      onAttached(message, storeChosen, needsAddress)
      dismiss()
    } catch {
      self.error = hardwareRefusal(error, "The card reader could not be attached")
    }
  }
}

/// The To attach list: card readers sold here that nobody has said whose they are yet, newest first.
struct PosHardwareToAttachSheet: View {
  let api: PosHardwareSaleAPI
  @State private var rows: [HardwareToAttachRow]?
  @State private var error: String?
  @State private var picked: HardwareToAttachRow?
  @State private var notice: String?
  @Environment(\.dismiss) private var dismiss

  var body: some View {
    NavigationStack {
      Form {
        if let notice { Section { AglynNotice(notice, tone: .success) { self.notice = nil } } }
        if let error { Section { AglynNotice(error, tone: .warning) } }
        if let rows, rows.isEmpty {
          Section { Text("Every card reader sold here is attached to its buyer.").foregroundStyle(.secondary) }
        }
        if let rows, !rows.isEmpty {
          Section {
            ForEach(rows) { row in
              HStack {
                VStack(alignment: .leading, spacing: AglynSpace.half) {
                  Text(row.linesLabel)
                  Text(row.detail).font(AglynFont.caption).foregroundStyle(.secondary)
                }
                Spacer()
                Button("Attach") { picked = row }.buttonStyle(.borderless)
              }
            }
          }
        }
        if rows == nil { Section { ProgressView() } }
      }
      .formStyle(.grouped)
      .navigationTitle("Card reader sales to attach")
      #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
      #endif
      .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Close") { dismiss() } } }
      .sheet(item: $picked) { row in
        PosHardwareAttachSheet(api: api, target: ["orderId": .string(row.id)], summary: row.linesLabel) { message, _, _ in
          notice = message
          Task { await load() }
        }
      }
    }
    .task { await load() }
    .aglynSheetMinimumSize(width: 520, height: 480)
    .accessibilityIdentifier("pos-hardware-to-attach")
  }

  private func load() async {
    do {
      let answer = try await api.call("pending")
      let orders: [JSONValue] = answer?["orders"]?.arrayValue ?? []
      rows = orders.compactMap(HardwareToAttachRow.init)
    } catch {
      rows = []
      self.error = hardwareRefusal(error, "The list could not be read")
    }
  }
}
