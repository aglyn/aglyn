// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynUI
import Foundation
import Observation
import SwiftUI

// A register's receipt printers (AGL-3909): the console's register hardware card, natively. Star CloudPRNT and
// Epson Server Direct Print printers poll the console for their jobs, so adding one is a form and a URL to paste
// into the printer; no driver, no pairing. Every change goes through `/api/commerce/printers`, as the console's does.

let printersRoute = "/api/commerce/printers"

/// One printer of the register (`hosts/{site}/printers/{id}`, server-written).
struct PosPrinterRow: Identifiable, Equatable {
  let id: String
  let name: String
  let brand: String
  let model: String?
  let deviceID: String
  let paperWidthMm: Int
  let autoPrintReceipts: Bool
  let kickDrawer: Bool
  let kitchenTickets: Bool
  let logoKey: String?
  let statusState: String?
  let statusDetail: String?
  let statusAtMs: Double?

  init(_ doc: FirestoreDocument) {
    id = doc.id
    name = doc.string("name") ?? "Printer"
    brand = doc.string("brand") ?? "star"
    model = doc.string("model").flatMap { $0.isEmpty ? nil : $0 }
    deviceID = doc.string("deviceId") ?? ""
    paperWidthMm = doc.int("paperWidthMm") == 58 ? 58 : 80
    autoPrintReceipts = doc.bool("autoPrintReceipts") ?? true
    kickDrawer = doc.bool("kickDrawer") ?? false
    kitchenTickets = doc.bool("kitchenTickets") ?? false
    logoKey = doc.string("logoKey").flatMap { $0.isEmpty ? nil : $0 }
    let status = doc.data["status"] as? [String: Any]
    statusState = status?["state"] as? String
    statusDetail = status?["detail"] as? String
    statusAtMs = (status?["atMs"] as? NSNumber)?.doubleValue
  }
}

/// What a printer shows now, as the console's `printerDisplayState` reads it: never polled is waiting, a printer
/// quiet for longer than the offline window is offline, else what it last said.
func printerDisplayState(state: String?, atMs: Double?, nowMs: Double) -> String {
  guard let atMs, atMs > 0 else { return "unknown" }
  if nowMs - atMs > ContractValues.shared.printerOfflineAfterMs { return "offline" }
  return state ?? "unknown"
}

/// A printer state's words and tone.
func printerStateChip(_ state: String) -> (String, AglynTone) {
  switch state {
  case "offline": ("Offline", .warning)
  case "online": (ContractValues.shared.printerStateLabels[state] ?? "Online", .success)
  case "paper_low": (ContractValues.shared.printerStateLabels[state] ?? "Paper low", .warning)
  case "unknown": (ContractValues.shared.printerStateLabels[state] ?? "Waiting for the printer", .neutral)
  default: (ContractValues.shared.printerStateLabels[state] ?? state, .error)
  }
}

/// How long ago a printer last polled, in the console's words (`seenAgo`).
func printerSeenAgo(_ atMs: Double?, nowMs: Double) -> String {
  guard let atMs, atMs > 0 else { return "never" }
  let seconds = max(0, ((nowMs - atMs) / 1000).rounded())
  if seconds < 45 { return "just now" }
  let minutes = (seconds / 60).rounded()
  if minutes < 60 { return "\(Int(minutes)) min ago" }
  let hours = (minutes / 60).rounded()
  if hours < 48 { return "\(Int(hours)) h ago" }
  return "\(Int((hours / 24).rounded())) days ago"
}

/// Where each brand's URL goes, step by step (the console's `printerSetupSteps`).
func printerSetupSteps(_ brand: String) -> [String] {
  brand == "star"
    ? [
      "Open the printer’s web page: print a self-test (hold FEED while switching on) to find its IP address, then browse to it and sign in (default user root, password public, or the password on the printer’s label).",
      "Go to Settings → CloudPRNT. Turn CloudPRNT on and paste the URL below as the Server URL.",
      "Set the polling interval to 5 seconds, then Submit and Save → Restart device.",
      "Come back here: the printer shows Online within a minute. Send a test print.",
    ]
    : [
      "Open EPSON TMNet WebConfig: browse to the printer’s IP address (print a status sheet by holding FEED while switching on).",
      "Open Server Direct Print (under Web Service Settings on most models). Select Enable and enter the ID below.",
      "Paste the URL below as Server 1 URL and set the interval to 5 seconds. Submit, then reset the printer.",
      "Come back here: the printer shows Online within a minute. Send a test print.",
    ]
}

/// The printer form (add and settings), as the console's `PrinterForm` holds it.
struct PrinterDraft: Equatable {
  var brand = "star"
  var name = ""
  var model = ""
  var deviceID = ""
  var paperWidthMm = 80
  var autoPrintReceipts = true
  var kickDrawer = true
  var kitchenTickets = false
  var logoKey = ""

  init() {}

  init(_ row: PosPrinterRow) {
    brand = row.brand
    name = row.name
    model = row.model ?? ""
    deviceID = row.deviceID
    paperWidthMm = row.paperWidthMm
    autoPrintReceipts = row.autoPrintReceipts
    kickDrawer = row.kickDrawer
    kitchenTickets = row.kitchenTickets
    logoKey = row.logoKey ?? ""
  }

  /// The route body's settings; `brand` only when adding (a printer's brand never changes).
  func fields(includingBrand: Bool) -> [String: JSONValue] {
    var fields: [String: JSONValue] = [
      "name": .string(name.trimmingCharacters(in: .whitespacesAndNewlines)),
      "model": .string(model.trimmingCharacters(in: .whitespacesAndNewlines)),
      "deviceId": .string(deviceID.trimmingCharacters(in: .whitespacesAndNewlines)),
      "paperWidthMm": .number(Double(paperWidthMm)),
      "autoPrintReceipts": .bool(autoPrintReceipts),
      "kickDrawer": .bool(kickDrawer),
      "kitchenTickets": .bool(kitchenTickets),
      "logoKey": .string(logoKey.trimmingCharacters(in: .whitespacesAndNewlines)),
    ]
    if includingBrand { fields["brand"] = .string(brand) }
    return fields
  }

  var complete: Bool {
    !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
      && !deviceID.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
  }
}

/// The URL (and Epson ID) a printer polls with, as the route answers it.
struct PrinterCredentials: Equatable, Identifiable {
  let printerID: String
  let brand: String
  let pollURL: String
  let deviceID: String?
  var id: String { printerID + pollURL }

  init?(_ answer: JSONValue?) {
    guard let url = answer?["pollUrl"]?.stringValue, !url.isEmpty else { return nil }
    printerID = answer?["printerId"]?.stringValue ?? ""
    brand = answer?["brand"]?.stringValue ?? "star"
    pollURL = url
    deviceID = answer?["deviceId"]?.stringValue
  }
}

/// The register's printers, live, and the route's actions on them.
@MainActor
@Observable
final class PosPrintersModel {
  private(set) var rows: [PosPrinterRow] = []
  private(set) var ready = false
  private(set) var busy = false
  var notice: String?
  var error: String?

  @ObservationIgnored private let reader: FirestoreReader
  @ObservationIgnored private let api: ConsoleAPIClient
  @ObservationIgnored let hostID: String
  @ObservationIgnored private(set) var registerID: String?
  @ObservationIgnored private var listener: FirestoreListening?

  init(reader: FirestoreReader, api: ConsoleAPIClient, hostID: String) {
    self.reader = reader
    self.api = api
    self.hostID = hostID
  }

  func watch(registerID next: String?) {
    guard next != registerID || listener == nil else { return }
    registerID = next
    listener?.remove()
    listener = nil
    rows = []
    ready = false
    guard let next else { return }
    listener = reader.listen(FirestoreQuery(["hosts", hostID, "printers"], equals: [("registerId", next)], limit: 10)) {
      [weak self] result in
      guard let self else { return }
      if case .success(let docs) = result {
        self.rows = docs.map(PosPrinterRow.init).sorted { $0.name.localizedCompare($1.name) == .orderedAscending }
      }
      self.ready = true
    }
  }

  func stop() {
    listener?.remove()
    listener = nil
  }

  private func call(_ body: [String: JSONValue]) async -> JSONValue?? {
    busy = true
    error = nil
    defer { busy = false }
    var payload = body
    payload["hostId"] = .string(hostID)
    do {
      return .some(try await api.request(printersRoute, method: .post, body: .object(payload)))
    } catch let failure as ConsoleAPIError {
      error = failure.message
    } catch {
      self.error = "The printer could not be reached. Check your connection."
    }
    return nil
  }

  /// Adds a printer to this register; answers the URL to paste into it.
  func add(_ draft: PrinterDraft) async -> PrinterCredentials? {
    guard let registerID else { return nil }
    var body = draft.fields(includingBrand: true)
    body["action"] = .string("create")
    body["registerId"] = .string(registerID)
    guard let answer = await call(body) else { return nil }
    return PrinterCredentials(answer)
  }

  func save(_ row: PosPrinterRow, _ draft: PrinterDraft) async -> Bool {
    var body = draft.fields(includingBrand: false)
    body["action"] = .string("update")
    body["printerId"] = .string(row.id)
    return await call(body) != nil
  }

  func credentials(_ row: PosPrinterRow) async -> PrinterCredentials? {
    guard let answer = await call(["action": .string("credentials"), "printerId": .string(row.id)]) else { return nil }
    return PrinterCredentials(answer)
  }

  func regenerate(_ row: PosPrinterRow) async -> PrinterCredentials? {
    guard let answer = await call(["action": .string("regenerate"), "printerId": .string(row.id)]) else { return nil }
    return PrinterCredentials(answer)
  }

  func send(_ action: String, _ row: PosPrinterRow) async {
    if await call(["action": .string(action), "printerId": .string(row.id)]) != nil {
      notice = action == "test" ? "Test print sent" : "Drawer kick sent"
    }
  }

  func remove(_ row: PosPrinterRow) async {
    if await call(["action": .string("remove"), "printerId": .string(row.id)]) != nil {
      // The row leaves now: a listener that re-reads on a timer (the unsigned Mac build) would show it until then.
      rows.removeAll { $0.id == row.id }
      notice = "\(row.name) removed"
    }
  }
}

// MARK: Views

/// The register's receipt printers: each one's state, a test print, its settings and URL, and Add printer.
struct RegisterPrintersView: View {
  let model: PosPrintersModel
  @State private var adding = false
  @State private var editing: PosPrinterRow?
  @State private var removing: PosPrinterRow?
  @State private var now = Date()

  var body: some View {
    Form {
      if let notice = model.notice { AglynNotice(notice, tone: .success) { model.notice = nil } }
      if let error = model.error, !adding, editing == nil { AglynNotice(error, tone: .error) { model.error = nil } }
      Section {
        if !model.ready {
          SkeletonRows(count: 2)
        } else if model.rows.isEmpty {
          Text(
            "Pair a Star CloudPRNT or Epson Server Direct Print printer to print receipts from this register on any device, with no driver, and to open its cash drawer on cash sales."
          )
          .font(AglynFont.subheadline)
          .foregroundStyle(.secondary)
        }
        ForEach(model.rows) { row in printerRow(row) }
      } header: {
        Text("Receipt printers")
      }
    }
    .formStyle(.grouped)
    .aglynFormBackground()
    .navigationTitle("Receipt printers")
    #if os(iOS)
      .navigationBarTitleDisplayMode(.inline)
    #endif
    .toolbar {
      ToolbarItem(placement: .primaryAction) {
        Button {
          model.error = nil
          adding = true
        } label: {
          Label("Add printer", systemImage: "plus")
        }
        .disabled(model.registerID == nil || model.busy)
        .help("Add a receipt printer to this register")
        .accessibilityIdentifier("printer-add")
      }
    }
    // A form's refusal belongs to the form: closing it (Cancel after "already added") never leaves it on the list.
    .sheet(isPresented: $adding, onDismiss: { model.error = nil }) { PrinterFormSheet(model: model, editing: nil) }
    .sheet(item: $editing, onDismiss: { model.error = nil }) { row in PrinterFormSheet(model: model, editing: row) }
    .alert(
      "Remove \(removing?.name ?? "this printer")?", isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } })
    ) {
      Button("Cancel", role: .cancel) { removing = nil }
      Button("Remove", role: .destructive) {
        guard let row = removing else { return }
        removing = nil
        Task { await model.remove(row) }
      }
    } message: {
      Text("Its URL stops working and anything it has not printed is canceled.")
    }
    .task {
      // A printer's state ages into Offline while the screen is open.
      while !Task.isCancelled {
        try? await Task.sleep(nanoseconds: 30_000_000_000)
        now = Date()
      }
    }
  }

  private func printerRow(_ row: PosPrinterRow) -> some View {
    let nowMs = now.timeIntervalSince1970 * 1000
    let (label, tone) = printerStateChip(printerDisplayState(state: row.statusState, atMs: row.statusAtMs, nowMs: nowMs))
    let brand = row.brand == "star" ? "Star" : "Epson"
    let seen =
      row.statusAtMs.map { _ in
        "Last seen \(printerSeenAgo(row.statusAtMs, nowMs: nowMs))" + (row.statusDetail.map { " · \($0)" } ?? "")
      } ?? "Waiting for the printer to poll — paste its URL into the printer to finish."
    let traits = [row.autoPrintReceipts ? "Prints every sale" : nil, row.kickDrawer ? "Cash drawer" : nil, row.kitchenTickets ? "Kitchen tickets" : nil]
      .compactMap { $0 }
    return VStack(alignment: .leading, spacing: AglynSpace.one) {
      AglynRow(row.name, subtitle: ([brand + (row.model.map { " \($0)" } ?? "")] + traits).joined(separator: " · "), systemImage: "printer") {
        StatusChip(label, tone: tone)
      }
      Text(seen).font(AglynFont.caption).foregroundStyle(.secondary)
      HStack(spacing: AglynSpace.one) {
        Button("Test print") { Task { await model.send("test", row) } }
          .accessibilityIdentifier("printer-test-\(row.id)")
        if row.kickDrawer {
          Button("Open drawer") { Task { await model.send("drawer", row) } }
            .accessibilityIdentifier("printer-drawer-\(row.id)")
        }
        Spacer(minLength: 0)
        Button("Settings") {
          model.error = nil
          editing = row
        }
        .accessibilityIdentifier("printer-settings-\(row.id)")
        Button("Remove", role: .destructive) { removing = row }
          .accessibilityIdentifier("printer-remove-\(row.id)")
      }
      .buttonStyle(.aglynSecondary)
      .controlSize(.small)
      .disabled(model.busy)
    }
    .padding(.vertical, AglynSpace.half)
    .accessibilityIdentifier("printer-\(row.id)")
  }
}

/// Add printer (then its URL and setup steps), or a printer's settings and URL.
struct PrinterFormSheet: View {
  let model: PosPrintersModel
  let editing: PosPrinterRow?
  @Environment(\.dismiss) private var dismiss
  @State private var draft = PrinterDraft()
  @State private var credentials: PrinterCredentials?
  @State private var seeded = false
  @State private var regenerating = false

  private var adding: Bool { editing == nil }
  private var brandLabels: [String: String] { ContractValues.shared.printerBrandLabels }

  var body: some View {
    NavigationStack {
      Form {
        if let error = model.error { AglynNotice(error, tone: .error) { model.error = nil } }
        if adding, let credentials {
          connectSections(credentials)
        } else {
          fields
          if let credentials { connectSections(credentials) }
        }
      }
      .formStyle(.grouped)
      .navigationTitle(adding ? (credentials == nil ? "Add printer" : "Connect the printer") : "Printer settings")
      #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
      #endif
      .toolbar {
        if adding && credentials != nil {
          ToolbarItem(placement: .confirmationAction) {
            Button("Done") { dismiss() }.accessibilityIdentifier("printer-connect-done")
          }
        } else {
          ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() }.disabled(model.busy) }
          ToolbarItem(placement: .confirmationAction) {
            Button(adding ? "Add printer" : "Save") { Task { await submit() } }
              .disabled(model.busy || !draft.complete)
              .accessibilityIdentifier("printer-form-confirm")
          }
        }
      }
      .alert("Regenerate the URL?", isPresented: $regenerating) {
        Button("Cancel", role: .cancel) {}
        Button("Regenerate", role: .destructive) {
          guard let editing else { return }
          Task { if let next = await model.regenerate(editing) { credentials = next } }
        }
      } message: {
        Text("The printer stops printing until the new URL is pasted into it.")
      }
    }
    #if os(macOS)
      .frame(minWidth: 480, idealWidth: 540, minHeight: 520)
    #endif
    .task {
      guard !seeded else { return }
      seeded = true
      if let editing {
        draft = PrinterDraft(editing)
        credentials = await model.credentials(editing)
      }
    }
  }

  @ViewBuilder
  private var fields: some View {
    Section {
      if adding {
        Picker("Brand", selection: $draft.brand) {
          ForEach(ContractValues.shared.printerBrands.filter { $0 != .unknown }, id: \.self) { brand in
            Text(brandLabels[brand.rawValue] ?? brand.rawValue).tag(brand.rawValue)
          }
        }
        .accessibilityIdentifier("printer-brand")
      }
      TextField("Name", text: $draft.name, prompt: Text("Counter printer"))
        .accessibilityIdentifier("printer-name")
      HStack {
        TextField("Model", text: $draft.model)
          .accessibilityIdentifier("printer-model")
        Menu {
          ForEach(ContractValues.shared.printerModelSuggestions[draft.brand] ?? [], id: \.self) { model in
            Button(model) { draft.model = model }
          }
        } label: {
          Label("Models", systemImage: "list.bullet").labelStyle(.iconOnly)
        }
        .fixedSize()
        .help("The models we document and test against")
      }
      VStack(alignment: .leading, spacing: AglynSpace.half) {
        TextField(draft.brand == "star" ? "MAC address" : "Server Direct Print ID", text: $draft.deviceID)
          .autocorrectionDisabled()
          #if os(iOS)
            .textInputAutocapitalization(.never)
          #endif
          .accessibilityIdentifier("printer-device")
        Text(
          draft.brand == "star"
            ? "The Ethernet MAC on the self-test print, even if the printer uses Wi-Fi."
            : "Any ID you choose (letters, digits, - _ .), entered again in WebConfig."
        )
        .font(AglynFont.caption)
        .foregroundStyle(.secondary)
      }
      Picker("Paper", selection: $draft.paperWidthMm) {
        Text("80 mm").tag(80)
        Text("58 mm").tag(58)
      }
      VStack(alignment: .leading, spacing: AglynSpace.half) {
        TextField("Stored logo (optional)", text: $draft.logoKey)
          .accessibilityIdentifier("printer-logo")
        Text(
          draft.brand == "star"
            ? "The logo number saved in the printer with Star Quick Setup Utility."
            : "The key saved in the printer with Epson TM Utility, as two numbers."
        )
        .font(AglynFont.caption)
        .foregroundStyle(.secondary)
      }
    }
    Section {
      Toggle("Print a receipt for every sale on this register", isOn: $draft.autoPrintReceipts)
      Toggle("A cash drawer is plugged into this printer", isOn: $draft.kickDrawer)
      Toggle("Print a kitchen ticket for every sale (items and quantities, no prices)", isOn: $draft.kitchenTickets)
    }
  }

  @ViewBuilder
  private func connectSections(_ credentials: PrinterCredentials) -> some View {
    Section("Connect the printer") {
      ForEach(Array(printerSetupSteps(credentials.brand).enumerated()), id: \.offset) { index, step in
        HStack(alignment: .firstTextBaseline, spacing: AglynSpace.one) {
          Text("\(index + 1).").monospacedDigit().foregroundStyle(.secondary)
          Text(step).font(AglynFont.subheadline)
        }
      }
    }
    Section {
      LabeledContent(credentials.brand == "star" ? "CloudPRNT Server URL" : "Server Direct Print URL") {
        Text(credentials.pollURL).font(AglynFont.caption.monospaced()).textSelection(.enabled).lineLimit(3)
      }
      if credentials.brand != "star", let id = credentials.deviceID {
        LabeledContent("ID") { Text(id).textSelection(.enabled) }
      }
      HStack {
        Button {
          AglynClipboard.copy(credentials.pollURL)
          model.notice = "Copied"
        } label: {
          Label("Copy URL", systemImage: "doc.on.doc")
        }
        .accessibilityIdentifier("printer-copy-url")
        if !adding {
          Spacer(minLength: 0)
          Button("Regenerate URL", role: .destructive) { regenerating = true }
        }
      }
      .buttonStyle(.aglynSecondary)
    } footer: {
      Text("This URL is the printer’s password: anyone with it can collect this register’s receipts. Regenerate it if it is ever shared.")
    }
  }

  private func submit() async {
    if let editing {
      if await model.save(editing, draft) { dismiss() }
    } else if let made = await model.add(draft) {
      credentials = made
    }
  }
}

/// The register's printers in a sheet of their own (the register menu's Receipt printers).
struct RegisterPrintersSheet: View {
  let model: RegisterModel
  @Environment(\.dismiss) private var dismiss

  var body: some View {
    NavigationStack {
      RegisterPrintersView(model: model.printers)
        .toolbar {
          ToolbarItem(placement: .cancellationAction) { Button("Done") { dismiss() } }
        }
    }
    #if os(macOS)
      .frame(minWidth: 520, idealWidth: 600, minHeight: 480)
    #endif
  }
}
