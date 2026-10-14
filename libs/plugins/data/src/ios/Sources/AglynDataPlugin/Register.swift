// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynPluginHost
import SwiftUI

/// The Data plugin's native registration: the same ids its
/// `mobile.contributes` declares in plugins.config.json (the Kotlin registrar
/// names the same ones). The workspace's datasets (the console's `/data` and
/// `/{org}/data`), a dataset's records, and its schema; a quick action opens
/// the datasets.
@MainActor
public func registerDataNative(_ r: NativePluginRegistrar) {
  r.screen(dataDatasetsScreen, title: "Data", icon: DataSymbols.dataset) { context, params in
    DatasetsScreen(context: context, initialDatasetID: params["dataset"] ?? params["datasetId"])
  }
  r.screen(dataRecordsScreen, title: "Records", icon: DataSymbols.records) { context, params in
    if let datasetID = params["dataset"] ?? params["datasetId"] {
      RecordsScreen(context: context, datasetID: datasetID, initialRecordID: params["record"], startNew: params["new"] == "1")
    } else {
      DatasetsScreen(context: context)
    }
  }
  r.screen(dataSchemaScreen, title: "Schema", icon: DataSymbols.records) { context, params in
    if let datasetID = params["dataset"] ?? params["datasetId"] {
      SchemaScreen(context: context, datasetID: datasetID)
    } else {
      DatasetsScreen(context: context)
    }
  }
  r.quickAction("data.open", title: "Data", icon: DataSymbols.dataset, order: 40, screen: dataDatasetsScreen)
  // `/data` on a site and `/{org}/data` for the workspace both end here: datasets belong to the workspace.
  r.deepLink("data.page", path: "/data", screen: dataDatasetsScreen)
}
