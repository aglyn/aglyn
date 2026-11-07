// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynPluginHost
import AglynUI
import SwiftUI

/*
 * The CRM's default sharing for new records, as the console's DefaultRecordSharingCard has it (AGL-4047): all sites,
 * only the site they came in on, or all sites except some. "All sites except…" is stored as `defaultRecordScope: 'host'`
 * beside `defaultRecordExcept`, so a reader that predates it never shares a new record with a site left out. Saving
 * changes only new records; "Apply to existing records…" asks `crm/sharing` (`default-apply`) to share the ones the
 * workspace has the same way, in passes, and the org document reports the run.
 */

/// A run of "Apply to existing records", as the org document reports it (`readCrmDefaultApplyRun`).
struct CrmDefaultApplyRun: Equatable {
  let status: String
  let processed: Int
  let changed: Int
  let capped: Int
  let error: String?

  init?(_ raw: Any?) {
    guard let value = raw as? [String: Any] else { return nil }
    let stored = value["status"] as? String
    status = stored == "done" || stored == "failed" ? stored! : "running"
    processed = (value["processed"] as? NSNumber)?.intValue ?? 0
    changed = (value["changed"] as? NSNumber)?.intValue ?? 0
    capped = (value["capped"] as? NSNumber)?.intValue ?? 0
    error = value["error"] as? String
  }

  /// The line under the button.
  var line: String {
    switch status {
    case "running": return "Applying: \(processed) records checked, \(changed) changed so far."
    case "done":
      let left =
        capped > 0
        ? ", \(capped) left as they were because they would reach more than \(crmDefaultMaxIncluded) sites" : ""
      return "Applied: \(processed) records checked, \(changed) changed\(left)."
    default: return error ?? "Applying stopped."
    }
  }
}

struct CrmDefaultSharingSection: View {
  let context: NativePluginContext
  let scope: CrmScope

  @State private var mode = "org"
  @State private var except: [String] = []
  @State private var busy = false
  @State private var applying = false
  @State private var pass: CrmDefaultApplyRun?
  @State private var confirmApply = false
  @State private var notice: (text: String, tone: AglynTone)?

  private var storedMode: String { crmDefaultSharing(scope.org) ?? "org" }
  private var storedExcept: [String] { crmDefaultExcept(scope.org) ?? [] }
  private var sites: [NativeSiteRef] { context.sites }
  private var siteIDs: [String] { sites.map(\.id) }
  private var canManage: Bool { scope.canManage }

  private var exceptOff: String? {
    guard canManage else { return nil }
    if sites.count < 2 { return "This workspace has one site, so there is nothing to leave out." }
    if sites.count > crmDefaultMaxIncluded {
      return "This works up to \(crmDefaultMaxIncluded) sites, and this workspace has \(sites.count). Choose another option."
    }
    return nil
  }

  private var problem: String? {
    mode == "allExcept" ? sharingFromChoice(.allExcept(exceptHostIDs: except), orgHostIDs: siteIDs).problem : nil
  }

  private var changed: Bool {
    mode != storedMode || (mode == "allExcept" && Set(except) != Set(storedExcept))
  }

  private var canSave: Bool {
    canManage && !busy && changed && problem == nil && (mode != "allExcept" || exceptOff == nil)
  }

  private var run: CrmDefaultApplyRun? { pass ?? CrmDefaultApplyRun((scope.org["crm"] as? [String: Any])?["defaultApplyRun"]) }

  private var applyOff: String? {
    if storedMode != "allExcept" { return "Choose All sites except… and save it first." }
    if changed { return "Save the default first." }
    if applying || run?.status == "running" { return "Applying now." }
    return nil
  }

  var body: some View {
    Section {
      if let notice { AglynNotice(notice.text, tone: notice.tone) { self.notice = nil } }
      Text("New contacts, companies, deals and tasks are shared with").font(AglynFont.subheadline).foregroundStyle(.secondary)
      AglynChoiceRow("All sites in the organization", selected: mode == "org", enabled: canManage && !busy) { mode = "org" }
        .accessibilityIdentifier("crm-default-org")
      AglynChoiceRow(
        "Only the site they came in on", detail: "Keeps clients apart, for agencies.", selected: mode == "host",
        enabled: canManage && !busy
      ) { mode = "host" }
      .accessibilityIdentifier("crm-default-host")
      let exceptEnabled = canManage && !busy && (exceptOff == nil || storedMode == "allExcept")
      AglynChoiceRow(
        "All sites except…",
        detail: exceptOff
          ?? "Every site but the ones you leave out, including sites added later. The site a person came in on always keeps them.",
        selected: mode == "allExcept", enabled: exceptEnabled
      ) {
        guard exceptEnabled else { return }
        if storedMode != "allExcept" && mode != "allExcept" { except = [] }
        mode = "allExcept"
      }
      .accessibilityIdentifier("crm-default-allExcept")
      if mode == "allExcept" {
        Text("Sites to leave out").font(AglynFont.caption).foregroundStyle(.secondary)
        let stillIn = siteIDs.filter { !except.contains($0) }
        ForEach(sites) { site in
          let locked = stillIn.count == 1 && stillIn[0] == site.id
          Toggle(
            isOn: Binding(
              get: { except.contains(site.id) },
              set: { on in if on { except.append(site.id) } else { except.removeAll { $0 == site.id } } })
          ) {
            VStack(alignment: .leading, spacing: 2) {
              Text(site.name)
              if locked { Text("At least one site has to stay in.").font(AglynFont.caption).foregroundStyle(.secondary) }
            }
          }
          .disabled(!canManage || busy || locked)
          .accessibilityIdentifier("crm-default-site-\(site.id)")
        }
      }
      if let problem { AglynHelperText(problem, isError: true) }
      Button("Save") { Task { await save() } }
        .disabled(!canSave)
        .accessibilityIdentifier("crm-default-save")
    } header: {
      Text("Default sharing for new records")
    } footer: {
      Text(
        "Only affects records created from now on. Datasets and media have defaults of their own, on the organization Data and Media pages."
      )
    }
    .task(id: "\(storedMode)|\(storedExcept.joined(separator: ","))") {
      mode = storedMode
      except = storedExcept
    }
    Section {
      Text(
        "Saving changes only new records. To share the ones you already have the same way, apply it to them. The site that captured each person keeps them."
      )
      .foregroundStyle(.secondary)
      Button("Apply to existing records…") { confirmApply = true }
        .disabled(!canManage || applyOff != nil)
        .accessibilityIdentifier("crm-default-apply")
      if let applyOff, canManage { Text(applyOff).font(AglynFont.caption).foregroundStyle(.secondary) }
      if run?.status == "failed" && storedMode == "allExcept" && !applying {
        Button("Resume") { Task { await apply("default-apply-continue") } }.disabled(!canManage)
      }
      if let run {
        Text(run.line).font(AglynFont.caption).foregroundStyle(run.status == "failed" ? AglynColor.error : AglynColor.secondaryText)
          .accessibilityIdentifier("crm-default-run")
      }
    } header: {
      Text("Records you already have")
    }
    .confirmationDialog("Apply to existing records?", isPresented: $confirmApply, titleVisibility: .visible) {
      Button("Apply to existing records") { Task { await apply("default-apply") } }
    } message: {
      Text(
        "Every contact, lead, company, deal, task and logged activity this workspace has is shared with every site except \(storedExcept.map { context.siteName($0) }.joined(separator: ", ")). The site that captured a person keeps them. Sites left out stop seeing the rest. Records shared by hand or by a sharing rule keep those shares."
      )
    }
  }

  private func save() async {
    guard canSave else { return }
    busy = true
    defer { busy = false }
    let allExcept = mode == "allExcept"
    do {
      try await context.firestore.setDocument(
        ["orgs", scope.orgID],
        [
          "crm": [
            "defaultRecordScope": mode == "org" ? "org" : "host",
            "defaultRecordExcept": allExcept ? except.filter(siteIDs.contains) as Any : FirestoreSentinel.delete as Any,
            "defaultRecordExceptAt": allExcept ? FirestoreSentinel.serverTimestamp as Any : FirestoreSentinel.delete as Any,
          ]
        ], merge: true)
      notice = ("Default sharing updated", .success)
    } catch {
      mode = storedMode
      except = storedExcept
      notice = ("The setting could not be saved", .error)
    }
  }

  private func apply(_ action: String) async {
    applying = true
    defer { applying = false }
    do {
      var answer = try await call(action)
      while answer?["more"]?.boolValue == true {
        answer = try await call("default-apply-continue")
      }
      if pass?.status == "done" { notice = ("The default sharing is applied to existing records", .success) }
    } catch let error as ConsoleAPIError {
      notice = (error.body?["error"]?.stringValue ?? "The sharing could not be saved.", .error)
    } catch {
      notice = ("The sharing could not be saved.", .error)
    }
  }

  private func call(_ action: String) async throws -> JSONValue? {
    let answer = try await context.api.request(
      "/api/crm/sharing", method: .post, body: .object(["orgId": .string(scope.orgID), "action": .string(action)]))
    if let raw = answer?["applyRun"], let run = CrmDefaultApplyRun(raw.foundation) { pass = run }
    return answer
  }
}
