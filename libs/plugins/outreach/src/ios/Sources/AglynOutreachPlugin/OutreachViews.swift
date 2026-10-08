// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynPluginHost
import AglynUI
import SwiftUI

#if canImport(AuthenticationServices)
  import AuthenticationServices
#endif

func problemText(_ error: Error) -> String {
  (error as? LocalizedError)?.errorDescription ?? "Something went wrong. Try again."
}

enum OutreachSection: String, CaseIterable, Identifiable, Hashable {
  case sequences, mailboxes, compliance
  var id: String { rawValue }
  var screen: String { "outreach.\(rawValue)" }
  var label: String { self == .sequences ? "All sequences" : rawValue.capitalized }
  var symbol: String {
    switch self {
    case .sequences: "arrow.triangle.branch"
    case .mailboxes: "tray.full"
    case .compliance: "checkmark.shield"
    }
  }
}

/// The Outreach hub, behind the console's three gates; nothing of it shows where the console shows nothing.
struct OutreachHubScreen: View {
  let context: NativePluginContext
  @State var section: OutreachSection
  var initial: String?
  @State private var gate = OutreachGate()

  var body: some View {
    Group {
      if !gate.ready {
        List { SkeletonRows(count: 6) }.aglynListBackground()
      } else if let orgID = context.orgID, gate.open(orgID: orgID) {
        let api = OutreachAPI(api: context.api, orgID: orgID)
        VStack(spacing: 0) {
          AglynSectionBar(OutreachSection.allCases, selection: $section, label: \.label, systemImage: \.symbol)
          switch section {
          case .sequences: SequencesSection(context: context, api: api, orgID: orgID, initial: initial)
          case .mailboxes: MailboxesSection(context: context, api: api, orgID: orgID)
          case .compliance: ComplianceSection(context: context, api: api, orgID: orgID)
          }
        }
        .background(AglynColor.page)
      } else {
        AglynEmptyState("Not available", systemImage: "lock", message: "This workspace does not have this area.")
      }
    }
    .navigationTitle("Sequences")
    .task(id: context.orgID) { gate.start(context) }
    .onChange(of: gate.member.document?.string("roleId")) { _, _ in gate.follow(context) }
    .onDisappear { gate.stop() }
  }
}

/// Home's Sequences card: active sequences and the people in them, drawn only where the console shows
/// the Outreach tab (nothing at all otherwise).
struct OutreachGlanceWidget: View {
  let context: NativePluginContext
  @State private var gate = OutreachGate()
  @State private var active = LiveQueryList(pageSize: 50, map: sequenceRow)

  var body: some View {
    Group {
      if gate.ready, gate.open(orgID: context.orgID) {
        MetricCard(
          "Sequences", systemImage: "arrow.triangle.branch", tone: .info, value: active.ready ? "\(active.rows.count)\(active.hasMore ? "+" : "")" : nil,
          caption: active.rows.count == 1 ? "sequence sending" : "sequences sending", actionLabel: "Open sequences"
        ) {
          context.navigate(outreachSequencesScreen)
        }
        .task {
          guard let orgID = context.orgID else { return }
          active.show(context.firestore) { sequencesQuery(orgID, status: "active", search: "", limit: $0) }
        }
      }
    }
    .task(id: context.orgID) { gate.start(context) }
    .onChange(of: gate.member.document?.string("roleId")) { _, _ in gate.follow(context) }
    .onDisappear {
      gate.stop()
      active.stop()
    }
  }
}

// MARK: Sequences

struct SequencesSection: View {
  let context: NativePluginContext
  let api: OutreachAPI
  let orgID: String
  var initial: String?
  @State private var list = LiveQueryList(pageSize: 25, map: sequenceRow)
  @State private var mailboxes = LiveQueryList(pageSize: 50, map: mailboxRow)
  @State private var status = ""
  @State private var searchText = ""
  @State private var search = ""
  @State private var selection: String?
  @State private var creating = false

  var body: some View {
    WideLayoutReader { wide in
      if wide {
        HStack(spacing: 0) {
          pane(selectable: true).frame(minWidth: 300, idealWidth: 360, maxWidth: 420)
          Divider()
          if let selection {
            SequenceDetail(context: context, api: api, orgID: orgID, sequenceID: selection, mailboxes: mailboxes.rows).id(selection)
          } else {
            AglynEmptyState("Pick a sequence", systemImage: "arrow.triangle.branch").frame(maxWidth: .infinity, maxHeight: .infinity)
          }
        }
      } else {
        pane(selectable: false)
      }
    }
    .searchable(text: $searchText, prompt: "Search sequences")
    .onSubmit(of: .search) { search = searchText }
    .onChange(of: searchText) { _, text in if text.isEmpty { search = "" } }
    .toolbar {
      ToolbarItem(placement: .primaryAction) { Button("New sequence", systemImage: "plus") { creating = true }.accessibilityIdentifier("sequence-new") }
    }
    .task(id: "\(status)|\(search)") {
      if selection == nil { selection = initial }
      let status = status, search = search, orgID = orgID
      list.show(context.firestore) { sequencesQuery(orgID, status: status, search: search, limit: $0) }
      mailboxes.show(context.firestore) { _ in FirestoreQuery(["orgs", orgID, "outreachMailboxes"], limit: 50) }
    }
    .onDisappear {
      list.stop()
      mailboxes.stop()
    }
    .sheet(isPresented: $creating) {
      SequenceEditor(context: context, api: api, sequence: nil, mailboxes: mailboxes.rows) { selection = $0 }
    }
  }

  @ViewBuilder
  private func pane(selectable: Bool) -> some View {
    VStack(spacing: 0) {
      ScrollView(.horizontal, showsIndicators: false) {
        HStack(spacing: AglynSpace.one) {
          AglynChoiceChip("All", selected: status.isEmpty) { status = "" }
          ForEach(["draft", "active", "paused", "archived"], id: \.self) { value in
            AglynChoiceChip(sequenceStatusLabels[value] ?? value, selected: status == value) { status = value }
          }
        }
        .padding(.horizontal, AglynSpace.two)
        .padding(.vertical, AglynSpace.one)
      }
      if selectable && list.ready && list.failure == nil && !list.rows.isEmpty {
        List(selection: $selection) {
          ForEach(list.rows) { row in SequenceRowView(row: row, mailboxes: mailboxes.rows).tag(row.id).aglynListRow() }
          if list.hasMore { Button("Show more") { list.loadMore() }.frame(maxWidth: .infinity) }
        }
        .aglynListBackground()
      } else {
        AglynLiveList(
          rows: list.rows, ready: list.ready, failure: list.failure, hasMore: list.hasMore, failedTitle: "Could not load sequences",
          emptyTitle: "No sequences yet", emptyMessage: "A sequence sends a few one-to-one emails and tasks, spaced out, until someone replies.",
          systemImage: "arrow.triangle.branch", onMore: { list.loadMore() }, onRetry: { list.retry() }
        ) { row in
          NavigationLink {
            SequenceDetail(context: context, api: api, orgID: orgID, sequenceID: row.id, mailboxes: mailboxes.rows)
          } label: {
            SequenceRowView(row: row, mailboxes: mailboxes.rows)
          }
        }
      }
    }
  }
}

struct SequenceRowView: View {
  let row: SequenceRow
  let mailboxes: [MailboxRow]

  var body: some View {
    let mailbox = mailboxes.first { $0.id == row.mailboxID }
    AglynRow(row.name, subtitle: "\(row.steps.count) steps · \(mailbox?.sendAs ?? mailbox?.email ?? "No mailbox")", systemImage: "arrow.triangle.branch") {
      StatusChip(sequenceStatusLabels[row.status] ?? row.status, tone: row.status == "active" ? .success : row.status == "paused" ? .warning : .neutral)
    }
    .accessibilityIdentifier("sequence-\(row.id)")
  }
}

/// One sequence: its steps, status, enrollments; activate, pause, archive, edit, delete and enroll.
struct SequenceDetail: View {
  let context: NativePluginContext
  let api: OutreachAPI
  let orgID: String
  let sequenceID: String
  let mailboxes: [MailboxRow]
  @Environment(\.dismiss) private var dismiss
  @State private var doc = LiveDocument()
  @State private var enrollments = LiveQueryList(pageSize: 25, map: enrollmentRow)
  @State private var editing = false
  @State private var enrolling = false
  @State private var confirm: (title: String, action: String)?
  @State private var notice: (String, AglynTone)?

  var body: some View {
    Group {
      if let document = doc.document {
        let row = sequenceRow(document)
        Form {
          if let notice { AglynNotice(notice.0, tone: notice.1) { self.notice = nil } }
          Section {
            HStack {
              Text(row.name).font(AglynFont.title2)
              Spacer()
              StatusChip(sequenceStatusLabels[row.status] ?? row.status, tone: row.status == "active" ? .success : .neutral)
            }
            PropertyRow("Sends from", mailboxes.first { $0.id == row.mailboxID }.map { $0.sendAs ?? $0.email })
            HStack {
              if row.status == "draft" || row.status == "paused" {
                Button("Activate") { confirm = ("Activate this sequence?", "activate") }.buttonStyle(.borderedProminent)
              }
              if row.status == "active" { Button("Pause") { confirm = ("Pause this sequence?", "pause") }.buttonStyle(.bordered) }
              if row.status != "archived" { Button("Archive") { confirm = ("Archive this sequence?", "archive") }.buttonStyle(.bordered) }
              if row.status == "active" { Button("Enroll people") { enrolling = true }.buttonStyle(.bordered).accessibilityIdentifier("sequence-enroll") }
            }
          }
          Section("Steps") {
            ForEach(Array(row.steps.enumerated()), id: \.offset) { index, step in
              AglynRow(
                step.kind == "email" ? (step.subject.isEmpty ? "Reply in thread" : step.subject) : step.title,
                subtitle: "Step \(index + 1) · \(step.kind == "email" ? "Email" : taskKindLabels.first { $0.0 == step.taskKind }?.1 ?? "Task") · wait \(Int(step.delayBusinessDays)) business day\(step.delayBusinessDays == 1 ? "" : "s")",
                systemImage: step.kind == "email" ? "envelope" : "checklist")
            }
          }
          Section("Enrollments") {
            if enrollments.rows.isEmpty { Text(enrollments.ready ? "Nobody is enrolled yet." : "Loading…").foregroundStyle(.secondary) }
            ForEach(enrollments.rows) { enrollment in
              AglynRow(
                enrollment.name,
                subtitle: [
                  enrollment.email, "step \(enrollment.stepIndex + 1)", enrollment.nextDueAt.map { "next \(relativeTime($0))" }, enrollment.stopReason,
                ].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · "),
                systemImage: "person"
              ) {
                HStack {
                  StatusChip(enrollmentStatusLabels[enrollment.status] ?? enrollment.status)
                  Menu {
                    if enrollment.status == "active" { Button("Pause") { act(enrollment.id, "pause") } }
                    if enrollment.status == "paused" { Button("Resume") { act(enrollment.id, "resume") } }
                    if ["active", "paused"].contains(enrollment.status) { Button("Stop", role: .destructive) { act(enrollment.id, "stop") } }
                    Button("Do not contact", role: .destructive) { act(enrollment.id, "do_not_contact") }
                  } label: {
                    Image(systemName: "ellipsis.circle")
                  }
                }
              }
            }
            if enrollments.hasMore { Button("Show more") { enrollments.loadMore() } }
          }
        }
        .formStyle(.grouped)
        .aglynListBackground()
        .navigationTitle(row.name)
        .toolbar {
          ToolbarItem(placement: .primaryAction) {
            Menu {
              Button("Edit", systemImage: "pencil") { editing = true }
              if row.status == "draft" { Button("Delete", systemImage: "trash", role: .destructive) { confirm = ("Delete this sequence?", "delete") } }
            } label: {
              Label("Sequence", systemImage: "ellipsis.circle")
            }
          }
        }
        .sheet(isPresented: $editing) { SequenceEditor(context: context, api: api, sequence: row, mailboxes: mailboxes) { _ in } }
        .sheet(isPresented: $enrolling) {
          EnrollSheet(context: context, api: api, orgID: orgID, sequenceID: sequenceID) { notice = ("Enrolled \($0).", .success) }
        }
        .confirmationDialog(confirm?.title ?? "", isPresented: Binding(get: { confirm != nil }, set: { if !$0 { confirm = nil } }), titleVisibility: .visible) {
          Button(confirm?.action == "delete" ? "Delete" : (confirm?.action ?? "").capitalized, role: confirm?.action == "delete" || confirm?.action == "archive" ? .destructive : nil) {
            guard let action = confirm?.action else { return }
            Task {
              do {
                if action == "delete" {
                  try await api.delete(sequenceID)
                  dismiss()
                } else {
                  try await api.setStatus(sequenceID, action)
                }
              } catch {
                notice = (problemText(error), .error)
              }
            }
          }
        } message: {
          Text(
            confirm?.action == "archive" ? "Everyone still enrolled is stopped. An archived sequence cannot be activated again."
              : confirm?.action == "pause" ? "Nobody is sent the next step until it is activated again."
              : confirm?.action == "delete" ? "It goes for good. Only a draft nobody was enrolled in can be deleted."
              : "Its steps start going out to the people enrolled.")
        }
      } else if doc.ready {
        AglynEmptyState("This sequence is gone", systemImage: "arrow.triangle.branch")
      } else {
        List { SkeletonRows(count: 5) }.aglynListBackground()
      }
    }
    .task(id: sequenceID) {
      let orgID = orgID, sequenceID = sequenceID
      doc.start(context.firestore, ["orgs", orgID, "outreachSequences", sequenceID])
      enrollments.show(context.firestore) { enrollmentsQuery(orgID, sequenceID: sequenceID, status: "", search: "", limit: $0) }
    }
    .onDisappear {
      doc.stop()
      enrollments.stop()
    }
  }

  private func act(_ enrollmentID: String, _ action: String) {
    Task {
      do { try await api.enrollmentAction(enrollmentID, action) } catch { notice = (problemText(error), .error) }
    }
  }
}

/// Write or edit a sequence: its name, mailbox and steps, checked as the console checks before the route does.
struct SequenceEditor: View {
  let context: NativePluginContext
  let api: OutreachAPI
  let sequence: SequenceRow?
  let mailboxes: [MailboxRow]
  let onSaved: (String) -> Void
  @Environment(\.dismiss) private var dismiss
  @State private var name = ""
  @State private var mailboxID = ""
  @State private var steps: [SequenceStep] = []
  @State private var serverIssues: [String] = []
  @State private var busy = false
  @State private var error: String?
  @State private var seeded = false
  @State private var defaultCountries: [String] = ContractValues.shared.outreachDefaultAllowedCountries

  private var issues: [Issue] { validateSequence(name: name, mailboxID: mailboxID, steps: steps) }

  var body: some View {
    NavigationStack {
      Form {
        if let error { AglynNotice(error, tone: .error) }
        ForEach(serverIssues, id: \.self) { AglynNotice($0, tone: .warning) }
        Section {
          TextField("Name", text: $name).accessibilityIdentifier("sequence-name")
          Picker("Sends from", selection: $mailboxID) {
            Text("Choose a mailbox").tag("")
            ForEach(mailboxes.filter { $0.status != "disconnected" }) { Text($0.sendAs ?? $0.email).tag($0.id) }
          }
        }
        ForEach(steps.indices, id: \.self) { index in
          Section {
            if steps[index].kind == "email" {
              if index > (steps.firstIndex { $0.kind == "email" } ?? 0) {
                Toggle("Reply in the same thread", isOn: $steps[index].replyInThread)
              }
              TextField("Subject", text: $steps[index].subject)
              TextField("Email", text: $steps[index].body, axis: .vertical).lineLimit(4...12)
            } else {
              Picker("Task", selection: $steps[index].taskKind) { ForEach(taskKindLabels, id: \.0) { Text($0.1).tag($0.0) } }
              TextField("Title", text: $steps[index].title)
            }
            Stepper(
              "Wait \(Int(steps[index].delayBusinessDays)) business day\(steps[index].delayBusinessDays == 1 ? "" : "s")",
              value: $steps[index].delayBusinessDays, in: 0...Double(ContractValues.shared.outreachMaxStepDelayBusinessDays))
            ForEach(issues.filter { $0.path.hasPrefix("steps.\(index).") }, id: \.message) { Text($0.message).foregroundStyle(AglynColor.error).font(AglynFont.caption) }
            Button("Remove this step", role: .destructive) { steps.remove(at: index) }
          } header: {
            Text("Step \(index + 1) · \(steps[index].kind == "email" ? "Email" : "Task")")
          }
        }
        Section {
          if steps.count < ContractValues.shared.outreachMaxSteps {
            Button("Add an email", systemImage: "envelope") { steps.append(.new(kind: "email", after: steps)) }
            Menu {
              ForEach(taskKindLabels, id: \.0) { kind, label in Button(label) { steps.append(.new(kind: "task", after: steps, taskKind: kind)) } }
            } label: {
              Label("Add a task", systemImage: "checklist")
            }
          }
        } footer: {
          Text(issues.first { !$0.path.hasPrefix("steps.") }?.message ?? "Use {{enrollment.personalLine}} in the first email for the line written for each person.")
        }
      }
      .formStyle(.grouped)
      .navigationTitle(sequence == nil ? "New sequence" : "Edit sequence")
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() }.disabled(busy) }
        ToolbarItem(placement: .confirmationAction) {
          Button(busy ? "Saving…" : "Save") { Task { await save() } }.disabled(busy || !issues.isEmpty).accessibilityIdentifier("sequence-save")
        }
      }
      .task {
        guard !seeded else { return }
        seeded = true
        if let countries = (try? await api.get("settings"))?["settings"]?["allowedCountries"]?.arrayValue?.compactMap(\.stringValue), !countries.isEmpty {
          defaultCountries = countries
        }
        if let sequence {
          name = sequence.name
          mailboxID = sequence.mailboxID ?? ""
          steps = sequence.steps
        } else {
          steps = [.new(kind: "email", after: [])]
          mailboxID = mailboxes.first { $0.status == "connected" }?.id ?? ""
        }
      }
    }
    .frame(minWidth: 440, minHeight: 600)
  }

  private func save() async {
    guard let hostID = sequence?.hostID ?? context.hostID else {
      error = "Pick a site first: a sequence sends for one of the workspace's sites."
      return
    }
    busy = true
    error = nil
    serverIssues = []
    defer { busy = false }
    let settings: [String: Any] =
      sequence?.data["settings"] as? [String: Any]
      ?? [
        "window": NSNull(), "allowedCountries": defaultCountries, "allowCustomers": false, "trackClicks": false, "countOpens": false,
        "listUnsubscribe": false,
      ]
    do {
      let id = try await api.save(
        sequenceID: sequence?.id, name: name.trimmingCharacters(in: .whitespaces), hostID: hostID, mailboxID: mailboxID, steps: steps,
        settings: settings, campaignIDs: sequence?.data["campaignIds"] as? [String] ?? [])
      if let id { onSaved(id) }
      dismiss()
    } catch let failure as ConsoleAPIError {
      error = failure.message
    } catch {
      self.error = problemText(error)
    }
  }
}

/// Enroll CRM contacts or leads: search, pick, the route's preview of where each stands, then enroll.
struct EnrollSheet: View {
  let context: NativePluginContext
  let api: OutreachAPI
  let orgID: String
  let sequenceID: String
  let onEnrolled: (Int) -> Void
  @Environment(\.dismiss) private var dismiss
  @State private var kind = "contacts"
  @State private var search = ""
  @State private var results = LiveQueryList(pageSize: 25) { (id: $0.id, name: $0.string("name") ?? $0.string("email") ?? $0.id, email: $0.string("email") ?? "") }
  @State private var picked: Set<String> = []
  @State private var preview: [PreviewPerson]?
  @State private var personalLines: [String: String] = [:]
  @State private var attested: Set<String> = []
  @State private var busy = false
  @State private var error: String?

  var body: some View {
    NavigationStack {
      Form {
        if let error { AglynNotice(error, tone: .error) }
        if let preview {
          ForEach(preview) { person in
            Section {
              LabeledContent(person.name.isEmpty ? person.email : person.name, value: person.status.replacingOccurrences(of: "_", with: " "))
              ForEach(person.blocks, id: \.self) { Text($0).foregroundStyle(.secondary).font(AglynFont.caption) }
              if person.status != "blocked" {
                if person.needsPersonalLine {
                  TextField("A line written for them", text: Binding(get: { personalLines[person.personID] ?? "" }, set: { personalLines[person.personID] = String($0.prefix(300)) }))
                }
                if !person.attestations.isEmpty {
                  Toggle("I confirm: \(person.attestations.map { $0.replacingOccurrences(of: "_", with: " ") }.joined(separator: ", "))",
                    isOn: Binding(get: { attested.contains(person.personID) }, set: { on in if on { attested.insert(person.personID) } else { attested.remove(person.personID) } }))
                }
              }
            }
          }
        } else {
          Picker("Who", selection: $kind) {
            Text("Contacts").tag("contacts")
            Text("Leads").tag("leads")
          }
          .pickerStyle(.segmented)
          TextField("Search by name", text: $search).onSubmit { reload() }
          ForEach(results.rows, id: \.id) { row in
            Toggle(isOn: Binding(get: { picked.contains(row.id) }, set: { on in if on { picked.insert(row.id) } else { picked.remove(row.id) } })) {
              VStack(alignment: .leading) {
                Text(row.name)
                Text(row.email).font(AglynFont.caption).foregroundStyle(.secondary)
              }
            }
          }
        }
      }
      .formStyle(.grouped)
      .navigationTitle("Enroll people")
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() }.disabled(busy) }
        ToolbarItem(placement: .confirmationAction) {
          if preview == nil {
            Button("Check") { Task { await check() } }.disabled(busy || picked.isEmpty || picked.count > 50)
          } else {
            Button("Enroll") { Task { await enroll() } }.disabled(busy || ready.isEmpty)
          }
        }
      }
      .task(id: kind) { reload() }
      .onDisappear { results.stop() }
    }
    .frame(minWidth: 420, minHeight: 520)
  }

  private var ready: [PreviewPerson] {
    (preview ?? []).filter { person in
      person.status != "blocked" && (!person.needsPersonalLine || !(personalLines[person.personID] ?? "").trimmingCharacters(in: .whitespaces).isEmpty)
        && (person.attestations.isEmpty || attested.contains(person.personID))
    }
  }

  private func reload() {
    picked = []
    let collection = kind == "contacts" ? "contacts" : "leads"
    let words = search.trimmingCharacters(in: .whitespaces)
    let orgID = orgID
    results.show(context.firestore) { limit in
      FirestoreQuery(
        ["orgs", orgID, collection],
        filters: words.isEmpty ? [] : [ListQueryConstraint(path: "nameTokens", op: .arrayContains, value: nameSearchToken(words))], limit: limit)
    }
  }

  private func check() async {
    busy = true
    error = nil
    defer { busy = false }
    do { preview = try await api.preview(sequenceID: sequenceID, kind: kind, ids: Array(picked)) } catch { self.error = problemText(error) }
  }

  private func enroll() async {
    busy = true
    error = nil
    defer { busy = false }
    let people: [[String: Any]] = ready.map { person in
      var entry: [String: Any] = [:]
      if let id = person.contactID { entry["contactId"] = id } else if let id = person.leadID { entry["leadId"] = id }
      if let line = personalLines[person.personID], !line.isEmpty { entry["personalLine"] = line }
      if !person.attestations.isEmpty { entry["attestations"] = person.attestations }
      return entry
    }
    do {
      onEnrolled(try await api.enroll(sequenceID: sequenceID, people: people))
      dismiss()
    } catch {
      self.error = problemText(error)
    }
  }
}

// MARK: Mailboxes

struct MailboxesSection: View {
  let context: NativePluginContext
  let api: OutreachAPI
  let orgID: String
  @State private var list = LiveQueryList(pageSize: 50, map: mailboxRow)
  @State private var editing: MailboxRow?
  @State private var disconnecting: MailboxRow?
  @State private var notice: (String, AglynTone)?
  @State private var connecting = false

  var body: some View {
    VStack(spacing: 0) {
      if let notice { AglynNotice(notice.0, tone: notice.1) { self.notice = nil }.padding(.horizontal, AglynSpace.two) }
      AglynLiveList(
        rows: list.rows, ready: list.ready, failure: list.failure, hasMore: false, failedTitle: "Could not load mailboxes",
        emptyTitle: "No mailboxes yet", emptyMessage: "A sequence sends from a connected Google or Microsoft mailbox.", systemImage: "tray.full",
        onMore: {}, onRetry: { list.retry() }
      ) { mailbox in
        AglynRow(
          mailbox.sendAs ?? mailbox.email,
          subtitle: [mailbox.displayName, mailbox.dailyCap.map { "\(mailbox.sentToday ?? 0) of \($0) today" }].compactMap { $0 }.joined(separator: " · "),
          systemImage: "tray.full"
        ) {
          HStack {
            StatusChip(mailbox.status.replacingOccurrences(of: "_", with: " ").capitalized, tone: mailbox.status == "connected" ? .success : .warning)
            Menu {
              if mailbox.status == "connected" { Button("Pause") { run("Paused.") { try await api.mailboxStatus(mailbox.id, paused: true) } } }
              if mailbox.status == "paused" { Button("Resume") { run("Resumed.") { try await api.mailboxStatus(mailbox.id, paused: false) } } }
              Button("Settings") { editing = mailbox }
              Button("Send a test") {
                Task {
                  do { notice = ("A test went to \(try await api.mailboxTest(mailbox.id) ?? mailbox.email).", .success) } catch { notice = (problemText(error), .error) }
                }
              }
              Button("Disconnect", role: .destructive) { disconnecting = mailbox }
            } label: {
              Image(systemName: "ellipsis.circle")
            }
          }
        }
      }
    }
    .toolbar {
      ToolbarItem(placement: .primaryAction) {
        Menu {
          Button("Google") { Task { await connect("google") } }
          Button("Microsoft") { Task { await connect("microsoft") } }
        } label: {
          Label(connecting ? "Connecting…" : "Connect a mailbox", systemImage: "plus")
        }
        .disabled(connecting)
      }
    }
    .task {
      let orgID = orgID
      list.show(context.firestore) { _ in FirestoreQuery(["orgs", orgID, "outreachMailboxes"], limit: 50) }
    }
    .onDisappear { list.stop() }
    .sheet(item: $editing) { mailbox in MailboxSettingsSheet(api: api, mailbox: mailbox) }
    .confirmationDialog("Disconnect this mailbox?", isPresented: Binding(get: { disconnecting != nil }, set: { if !$0 { disconnecting = nil } }), titleVisibility: .visible) {
      Button("Disconnect", role: .destructive) {
        guard let mailbox = disconnecting else { return }
        run("Disconnected.") { try await api.mailboxDisconnect(mailbox.id) }
      }
    } message: {
      Text("Sequences sending from it stop sending until another mailbox is chosen.")
    }
  }

  private func run(_ done: String, _ act: @escaping () async throws -> Void) {
    Task {
      do {
        try await act()
        notice = (done, .success)
      } catch {
        notice = (problemText(error), .error)
      }
    }
  }

  /// Connects through the provider's consent page in the system's sign-in sheet, which returns to the
  /// console's Mailboxes address with the code in its fragment, finished with the member's own session.
  private func connect(_ provider: String) async {
    connecting = true
    defer { connecting = false }
    do {
      guard let url = try await api.connectURL(provider: provider), let host = URL(string: context.api.origin)?.host else { return }
      let path = "/\(context.orgSlug ?? "")/outreach/mailboxes"
      let callback = try await OAuthSheet.run(url: url, host: host, path: path)
      let fragment = callback.fragment ?? ""
      let items = Dictionary(
        fragment.split(separator: "&").compactMap { pair -> (String, String)? in
          let parts = pair.split(separator: "=", maxSplits: 1).map { String($0).removingPercentEncoding ?? String($0) }
          return parts.count == 2 ? (parts[0], parts[1]) : nil
        }, uniquingKeysWith: { a, _ in a })
      guard items["outreachConnect"] == "code", let code = items["code"], let state = items["state"] else {
        notice = ("The mailbox was not connected (\(items["reason"] ?? "canceled")).", .warning)
        return
      }
      try await api.connectComplete(code: code, state: state)
      notice = ("Connected.", .success)
    } catch {
      notice = (problemText(error), .error)
    }
  }
}

/// The system's sign-in sheet for a provider's consent page (never the browser, never a console page).
enum OAuthSheet {
  struct Unavailable: LocalizedError { var errorDescription: String? { "Connecting a mailbox needs iOS 17.4 or macOS 14.4." } }
  struct Canceled: LocalizedError { var errorDescription: String? { "Canceled." } }

  @MainActor
  static func run(url: URL, host: String, path: String) async throws -> URL {
    #if canImport(AuthenticationServices)
      guard #available(iOS 17.4, macOS 14.4, *) else { throw Unavailable() }
      return try await withCheckedThrowingContinuation { continuation in
        let session = ASWebAuthenticationSession(url: url, callback: .https(host: host, path: path)) { callback, error in
          if let callback { continuation.resume(returning: callback) } else { continuation.resume(throwing: error ?? Canceled()) }
        }
        session.presentationContextProvider = PresentationAnchor.shared
        session.prefersEphemeralWebBrowserSession = false
        session.start()
      }
    #else
      throw Unavailable()
    #endif
  }
}

#if canImport(AuthenticationServices)
  final class PresentationAnchor: NSObject, ASWebAuthenticationPresentationContextProviding {
    static let shared = PresentationAnchor()
    @MainActor
    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
      #if os(iOS)
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        return scenes.flatMap(\.windows).first { $0.isKeyWindow } ?? ASPresentationAnchor()
      #else
        return NSApplication.shared.keyWindow ?? ASPresentationAnchor()
      #endif
    }
  }
#endif

struct MailboxSettingsSheet: View {
  let api: OutreachAPI
  let mailbox: MailboxRow
  @State private var displayName = ""
  @State private var dailyCap = 20.0

  var body: some View {
    AglynFormSheet("Mailbox settings", save: {
      try await api.mailboxSettings(mailbox.id, ["displayName": displayName.trimmingCharacters(in: .whitespaces), "dailyCap": Int(dailyCap)])
    }) {
      TextField("Display name", text: $displayName)
      Stepper("At most \(Int(dailyCap)) emails a day", value: $dailyCap, in: 1...200)
    }
    .onAppear {
      displayName = mailbox.displayName ?? ""
      dailyCap = Double(mailbox.dailyCap ?? 20)
    }
  }
}

// MARK: Compliance

struct ComplianceSection: View {
  let context: NativePluginContext
  let api: OutreachAPI
  let orgID: String
  @State private var legalName = ""
  @State private var brandName = ""
  @State private var postalAddress = ""
  @State private var countries = ""
  @State private var loaded = false
  @State private var domains = LiveQueryList(pageSize: 50) { (id: $0.id, domain: $0.string("domain") ?? $0.id, reason: $0.string("reason")) }
  @State private var links: [(domain: String, status: String)] = []
  @State private var newDomain = ""
  @State private var newLinkDomain = ""
  @State private var notice: (String, AglynTone)?

  var body: some View {
    Form {
      if let notice { AglynNotice(notice.0, tone: notice.1) { self.notice = nil } }
      Section {
        TextField("Legal name", text: $legalName)
        TextField("Brand name", text: $brandName)
        TextField("Postal address", text: $postalAddress, axis: .vertical).lineLimit(2...6)
        TextField("Countries it may send to (US, CA…)", text: $countries)
        Button("Save") { Task { await saveSettings() } }.disabled(!loaded)
      } header: {
        Text("Who the emails come from")
      } footer: {
        Text("Every sequence email carries the legal name and postal address, as the law asks of commercial email.")
      }
      Section("Do not contact") {
        ForEach(domains.rows, id: \.id) { row in
          AglynRow(row.domain, subtitle: row.reason, systemImage: "nosign") {
            Button("Remove") { run("Removed.") { try await api.doNotContactDomain("remove", domain: row.domain) } }.buttonStyle(.borderless)
          }
        }
        HStack {
          TextField("example.com", text: $newDomain)
          Button("Add") {
            let domain = newDomain.trimmingCharacters(in: .whitespaces)
            newDomain = ""
            run("Nobody at \(domain) is enrolled from now on.") { try await api.doNotContactDomain("add", domain: domain) }
          }
          .disabled(newDomain.trimmingCharacters(in: .whitespaces).isEmpty)
        }
      }
      Section {
        ForEach(links, id: \.domain) { link in
          AglynRow(link.domain, subtitle: link.status.replacingOccurrences(of: "-", with: " ").capitalized, systemImage: "link") {
            Menu {
              Button("Check") { run("Checked.") { try await api.linkDomain("check", domain: link.domain); await loadLinks() } }
              Button("Remove", role: .destructive) { run("Removed.") { try await api.linkDomain("remove", domain: link.domain); await loadLinks() } }
            } label: {
              Image(systemName: "ellipsis.circle")
            }
          }
        }
        HStack {
          TextField("links.example.com", text: $newLinkDomain)
          Button("Set up") {
            let domain = newLinkDomain.trimmingCharacters(in: .whitespaces)
            newLinkDomain = ""
            run("Set up. Add the records it lists at your DNS provider.") { try await api.linkDomain("set-up", domain: domain); await loadLinks() }
          }
          .disabled(newLinkDomain.trimmingCharacters(in: .whitespaces).isEmpty)
        }
      } header: {
        Text("Link domains")
      } footer: {
        Text("Tracked links point at your own domain rather than a shared one.")
      }
    }
    .formStyle(.grouped)
    .aglynListBackground()
    .task {
      let orgID = orgID
      domains.show(context.firestore) { doNotContactDomainsQuery(orgID, search: "", limit: $0) }
      if let settings = try? await api.get("settings")?["settings"] {
        legalName = settings["legalName"]?.stringValue ?? ""
        brandName = settings["brandName"]?.stringValue ?? ""
        postalAddress = settings["postalAddress"]?.stringValue ?? ""
        countries = (settings["allowedCountries"]?.arrayValue ?? []).compactMap(\.stringValue).joined(separator: ", ")
      }
      loaded = true
      await loadLinks()
    }
    .onDisappear { domains.stop() }
  }

  private func loadLinks() async {
    links = ((try? await api.get("link-domains"))?["domains"]?.arrayValue ?? []).compactMap { item in
      guard let domain = item["domain"]?.stringValue else { return nil }
      return (domain, item["status"]?.stringValue ?? "not-set-up")
    }
  }

  private func saveSettings() async {
    do {
      try await api.post(
        "settings",
        [
          "legalName": legalName.trimmingCharacters(in: .whitespaces), "brandName": brandName.trimmingCharacters(in: .whitespaces),
          "postalAddress": postalAddress.trimmingCharacters(in: .whitespacesAndNewlines),
          "allowedCountries": countries.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces).uppercased() }.filter { !$0.isEmpty },
        ])
      notice = ("Saved.", .success)
    } catch {
      notice = (problemText(error), .error)
    }
  }

  private func run(_ done: String, _ act: @escaping () async throws -> Void) {
    Task {
      do {
        try await act()
        notice = (done, .success)
      } catch {
        notice = (problemText(error), .error)
      }
    }
  }
}
