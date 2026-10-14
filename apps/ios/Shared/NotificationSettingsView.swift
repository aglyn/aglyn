// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import AglynUI
import SwiftUI
import UserNotifications

/// The console's notification settings page, natively: what each category
/// and type does in the app, by email and as push at the account; one
/// workspace's or one site's own answers (Inherit, On or Off); the digests;
/// and this device. Every switch writes the one leaf it changes in the
/// person's own `users/{uid}` document (`notificationSettings`,
/// `digestPrefs`, `insightDigests`), as the console's page does, under the
/// same owner-only rule.
struct NotificationSettingsView: View {
  @Environment(AppModel.self) private var model
  @Environment(\.openURL) private var openURL
  @State private var profile: FirestoreDocument?
  @State private var loaded = false
  @State private var failed = false
  @State private var saveFailed = false
  /// Answers saved from this screen, shown before the document echoes them back.
  @State private var pending: [String: Bool?] = [:]
  @State private var listener: FirestoreListening?
  @State private var siteListener: FirestoreListening?
  @State private var sites: [(id: String, name: String)] = []
  @State private var scopeKey = "account"
  @State private var expanded: Set<String> = []

  private let catalog = NotificationCatalog.shared

  private var data: [String: Any] { profile?.data ?? [:] }
  private var settings: [String: Any]? { data[NotificationSettings.field] as? [String: Any] }
  private var legacy: [String: Any]? { data[NotificationSettings.legacyField] as? [String: Any] }

  private var scopes: [(key: String, scope: NotificationScope, label: String)] {
    (model.workspace?.orgs ?? []).map { ("org:\($0.id)", .org($0.id), $0.name) }
      + sites.map { ("host:\($0.id)", .host($0.id), "\($0.name) (site)") }
  }

  var body: some View {
    Form {
      Section {
        Text(
          "Choose what reaches you in the app, by email and as push. Form submissions, bookings and orders are emailed until you switch them off; everything else is not."
        )
        .font(AglynFont.subheadline)
        .foregroundStyle(.secondary)
        if model.push.authorization == .denied {
          Label("Notifications are turned off for \(model.appName) in this device's settings.", systemImage: "bell.slash")
            .foregroundStyle(AglynColor.warning)
          #if os(iOS)
            Button("Open Settings") {
              if let url = URL(string: UIApplication.openNotificationSettingsURLString) { openURL(url) }
            }
          #endif
        }
        if saveFailed {
          Label("That change did not save. Try again.", systemImage: "exclamationmark.circle")
            .foregroundStyle(AglynColor.error)
        }
      }
      if failed {
        Section { AglynEmptyState("Could not load your settings", systemImage: "exclamationmark.triangle") }
      } else if !loaded {
        Section { SkeletonRows(count: 4) }
      } else {
        accountSections
        scopeSection
        digestSection
        deviceSection
      }
    }
    .formStyle(.grouped)
    .aglynListBackground()
    .navigationTitle("Notification settings")
    .onAppear(perform: start)
    .onDisappear {
      listener?.remove()
      listener = nil
      siteListener?.remove()
      siteListener = nil
    }
  }

  // MARK: What you are told about

  @ViewBuilder
  private var accountSections: some View {
    ForEach(catalog.categories) { category in
      Section {
        HStack(spacing: AglynSpace.one) {
          ForEach([NotificationChannel.console, .email]) { channel in
            channelToggle(
              channel, owner: category.id,
              isOn: pendingValue(answerKey(.account, category.id, false, channel))
                ?? NotificationSettings.categoryValue(catalog, settings, legacy: legacy, category: category.id, channel)
            ) { write(answerKey(.account, category.id, false, channel), $0, NotificationSettings.answerWrite(settings, .account, key: category.id, types: false, channel, $0)) }
          }
        }
        DisclosureGroup(
          isExpanded: Binding(
            get: { expanded.contains(category.id) },
            set: { open in if open { expanded.insert(category.id) } else { expanded.remove(category.id) } })
        ) {
          ForEach(category.types) { entry in typeRow(entry, category: category) }
        } label: {
          Text("Each type").font(AglynFont.subheadline)
        }
        .accessibilityIdentifier("expand-\(category.id)")
      } header: {
        Text(category.label)
      } footer: {
        if let description = category.description { Text(description) }
      }
    }
  }

  private func typeRow(_ entry: NotificationCatalog.Entry, category: NotificationCatalog.Category) -> some View {
    let overridden = [NotificationChannel.console, .email, .push].contains {
      NotificationSettings.scopeTypePref(settings, .account, type: entry.type, $0) != nil
    }
    return VStack(alignment: .leading, spacing: AglynSpace.one) {
      HStack {
        Text(entry.label).font(AglynFont.body)
        Spacer()
        if overridden {
          Button("Follow \(category.label)") {
            write("reset:\(entry.type)", nil, NotificationSettings.resetTypeWrite(entry.type))
          }
          .buttonStyle(.borderless)
          .font(AglynFont.caption)
          .accessibilityIdentifier("reset-\(entry.type)")
        }
      }
      HStack(spacing: AglynSpace.one) {
        ForEach(NotificationChannel.allCases) { channel in
          channelToggle(channel, owner: entry.type, isOn: typeValue(entry, category: category.id, channel)) { next in
            if channel == .push {
              write(
                answerKey(.account, entry.type, true, .push), next,
                [NotificationSettings.field: ["accountTypes": [entry.type: ["push": next]]]])
            } else {
              write(answerKey(.account, entry.type, true, channel), next, NotificationSettings.answerWrite(settings, .account, key: entry.type, types: true, channel, next))
            }
          }
        }
      }
      if let note = entry.selfSentEmail {
        Text(note).font(AglynFont.caption).foregroundStyle(.secondary)
      }
    }
    .padding(.vertical, AglynSpace.half)
    .accessibilityElement(children: .contain)
    .accessibilityIdentifier("type-row-\(entry.type)")
  }

  private func typeValue(_ entry: NotificationCatalog.Entry, category: String, _ channel: NotificationChannel) -> Bool {
    if let value = pendingValue(answerKey(.account, entry.type, true, channel)) { return value }
    if channel == .push {
      return accountPushSwitch(
        settings: settings, type: entry.type, category: category, consoleDefault: entry.consoleDefault, legacyPrefs: legacy)
    }
    return NotificationSettings.typeValue(catalog, settings, legacy: legacy, type: entry.type, channel)
  }

  /// A channel's switch as a compact toggle button that reads On or Off.
  private func channelToggle(_ channel: NotificationChannel, owner: String, isOn: Bool, onChange: @escaping (Bool) -> Void) -> some View {
    Toggle(isOn: Binding(get: { isOn }, set: onChange)) {
      Label(channel.label, systemImage: isOn ? "checkmark" : "xmark")
    }
    .toggleStyle(.button)
    .buttonStyle(.bordered)
    .tint(isOn ? AglynColor.tint : .secondary)
    .font(AglynFont.caption)
    .accessibilityLabel("\(channel.label) for \(catalog.entry(owner)?.label ?? catalog.categories.first { $0.id == owner }?.label ?? owner)")
    .accessibilityValue(isOn ? "On" : "Off")
    .accessibilityIdentifier("channel-\(owner)-\(channel.rawValue)")
  }

  // MARK: One workspace or one site

  @ViewBuilder
  private var scopeSection: some View {
    Section {
      Picker("Workspace or site", selection: $scopeKey) {
        Text("Your account (the answers above)").tag("account")
        ForEach(scopes, id: \.key) { Text($0.label).tag($0.key) }
      }
      .accessibilityIdentifier("notification-scope-picker")
      if let current = scopes.first(where: { $0.key == scopeKey }) {
        ForEach(catalog.categories) { category in
          DisclosureGroup {
            ForEach([NotificationChannel.console, .email]) { channel in
              triState(current.scope, key: category.id, types: false, channel, label: channel.label)
            }
            ForEach(category.types) { entry in
              Text(entry.label).font(AglynFont.strongSubheadline).padding(.top, AglynSpace.half)
              ForEach([NotificationChannel.console, .email]) { channel in
                triState(current.scope, key: entry.type, types: true, channel, label: channel.label)
              }
            }
          } label: {
            Text(category.label)
          }
        }
      } else {
        let changed = NotificationSettings.overriddenScopes(settings)
        let count = changed.orgIDs.count + changed.hostIDs.count
        Text(count > 0 ? "You have changed \(count) of these. Pick one to see what it says." : "You have not changed any of these yet.")
          .font(AglynFont.caption)
          .foregroundStyle(.secondary)
      }
    } header: {
      Text("One workspace or one site")
    } footer: {
      Text("Everything here starts at Inherit, which follows the answers above. A site follows its workspace, and a workspace follows your account.")
    }
  }

  private func triState(_ scope: NotificationScope, key: String, types: Bool, _ channel: NotificationChannel, label: String) -> some View {
    let pendingKey = answerKey(scope, key, types, channel)
    let stored =
      types
      ? NotificationSettings.scopeTypePref(settings, scope, type: key, channel)
      : NotificationSettings.scopePref(settings, scope, category: key, channel)
    let value: Bool? = pending.keys.contains(pendingKey) ? pending[pendingKey] ?? nil : stored
    return Picker(label, selection: Binding<Int>(
      get: { value == nil ? 0 : (value! ? 1 : 2) },
      set: { pick in
        let next: Bool? = pick == 0 ? nil : pick == 1
        write(pendingKey, next, NotificationSettings.answerWrite(settings, scope, key: key, types: types, channel, next))
      }
    )) {
      Text("Inherit").tag(0)
      Text("On").tag(1)
      Text("Off").tag(2)
    }
    .pickerStyle(.segmented)
    .accessibilityIdentifier("tri-\(key)-\(channel.rawValue)")
  }

  // MARK: Digests

  @ViewBuilder
  private var digestSection: some View {
    let prefsField = catalog.digestPrefsField ?? "digestPrefs"
    let insightsField = catalog.insightDigestsField ?? "insightDigests"
    let prefs = data[prefsField] as? [String: Any]
    let insights = data[insightsField] as? [String: Any]
    Section("Digests") {
      ForEach(catalog.digests ?? []) { digest in
        Toggle(isOn: Binding(
          get: { pendingValue("digest:\(digest.key)") ?? NotificationSettings.digestEnabled(prefs, key: digest.key) },
          set: { write("digest:\(digest.key)", $0, [prefsField: [digest.key: $0]]) }
        )) {
          VStack(alignment: .leading, spacing: 2) {
            Text(digest.label)
            Text(digest.description).font(AglynFont.caption).foregroundStyle(.secondary)
          }
        }
        .accessibilityIdentifier("digest-\(digest.key)")
      }
      let orgIDs = (insights ?? [:]).keys.sorted()
      if !orgIDs.isEmpty {
        Text("Weekly insights: each Monday, what your sites' figures showed that week, here and by email. Turned on from Ask about your numbers.")
          .font(AglynFont.caption)
          .foregroundStyle(.secondary)
        ForEach(orgIDs, id: \.self) { orgID in
          Toggle(
            model.workspace?.orgs.first { $0.id == orgID }?.name ?? "A workspace you left",
            isOn: Binding(
              get: { pendingValue("insight:\(orgID)") ?? NotificationSettings.insightSubscribed(insights, orgID: orgID) },
              set: { write("insight:\(orgID)", $0, [insightsField: [orgID: $0]]) }))
        }
      }
    }
  }

  // MARK: This device

  private var deviceSection: some View {
    Section("This device") {
      if model.push.authorization == .denied {
        Label("Notifications are turned off for \(model.brandName) in this device's settings.", systemImage: "bell.slash")
          .foregroundStyle(AglynColor.warning)
        #if os(iOS)
          Button("Open Settings") {
            if let url = URL(string: UIApplication.openNotificationSettingsURLString) { openURL(url) }
          }
        #endif
      } else {
        Text("Push reaches this device when its Push switch is on. The system's notification settings for \(model.brandName) can still silence it.")
          .font(AglynFont.caption)
          .foregroundStyle(.secondary)
      }
      Button("Send a test notification") { sendTest() }
        .accessibilityIdentifier("notification-test")
    }
  }

  /// A local notification, so the person sees how one looks and sounds here.
  private func sendTest() {
    let content = UNMutableNotificationContent()
    content.title = "\(model.brandName) notifications are on"
    content.body = "This is what a notification looks like."
    content.sound = .default
    let request = UNNotificationRequest(identifier: "aglyn-test", content: content, trigger: UNTimeIntervalNotificationTrigger(timeInterval: 1, repeats: false))
    Task {
      let center = UNUserNotificationCenter.current()
      _ = try? await center.requestAuthorization(options: [.alert, .sound, .badge])
      try? await center.add(request)
    }
  }

  // MARK: Reading and writing

  private func answerKey(_ scope: NotificationScope, _ key: String, _ types: Bool, _ channel: NotificationChannel) -> String {
    "\(scope)|\(types)|\(key)|\(channel.rawValue)"
  }

  private func pendingValue(_ key: String) -> Bool? {
    guard let entry = pending[key] else { return nil }
    return entry
  }

  private func start() {
    guard listener == nil, let uid = model.auth?.user?.uid, let reader = model.reader else { return }
    listener = reader.listenDocument(["users", uid]) { result in
      switch result {
      case .success(let document):
        profile = document
        loaded = true
        failed = false
        pending = [:]
      case .failure:
        failed = true
      }
    }
    // Every site the person holds, across workspaces: this page is not scoped to one.
    siteListener = reader.listen(FirestoreQuery(["users", uid, "hostMemberships"], limit: 100)) { result in
      if case .success(let docs) = result {
        sites = docs.map { (id: $0.id, name: $0.string("displayName") ?? $0.string("subdomain") ?? $0.id) }
      }
    }
  }

  private func write(_ key: String, _ value: Bool?, _ fields: [String: Any]) {
    guard let uid = model.auth?.user?.uid, let reader = model.reader else { return }
    pending[key] = .some(value)
    saveFailed = false
    Task {
      do {
        // Nested maps, never dotted paths: a type id has a dot of its own.
        try await reader.setDocument(["users", uid], fields, merge: true)
      } catch {
        pending[key] = nil
        saveFailed = true
      }
    }
  }
}
