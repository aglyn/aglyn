// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynPluginHost
import AglynUI
import SwiftUI

/// One line under a field saying where the value Aglyn AI reads comes from: a suggestion is shown as a suggestion, and an
/// empty box that is not empty to the AI says what fills it.
func businessOriginLine(_ field: String, stored: [String: Any]?, resolved: ResolvedBusinessProfile?, fallback: String) -> String {
  let contracts = ContractValues.shared
  let source = businessProfileSourceOf(stored, field)
  if source == "start" || source == "ai" { return "\(contracts.businessProfileOriginLabels[source ?? ""] ?? ""). Edit it and it becomes yours." }
  if source == "owner" { return fallback }
  let used: (value: String, origin: String)?
  switch field {
  case "whatYouDo": used = resolved?.whatYouDo.map { ($0.value, $0.origin) }
  case "services": used = resolved?.services.map { ($0.value.joined(separator: ", "), $0.origin) }
  case "serviceArea": used = resolved?.serviceArea.map { ($0.value, $0.origin) }
  case "audience": used = resolved?.audience.map { ($0.value, $0.origin) }
  case "tone": used = resolved?.tone.map { (contracts.businessToneLabels[$0.value] ?? $0.value, $0.origin) }
  case "toneNotes": used = resolved?.toneNotes.map { ($0.value, $0.origin) }
  case "founded": used = resolved?.founded.map { ($0.value, $0.origin) }
  default: used = nil
  }
  if let used, used.origin == "site" || used.origin == "workspace" {
    let shown = used.value.count > 80 ? String(used.value.prefix(79)) + "…" : used.value
    return "Empty here, so Aglyn AI uses “\(shown)” from \(used.origin == "site" ? "your SEO settings" : "the workspace defaults")."
  }
  return fallback
}

/// The form's text for what is stored: the services one per line, a missing value empty.
func businessProfileForm(_ stored: [String: Any]?) -> [String: String] {
  [
    "whatYouDo": stored?["whatYouDo"] as? String ?? "",
    "services": (stored?["services"] as? [String] ?? []).joined(separator: "\n"),
    "serviceArea": stored?["serviceArea"] as? String ?? "",
    "audience": stored?["audience"] as? String ?? "",
    "tone": stored?["tone"] as? String ?? "",
    "toneNotes": stored?["toneNotes"] as? String ?? "",
    "founded": stored?["founded"] as? String ?? "",
  ]
}

/// What the owner's save carries: every field the form shows, as typed; the owner's write sanitizes it.
func businessProfileSaveValues(_ fields: [String: String]) -> [String: Any] {
  let tone = fields["tone"] ?? ""
  return [
    "whatYouDo": fields["whatYouDo"] ?? "", "services": (fields["services"] ?? "").components(separatedBy: "\n"),
    "serviceArea": fields["serviceArea"] ?? "", "audience": fields["audience"] ?? "", "toneNotes": fields["toneNotes"] ?? "",
    "founded": fields["founded"] ?? "",
    "tone": ContractValues.shared.businessToneOrder.contains(tone) ? tone : NSNull(),
  ]
}

/// Why the year founded the form holds cannot be saved, in the console's words (AGL-4102), or nil when it can.
func businessFoundedError(_ fields: [String: String]) -> String? { businessProfileFoundedProblem(fields["founded"] ?? "") }

/// A site's business profile (AGL-3661): the services, audience, area and tone that have no other home, and that every AI job for
/// the site reads. The save is the OWNER's write, so every field they changed becomes theirs and a field they left as it was keeps
/// the source it had. Beside it, the facts read from the site's own settings, each with a link to the card that edits it. The
/// Kotlin site lib's BusinessSection.kt.
struct BusinessSection: View {
  let context: NativePluginContext
  let hostID: String
  let host: [String: Any]
  let canEdit: Bool
  @State private var profile = ObservedDocument()
  @State private var workspace = ObservedDocument()
  @State private var fields: [String: String] = [:]
  @State private var seeded: [String: String] = [:]
  @State private var runner = PluginActionRunner(roleHint: "an author, editor or admin")
  private let contracts = ContractValues.shared

  private var path: [String] { ["hosts", hostID, contracts.businessProfileSubcollection, contracts.businessProfileSiteDoc] }
  private var stored: [String: Any]? { profile.document?.data }
  private var resolved: ResolvedBusinessProfile { resolveBusinessProfile(host: host, site: stored, workspace: workspace.document?.data) }

  private func binding(_ key: String) -> Binding<String> { Binding(get: { fields[key] ?? "" }, set: { fields[key] = $0 }) }

  private func line(_ field: String, _ fallback: String) -> String { businessOriginLine(field, stored: stored, resolved: resolved, fallback: fallback) }

  var body: some View {
    let maxChars = contracts.businessProfileMaxChars
    let foundedError = businessFoundedError(fields)
    AglynFormCard(
      "Business profile",
      message: "What this business does and how it speaks. Aglyn AI reads it on every job for this site, and never replaces what you write here.",
      dirty: fields != seeded, canSave: canEdit && profile.ready && !profile.failed && foundedError == nil, busy: runner.busy, error: runner.error, notice: runner.notice,
      onDiscard: {
        fields = seeded
        runner.clear()
      },
      onSave: save
    ) {
      AglynCountedField(
        "What the business does", text: binding("whatYouDo"), max: Int(maxChars["whatYouDo"] ?? 200), multiline: true,
        supporting: line("whatYouDo", "One sentence, as you would say it to a new customer"),
        placeholder: "Mobile dog grooming for busy owners in north Austin", enabled: canEdit)
      AglynCountedField(
        "Services", text: binding("services"), multiline: true, supporting: line("services", "One per line, up to \(contracts.businessProfileMaxServices)"),
        placeholder: "Full groom\nBath and brush\nNail trim", enabled: canEdit)
      AglynCountedField(
        "Who it is for", text: binding("audience"), max: Int(maxChars["audience"] ?? 160), multiline: true,
        supporting: line("audience", "The customers you want more of"), placeholder: "Dog owners who work long hours", enabled: canEdit)
      AglynCountedField(
        "Area served", text: binding("serviceArea"), max: Int(maxChars["serviceArea"] ?? 120),
        supporting: line("serviceArea", "Cities, regions or “online”"), placeholder: "North Austin, Round Rock and Cedar Park", enabled: canEdit)
      Picker("Tone of voice", selection: binding("tone")) {
        Text("Not set").tag("")
        ForEach(contracts.businessToneOrder, id: \.self) { Text(contracts.businessToneLabels[$0] ?? $0).tag($0) }
      }
      .disabled(!canEdit)
      Text(line("tone", "How the copy should sound")).font(AglynFont.caption).foregroundStyle(.secondary)
      AglynCountedField(
        "Notes on tone", text: binding("toneNotes"), max: Int(maxChars["toneNotes"] ?? 200),
        supporting: line("toneNotes", "Words to use or avoid, in your own words"),
        placeholder: "Say “pups”, never “pets”. No exclamation marks.", enabled: canEdit)
      // The year the business started (AGL-4102), as the console's card has it: checked by the console's own rule.
      AglynCountedField(
        "Year founded", text: binding("founded"), error: foundedError, supporting: line("founded", "Four digits, such as 2015"),
        placeholder: "2015", keyboard: .number, enabled: canEdit)
    }
    facts
      .task(id: hostID) {
        profile.start(context.firestore, path)
        if let orgID = context.orgID {
          workspace.start(context.firestore, ["orgs", orgID, contracts.businessProfileSubcollection, contracts.businessProfileWorkspaceDoc])
        }
      }
      .onChange(of: businessProfileForm(stored), initial: true) { _, next in
        // Re-read whenever what is stored changes, but never over edits in progress.
        if fields == seeded || fields.isEmpty { fields = next }
        seeded = next
      }
      .onDisappear {
        profile.stop()
        workspace.stop()
      }
    // The `hostBusinessProfile` zone: what a plugin adds to the profile (what Aglyn AI learned from the site's edits).
    SlotCards(context: context, slot: "hostBusinessProfile")
  }

  private func save() {
    let values = businessProfileSaveValues(fields)
    let current = stored
    let path = path
    let uid = context.uid
    runner.run(success: "Business profile saved") {
      var next = businessProfileOwnerWrite(current, values)
      next["updatedAt"] = FirestoreSentinel.serverTimestamp
      next["updatedBy"] = uid
      // The sources are replaced whole, so a field's source never outlives its value: a merge writes the new ones and deletes the
      // ones the document held that this save no longer names. A first save creates the document.
      var sources = next["sources"] as? [String: Any] ?? [:]
      for key in (current?["sources"] as? [String: Any] ?? [:]).keys where sources[key] == nil { sources[key] = FirestoreSentinel.delete }
      next["sources"] = sources
      try await context.writer.merge(path, next)
    }
  }

  private var facts: some View {
    let profile = resolved
    let rows: [(label: String, value: String?, section: SetupSection)] = [
      ("Business name", profile.name?.value, .seo), ("Business type", profile.businessType, .seo), ("Email", profile.contact.email, .details),
      ("Phone", profile.contact.phone, .seo), ("Address", profile.contact.address, .details), ("Opening hours", profile.contact.hours, .seo),
      ("Social profiles", profile.profiles.isEmpty ? nil : profile.profiles.joined(separator: "\n"), .details),
    ]
    return Section {
      ForEach(rows, id: \.label) { row in
        HStack {
          VStack(alignment: .leading, spacing: 2) {
            Text(row.label).font(AglynFont.caption).foregroundStyle(.secondary)
            if let value = row.value { Text(value).font(AglynFont.body) } else { StatusChip("Not entered") }
          }
          Spacer()
          Button(row.value != nil ? "Edit" : "Add") { context.navigate(siteSetupScreen, ["section": row.section.rawValue]) }
            .buttonStyle(.borderless)
        }
      }
    } header: {
      Text("From your site settings")
    } footer: {
      Text("Aglyn AI uses these exactly as entered. It never makes up a name, an email, a phone number, an address or opening hours.")
    }
    .accessibilityIdentifier("business-facts")
  }
}
