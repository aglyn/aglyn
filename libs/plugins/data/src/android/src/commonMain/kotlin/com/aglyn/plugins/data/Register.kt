package com.aglyn.plugins.data

import com.aglyn.pluginhost.NativePluginRegistrar
import com.aglyn.pluginhost.ScreenLayout

/**
 * The Data plugin's native registration: the same ids its
 * `mobile.contributes` declares in plugins.config.json. The workspace's
 * datasets (the console's `/data` and `/{org}/data`), a dataset's records,
 * and its schema; a quick action opens the datasets.
 */
fun registerDataNative(r: NativePluginRegistrar) {
  r.screen(DATA_DATASETS_SCREEN, title = "Data", icon = "dataset", layout = ScreenLayout.LIST_DETAIL) { context, params ->
    DatasetsScreen(context, initialDatasetId = params["dataset"] ?: params["datasetId"])
  }
  r.screen(DATA_RECORDS_SCREEN, title = "Records", icon = "table_chart", layout = ScreenLayout.LIST_DETAIL) { context, params ->
    val datasetId = params["dataset"] ?: params["datasetId"]
    if (datasetId == null) DatasetsScreen(context) else RecordsScreen(context, datasetId, initialRecordId = params["record"], startNew = params["new"] == "1")
  }
  r.screen(DATA_SCHEMA_SCREEN, title = "Schema", icon = "table_chart") { context, params ->
    val datasetId = params["dataset"] ?: params["datasetId"]
    if (datasetId == null) DatasetsScreen(context) else SchemaScreen(context, datasetId)
  }
  r.quickAction("data.open", title = "Data", icon = "dataset", order = 40, screen = DATA_DATASETS_SCREEN)
  // `/data` on a site and `/{org}/data` for the workspace both end here: datasets belong to the workspace.
  r.deepLink("data.page", path = "/data", screen = DATA_DATASETS_SCREEN)
}
