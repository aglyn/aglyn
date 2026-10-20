package com.aglyn.ui

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Article
import androidx.compose.material.icons.automirrored.outlined.Reply
import androidx.compose.material.icons.automirrored.outlined.ViewList
import androidx.compose.material.icons.automirrored.outlined.ViewQuilt
import androidx.compose.material.icons.filled.CheckBox
import androidx.compose.material.icons.filled.Folder as FilledFolder
import androidx.compose.material.icons.outlined.Analytics
import androidx.compose.material.icons.outlined.Audiotrack
import androidx.compose.material.icons.outlined.CheckBoxOutlineBlank
import androidx.compose.material.icons.outlined.CreateNewFolder
import androidx.compose.material.icons.outlined.FolderZip
import androidx.compose.material.icons.outlined.LabelOff
import androidx.compose.material.icons.outlined.Movie
import androidx.compose.material.icons.outlined.Slideshow
import androidx.compose.material.icons.outlined.Archive
import androidx.compose.material.icons.outlined.Code
import androidx.compose.material.icons.outlined.ContentCopy
import androidx.compose.material.icons.outlined.DashboardCustomize
import androidx.compose.material.icons.outlined.DataObject
import androidx.compose.material.icons.outlined.Dataset
import androidx.compose.material.icons.outlined.DesignServices
import androidx.compose.material.icons.outlined.Download
import androidx.compose.material.icons.outlined.DriveFileMove
import androidx.compose.material.icons.outlined.DynamicForm
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.FilterList
import androidx.compose.material.icons.outlined.Folder
import androidx.compose.material.icons.outlined.FolderOpen
import androidx.compose.material.icons.outlined.FontDownload
import androidx.compose.material.icons.outlined.Functions
import androidx.compose.material.icons.outlined.Image
import androidx.compose.material.icons.outlined.InsertDriveFile
import androidx.compose.material.icons.outlined.Label
import androidx.compose.material.icons.outlined.Layers
import androidx.compose.material.icons.outlined.Link
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.LockOpen
import androidx.compose.material.icons.outlined.MarkEmailRead
import androidx.compose.material.icons.outlined.MarkEmailUnread
import androidx.compose.material.icons.outlined.Palette
import androidx.compose.material.icons.outlined.PictureAsPdf
import androidx.compose.material.icons.outlined.Sort
import androidx.compose.material.icons.outlined.Storage
import androidx.compose.material.icons.outlined.TableChart
import androidx.compose.material.icons.outlined.Title
import androidx.compose.material.icons.outlined.TravelExplore
import androidx.compose.material.icons.outlined.Unarchive
import androidx.compose.material.icons.outlined.Upload
import androidx.compose.material.icons.outlined.VideoLibrary
import androidx.compose.material.icons.outlined.ViewModule
import androidx.compose.material.icons.outlined.Visibility
import androidx.compose.material.icons.outlined.VisibilityOff
import androidx.compose.material.icons.outlined.Widgets
import androidx.compose.ui.graphics.vector.ImageVector

/**
 * The content areas' Material Symbols (sites, pages, media, setup, forms,
 * data; AGL-3668), beside the kit's own map in [AglynIcons].
 */
internal val CONTENT_ICONS: Map<String, ImageVector> = mapOf(
  "dynamic_form" to Icons.Outlined.DynamicForm,
  "folder" to Icons.Outlined.Folder,
  "folder_open" to Icons.Outlined.FolderOpen,
  // The media file browser (AGL-4004): a folder tile's filled folder, New folder, the file types' glyphs (the console's
  // mediaFileTypeIcon), untagging, and a tile's selection box.
  "folder_filled" to Icons.Filled.FilledFolder,
  "create_new_folder" to Icons.Outlined.CreateNewFolder,
  "folder_zip" to Icons.Outlined.FolderZip,
  "slideshow" to Icons.Outlined.Slideshow,
  "movie" to Icons.Outlined.Movie,
  "audiotrack" to Icons.Outlined.Audiotrack,
  "insert_drive_file" to Icons.Outlined.InsertDriveFile,
  "label_off" to Icons.Outlined.LabelOff,
  "check_box" to Icons.Filled.CheckBox,
  "check_box_outline_blank" to Icons.Outlined.CheckBoxOutlineBlank,
  "edit" to Icons.Outlined.Edit,
  "content_copy" to Icons.Outlined.ContentCopy,
  "drive_file_move" to Icons.Outlined.DriveFileMove,
  "visibility" to Icons.Outlined.Visibility,
  "visibility_off" to Icons.Outlined.VisibilityOff,
  "design_services" to Icons.Outlined.DesignServices,
  "image" to Icons.Outlined.Image,
  "upload" to Icons.Outlined.Upload,
  "download" to Icons.Outlined.Download,
  "link" to Icons.Outlined.Link,
  "palette" to Icons.Outlined.Palette,
  "lock" to Icons.Outlined.Lock,
  "lock_open" to Icons.Outlined.LockOpen,
  "label" to Icons.Outlined.Label,
  "sort" to Icons.Outlined.Sort,
  "filter_list" to Icons.Outlined.FilterList,
  "view_module" to Icons.Outlined.ViewModule,
  "view_list" to Icons.AutoMirrored.Outlined.ViewList,
  "video_library" to Icons.Outlined.VideoLibrary,
  "picture_as_pdf" to Icons.Outlined.PictureAsPdf,
  "draft" to Icons.Outlined.InsertDriveFile,
  "dataset" to Icons.Outlined.Dataset,
  "table_chart" to Icons.Outlined.TableChart,
  "view_quilt" to Icons.AutoMirrored.Outlined.ViewQuilt,
  "widgets" to Icons.Outlined.Widgets,
  "article" to Icons.AutoMirrored.Outlined.Article,
  "title" to Icons.Outlined.Title,
  "travel_explore" to Icons.Outlined.TravelExplore,
  "analytics" to Icons.Outlined.Analytics,
  "code" to Icons.Outlined.Code,
  "font_download" to Icons.Outlined.FontDownload,
  "storage" to Icons.Outlined.Storage,
  "layers" to Icons.Outlined.Layers,
  "dashboard_customize" to Icons.Outlined.DashboardCustomize,
  "functions" to Icons.Outlined.Functions,
  "data_object" to Icons.Outlined.DataObject,
  "mark_email_read" to Icons.Outlined.MarkEmailRead,
  "mark_email_unread" to Icons.Outlined.MarkEmailUnread,
  "archive" to Icons.Outlined.Archive,
  "unarchive" to Icons.Outlined.Unarchive,
  "reply" to Icons.AutoMirrored.Outlined.Reply,
)
