/**
 * @license
 * Copyright 2026 Aglyn LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import type { NodesMap } from '@aglyn/aglyn/types/nodes'

/**
 * TWO HOME PAGES OF THE 2026-10-25 BOOTH-KIT STARTS (AGL-4065), AS STORED.
 *
 * Rut Runners Racing (an amateur motocross team) and Pit Row Tacos (a taco
 * trailer), two fictional businesses built in the test workspace. Each page's
 * tree is read back from its stored version, its every photo taken out again
 * to the empty slot the compiler wrote (the `image` keeps its words, loses its
 * source and size), and its phone, email and street address put back as
 * placeholders. Each home has a band its plan named "… in
 * pictures" — "The team at the track in pictures", "The trailer and the food in
 * pictures" — drawn as six captions under a heading with no picture at all:
 * the compiler drew the group compact, and nothing took the band out.
 */

/** Rut Runners Racing's home page as the start stored it, its photos taken back out to the slots the compiler wrote. */
export const RUT_RUNNERS_HOME: NodesMap = {
  "_@_": {"$id":"_@_","type":"node","componentId":"div","pluginId":"mui","parentId":null,"nodes":["ai-LpjPaYgvkh-section-1","ai-LpjPaYgvkh-section-2","ai-LpjPaYgvkh-section-3","ai-LpjPaYgvkh-section-4","ai-LpjPaYgvkh-section-5","ai-LpjPaYgvkh-section-6","ai-LpjPaYgvkh-section-7"],"props":{}},
  "ai-LpjPaYgvkh-section-1": {"$id":"ai-LpjPaYgvkh-section-1","type":"node","componentId":"section","pluginId":"mui","parentId":"_@_","nodes":["4AhKOt_1zN"],"props":{"element":"section","ariaLabel":"Hero: built in Lockhart, raced across Texas"}},
  "ai-LpjPaYgvkh-section-2": {"$id":"ai-LpjPaYgvkh-section-2","type":"node","componentId":"section","pluginId":"mui","parentId":"_@_","nodes":["E7rGWq6a2k"],"props":{"element":"section","ariaLabel":"How to get started with the team"},"sx":{"bgcolor":"background.paper"}},
  "ai-LpjPaYgvkh-section-3": {"$id":"ai-LpjPaYgvkh-section-3","type":"node","componentId":"section","pluginId":"mui","parentId":"_@_","nodes":["9S6iMzlDC9"],"props":{"element":"section","ariaLabel":"Riders and programs"}},
  "ai-LpjPaYgvkh-section-4": {"$id":"ai-LpjPaYgvkh-section-4","type":"node","componentId":"section","pluginId":"mui","parentId":"_@_","nodes":["pcrQZd4tg9"],"props":{"element":"section","ariaLabel":"The team at the track in pictures","colorScheme":"dark"}},
  "ai-LpjPaYgvkh-section-5": {"$id":"ai-LpjPaYgvkh-section-5","type":"node","componentId":"section","pluginId":"mui","parentId":"_@_","nodes":["hqu9pS-NRs"],"props":{"element":"section","ariaLabel":"Next races"}},
  "ai-LpjPaYgvkh-section-6": {"$id":"ai-LpjPaYgvkh-section-6","type":"node","componentId":"section","pluginId":"mui","parentId":"_@_","nodes":["pk5iSRhXgP"],"props":{"element":"section","ariaLabel":"Questions people ask, answered"},"sx":{"bgcolor":"background.paper"}},
  "ai-LpjPaYgvkh-section-7": {"$id":"ai-LpjPaYgvkh-section-7","type":"node","componentId":"section","pluginId":"mui","parentId":"_@_","nodes":["YfCUZYumUR"],"props":{"element":"section","ariaLabel":"Call to action: sponsor or join"},"sx":{"bgcolor":"primary.main","color":"primary.contrastText"}},
  "4AhKOt_1zN": {"$id":"4AhKOt_1zN","type":"node","componentId":"muiGrid","pluginId":"mui","parentId":"ai-LpjPaYgvkh-section-1","nodes":["QLCVcM2Hy2","mHywgulC8N"],"props":{"container":true,"spacing":"0"},"sx":{"alignItems":"stretch"}},
  "E7rGWq6a2k": {"$id":"E7rGWq6a2k","type":"node","componentId":"muiContainer","pluginId":"mui","parentId":"ai-LpjPaYgvkh-section-2","nodes":["Ncus3-QqCA"],"props":{"maxWidth":"lg"},"sx":{"py":{"xs":8,"md":12}}},
  "9S6iMzlDC9": {"$id":"9S6iMzlDC9","type":"node","componentId":"muiContainer","pluginId":"mui","parentId":"ai-LpjPaYgvkh-section-3","nodes":["f7MAe2WUyJ"],"props":{"maxWidth":"lg"},"sx":{"py":{"xs":8,"md":12}}},
  "pcrQZd4tg9": {"$id":"pcrQZd4tg9","type":"node","componentId":"muiContainer","pluginId":"mui","parentId":"ai-LpjPaYgvkh-section-4","nodes":["kA5EyRUJKe"],"props":{"maxWidth":"lg"},"sx":{"py":{"xs":8,"md":12}}},
  "hqu9pS-NRs": {"$id":"hqu9pS-NRs","type":"node","componentId":"muiContainer","pluginId":"mui","parentId":"ai-LpjPaYgvkh-section-5","nodes":["zKnagWYAom"],"props":{"maxWidth":"lg"},"sx":{"py":{"xs":8,"md":12}}},
  "pk5iSRhXgP": {"$id":"pk5iSRhXgP","type":"node","componentId":"muiContainer","pluginId":"mui","parentId":"ai-LpjPaYgvkh-section-6","nodes":["fFqOxnyVY-"],"props":{"maxWidth":"md"},"sx":{"py":{"xs":8,"md":12}}},
  "YfCUZYumUR": {"$id":"YfCUZYumUR","type":"node","componentId":"muiContainer","pluginId":"mui","parentId":"ai-LpjPaYgvkh-section-7","nodes":["UjOtqZJ7ct"],"props":{"maxWidth":"md"},"sx":{"py":{"xs":8,"md":12}}},
  "QLCVcM2Hy2": {"$id":"QLCVcM2Hy2","type":"node","componentId":"muiGrid","pluginId":"mui","parentId":"4AhKOt_1zN","nodes":["x1UkrBZ2fd"],"props":{"size":"xs:12 md:6"}},
  "mHywgulC8N": {"$id":"mHywgulC8N","type":"node","componentId":"muiGrid","pluginId":"mui","parentId":"4AhKOt_1zN","nodes":["pU5zaoY9z6"],"props":{"size":"xs:12 md:6"},"sx":{"display":"flex","alignItems":"center","justifyContent":"flex-start"}},
  "Ncus3-QqCA": {"$id":"Ncus3-QqCA","type":"node","componentId":"muiStack","pluginId":"mui","parentId":"E7rGWq6a2k","nodes":["iWi0vXr3Rv","Ho9I6-p5V0"],"props":{"spacing":"4"}},
  "f7MAe2WUyJ": {"$id":"f7MAe2WUyJ","type":"node","componentId":"muiStack","pluginId":"mui","parentId":"9S6iMzlDC9","nodes":["0dc62XHlVT","JmqWgHSPlv"],"props":{"spacing":"6","useFlexGap":true}},
  "kA5EyRUJKe": {"$id":"kA5EyRUJKe","type":"node","componentId":"muiStack","pluginId":"mui","parentId":"pcrQZd4tg9","nodes":["073ic9zXGf","uQY-QU7lv8"],"props":{"spacing":"4"}},
  "zKnagWYAom": {"$id":"zKnagWYAom","type":"node","componentId":"muiStack","pluginId":"mui","parentId":"hqu9pS-NRs","nodes":["FyDyWHcdo7","flGDPc5fSz"],"props":{"spacing":"6","useFlexGap":true}},
  "fFqOxnyVY-": {"$id":"fFqOxnyVY-","type":"node","componentId":"muiStack","pluginId":"mui","parentId":"pk5iSRhXgP","nodes":["jPeHaXb8o8","ef8qbNuA4a"],"props":{"spacing":"4"}},
  "UjOtqZJ7ct": {"$id":"UjOtqZJ7ct","type":"node","componentId":"muiStack","pluginId":"mui","parentId":"YfCUZYumUR","nodes":["gcVkZFsLhr","BGlmeDWjxh","ddKwsu6i8W"],"props":{"spacing":"2.5","alignItems":"center","aglynAnimation":"slide-up","aglynAnimationTrigger":"scroll","aglynAnimationDuration":560,"aglynAnimationEase":"smooth"}},
  "x1UkrBZ2fd": {"$id":"x1UkrBZ2fd","type":"node","componentId":"muiBox","pluginId":"mui","parentId":"QLCVcM2Hy2","nodes":["I6PPFFymhi"],"props":{},"sx":{"position":"relative","overflow":"hidden","bgcolor":"action.hover","height":"100%","minHeight":{"xs":"46vh","md":"84vh"}}},
  "pU5zaoY9z6": {"$id":"pU5zaoY9z6","type":"node","componentId":"muiBox","pluginId":"mui","parentId":"mHywgulC8N","nodes":["9F55TQ6W4t"],"props":{},"sx":{"maxWidth":{"xs":"100%","md":"88%"},"px":{"xs":3,"sm":6,"md":8},"py":{"xs":6,"md":10}}},
  "iWi0vXr3Rv": {"$id":"iWi0vXr3Rv","type":"node","componentId":"muiTypography","pluginId":"mui","parentId":"Ncus3-QqCA","nodes":[],"props":{"children":"How to get started with the team","variant":"h2","component":"h2","aglynAnimation":"fade","aglynAnimationTrigger":"scroll","aglynAnimationDuration":560,"aglynAnimationEase":"smooth"}},
  "Ho9I6-p5V0": {"$id":"Ho9I6-p5V0","type":"node","componentId":"muiGrid","pluginId":"mui","parentId":"Ncus3-QqCA","nodes":["6P7031bB_T","OENbAYHu4L","zUWrCyRuHh","lCOgu79SSA"],"props":{"container":true,"spacing":"3","aglynAnimation":"zoom-in","aglynAnimationTrigger":"scroll","aglynAnimationDuration":560,"aglynAnimationEase":"smooth","aglynAnimationStagger":true,"aglynAnimationStaggerStep":105}},
  "0dc62XHlVT": {"$id":"0dc62XHlVT","type":"node","componentId":"muiGrid","pluginId":"mui","parentId":"f7MAe2WUyJ","nodes":["7u7ifzeENB","t1J5Xk-c4B"],"props":{"container":true,"spacing":"3","aglynAnimation":"zoom-in","aglynAnimationTrigger":"scroll","aglynAnimationDuration":560,"aglynAnimationEase":"smooth","aglynAnimationStagger":true,"aglynAnimationStaggerStep":105},"sx":{"alignItems":"flex-end"}},
  "JmqWgHSPlv": {"$id":"JmqWgHSPlv","type":"node","componentId":"muiBox","pluginId":"mui","parentId":"f7MAe2WUyJ","nodes":["1LMvQIy_EP"],"props":{"repeatLimit":"3","repeatDataset":"9aqOeHwLiL","aglynAnimation":"zoom-in","aglynAnimationTrigger":"scroll","aglynAnimationDuration":560,"aglynAnimationEase":"smooth","aglynAnimationStagger":true,"aglynAnimationStaggerStep":105},"sx":{"display":"grid","gridTemplateColumns":{"xs":"1fr","md":"repeat(3, 1fr)"},"gap":5}},
  "073ic9zXGf": {"$id":"073ic9zXGf","type":"node","componentId":"muiTypography","pluginId":"mui","parentId":"kA5EyRUJKe","nodes":[],"props":{"children":"The team at the track in pictures","variant":"h2","component":"h2","aglynAnimation":"fade","aglynAnimationTrigger":"scroll","aglynAnimationDuration":560,"aglynAnimationEase":"smooth"}},
  "uQY-QU7lv8": {"$id":"uQY-QU7lv8","type":"node","componentId":"muiGrid","pluginId":"mui","parentId":"kA5EyRUJKe","nodes":["_XiQ4eRxTA","BfHtZS_9Ug","kGTWH5lyn1","atbbM0qf__","h6gd-MGUuc","RctbIlzdGd"],"props":{"container":true,"spacing":"3","aglynAnimation":"zoom-in","aglynAnimationTrigger":"scroll","aglynAnimationDuration":560,"aglynAnimationEase":"smooth","aglynAnimationStagger":true,"aglynAnimationStaggerStep":105}},
  "FyDyWHcdo7": {"$id":"FyDyWHcdo7","type":"node","componentId":"muiGrid","pluginId":"mui","parentId":"zKnagWYAom","nodes":["jrcqmoTuBG","sMZ5pQ9GeT"],"props":{"container":true,"spacing":"3","aglynAnimation":"zoom-in","aglynAnimationTrigger":"scroll","aglynAnimationDuration":560,"aglynAnimationEase":"smooth","aglynAnimationStagger":true,"aglynAnimationStaggerStep":105},"sx":{"alignItems":"flex-end"}},
  "flGDPc5fSz": {"$id":"flGDPc5fSz","type":"node","componentId":"muiBox","pluginId":"mui","parentId":"zKnagWYAom","nodes":["umpjcLUcs6"],"props":{"repeatLimit":"3","repeatDataset":"Suc17uVu5z","aglynAnimation":"slide-up","aglynAnimationTrigger":"scroll","aglynAnimationDuration":560,"aglynAnimationDelay":105,"aglynAnimationEase":"smooth","aglynAnimationStagger":true,"aglynAnimationStaggerStep":105},"sx":{"display":"grid","gridTemplateColumns":{"xs":"1fr","md":"repeat(3, 1fr)"},"gap":5}},
  "jPeHaXb8o8": {"$id":"jPeHaXb8o8","type":"node","componentId":"muiTypography","pluginId":"mui","parentId":"fFqOxnyVY-","nodes":[],"props":{"children":"Questions people ask, answered","variant":"h2","component":"h2","aglynAnimation":"fade","aglynAnimationTrigger":"scroll","aglynAnimationDuration":560,"aglynAnimationEase":"smooth"}},
  "ef8qbNuA4a": {"$id":"ef8qbNuA4a","type":"node","componentId":"muiList","pluginId":"mui","parentId":"fFqOxnyVY-","nodes":["5YgFqehJCd","D874uTSlWR","-0BPVWRJH9","gFyJBMmzUY","uUYX5nNM4U"],"props":{"disablePadding":true,"aglynAnimation":"zoom-in","aglynAnimationTrigger":"scroll","aglynAnimationDuration":560,"aglynAnimationEase":"smooth","aglynAnimationStagger":true,"aglynAnimationStaggerStep":105}},
  "gcVkZFsLhr": {"$id":"gcVkZFsLhr","type":"node","componentId":"muiTypography","pluginId":"mui","parentId":"UjOtqZJ7ct","nodes":[],"props":{"children":"Sponsor a rider or join the team","variant":"h2","component":"h2","align":"center"}},
  "BGlmeDWjxh": {"$id":"BGlmeDWjxh","type":"node","componentId":"muiTypography","pluginId":"mui","parentId":"UjOtqZJ7ct","nodes":[],"props":{"children":"Back local riders or get your own number plate.","variant":"lede","align":"center"}},
  "ddKwsu6i8W": {"$id":"ddKwsu6i8W","type":"node","componentId":"muiStack","pluginId":"mui","parentId":"UjOtqZJ7ct","nodes":["DQvO10Xb48","K_RUs1f11Y"],"props":{"direction":"row","spacing":"2","useFlexGap":true,"flexWrap":"wrap","justifyContent":"center"}},
  "I6PPFFymhi": {"$id":"I6PPFFymhi","type":"node","componentId":"image","pluginId":"mui","parentId":"x1UkrBZ2fd","nodes":[],"props":{"alt":"A race car and a motorsport","objectFit":"cover","width":"100%","height":"100%"}},
  "9F55TQ6W4t": {"$id":"9F55TQ6W4t","type":"node","componentId":"muiStack","pluginId":"mui","parentId":"pU5zaoY9z6","nodes":["9FS0Xkb0gw","KlB0NXyBAe","Zp2_SvLrdZ","V73tNBmmFa"],"props":{"spacing":"2.5"}},
  "6P7031bB_T": {"$id":"6P7031bB_T","type":"node","componentId":"muiGrid","pluginId":"mui","parentId":"Ho9I6-p5V0","nodes":["PXYSzGyCqO"],"props":{"size":"xs:12 sm:6 md:3"}},
  "OENbAYHu4L": {"$id":"OENbAYHu4L","type":"node","componentId":"muiGrid","pluginId":"mui","parentId":"Ho9I6-p5V0","nodes":["KgM9lVRzMa"],"props":{"size":"xs:12 sm:6 md:3"}},
  "zUWrCyRuHh": {"$id":"zUWrCyRuHh","type":"node","componentId":"muiGrid","pluginId":"mui","parentId":"Ho9I6-p5V0","nodes":["yiwvKVOd4S"],"props":{"size":"xs:12 sm:6 md:3"}},
  "lCOgu79SSA": {"$id":"lCOgu79SSA","type":"node","componentId":"muiGrid","pluginId":"mui","parentId":"Ho9I6-p5V0","nodes":["T7rV41X5iD"],"props":{"size":"xs:12 sm:6 md:3"}},
  "7u7ifzeENB": {"$id":"7u7ifzeENB","type":"node","componentId":"muiGrid","pluginId":"mui","parentId":"0dc62XHlVT","nodes":["5k0fr7hrvd"],"props":{"size":"xs:12 md:8"}},
  "t1J5Xk-c4B": {"$id":"t1J5Xk-c4B","type":"node","componentId":"muiGrid","pluginId":"mui","parentId":"0dc62XHlVT","nodes":["8EdmQJL_te"],"props":{"size":"xs:12 md:4"},"sx":{"display":"flex","justifyContent":{"xs":"flex-start","md":"flex-end"}}},
  "1LMvQIy_EP": {"$id":"1LMvQIy_EP","type":"node","componentId":"muiStack","pluginId":"mui","parentId":"JmqWgHSPlv","nodes":["CCQa3OKxmZ","CFUxQ2jEBs"],"props":{"spacing":"1"}},
  "_XiQ4eRxTA": {"$id":"_XiQ4eRxTA","type":"node","componentId":"muiGrid","pluginId":"mui","parentId":"uQY-QU7lv8","nodes":["_YCvKjLLeW"],"props":{"size":"xs:12 md:4"}},
  "BfHtZS_9Ug": {"$id":"BfHtZS_9Ug","type":"node","componentId":"muiGrid","pluginId":"mui","parentId":"uQY-QU7lv8","nodes":["BY_6SpbQ_a"],"props":{"size":"xs:12 md:4"}},
  "kGTWH5lyn1": {"$id":"kGTWH5lyn1","type":"node","componentId":"muiGrid","pluginId":"mui","parentId":"uQY-QU7lv8","nodes":["YqEykE6Yi4"],"props":{"size":"xs:12 md:4"}},
  "atbbM0qf__": {"$id":"atbbM0qf__","type":"node","componentId":"muiGrid","pluginId":"mui","parentId":"uQY-QU7lv8","nodes":["t4rxB-7hbN"],"props":{"size":"xs:12 md:4"}},
  "h6gd-MGUuc": {"$id":"h6gd-MGUuc","type":"node","componentId":"muiGrid","pluginId":"mui","parentId":"uQY-QU7lv8","nodes":["uSNXuAtc2t"],"props":{"size":"xs:12 md:4"}},
  "RctbIlzdGd": {"$id":"RctbIlzdGd","type":"node","componentId":"muiGrid","pluginId":"mui","parentId":"uQY-QU7lv8","nodes":["TZkHFSor4_"],"props":{"size":"xs:12 md:4"}},
  "jrcqmoTuBG": {"$id":"jrcqmoTuBG","type":"node","componentId":"muiGrid","pluginId":"mui","parentId":"FyDyWHcdo7","nodes":["yuLAnC5gPK"],"props":{"size":"xs:12 md:8"}},
  "sMZ5pQ9GeT": {"$id":"sMZ5pQ9GeT","type":"node","componentId":"muiGrid","pluginId":"mui","parentId":"FyDyWHcdo7","nodes":["UKp7Uszzjs"],"props":{"size":"xs:12 md:4"},"sx":{"display":"flex","justifyContent":{"xs":"flex-start","md":"flex-end"}}},
  "umpjcLUcs6": {"$id":"umpjcLUcs6","type":"node","componentId":"muiStack","pluginId":"mui","parentId":"flGDPc5fSz","nodes":["ie02T9FvoE","KJhox2-r0x","mA-X3OawwD"],"props":{"spacing":"1.5"}},
  "5YgFqehJCd": {"$id":"5YgFqehJCd","type":"node","componentId":"muiListItem","pluginId":"mui","parentId":"ef8qbNuA4a","nodes":["akmx9Fu092"],"props":{"disableGutters":true,"divider":true}},
  "D874uTSlWR": {"$id":"D874uTSlWR","type":"node","componentId":"muiListItem","pluginId":"mui","parentId":"ef8qbNuA4a","nodes":["6DsKd4Tx7Q"],"props":{"disableGutters":true,"divider":true}},
  "-0BPVWRJH9": {"$id":"-0BPVWRJH9","type":"node","componentId":"muiListItem","pluginId":"mui","parentId":"ef8qbNuA4a","nodes":["Jy5vt4ujWZ"],"props":{"disableGutters":true,"divider":true}},
  "gFyJBMmzUY": {"$id":"gFyJBMmzUY","type":"node","componentId":"muiListItem","pluginId":"mui","parentId":"ef8qbNuA4a","nodes":["v6YzRo7cdU"],"props":{"disableGutters":true,"divider":true}},
  "uUYX5nNM4U": {"$id":"uUYX5nNM4U","type":"node","componentId":"muiListItem","pluginId":"mui","parentId":"ef8qbNuA4a","nodes":["_x_3AU4o1J"],"props":{"disableGutters":true,"divider":true}},
  "DQvO10Xb48": {"$id":"DQvO10Xb48","type":"node","componentId":"muiButton","pluginId":"mui","parentId":"ddKwsu6i8W","nodes":[],"props":{"children":"Get in touch","variant":"contained","color":"secondary","size":"medium","screenId":"-u1uZKCfXb"},"sx":{"alignSelf":"center"}},
  "K_RUs1f11Y": {"$id":"K_RUs1f11Y","type":"node","componentId":"muiButton","pluginId":"mui","parentId":"ddKwsu6i8W","nodes":[],"props":{"children":"Call [phone]","variant":"outlined","color":"inherit","size":"medium","href":"tel:[phone]"},"sx":{"alignSelf":"center"}},
  "9FS0Xkb0gw": {"$id":"9FS0Xkb0gw","type":"node","componentId":"muiTypography","pluginId":"mui","parentId":"9F55TQ6W4t","nodes":[],"props":{"children":"Rut Runners Racing · Lockhart, TX","variant":"overline","component":"p","aglynAnimation":"slide-up","aglynAnimationTrigger":"load","aglynAnimationDuration":560,"aglynAnimationEase":"smooth"},"sx":{"color":"primary.main"}},
  "KlB0NXyBAe": {"$id":"KlB0NXyBAe","type":"node","componentId":"muiTypography","pluginId":"mui","parentId":"9F55TQ6W4t","nodes":[],"props":{"children":"Built in Lockhart, raced across Texas","variant":"h1","component":"h1"}},
  "Zp2_SvLrdZ": {"$id":"Zp2_SvLrdZ","type":"node","componentId":"muiTypography","pluginId":"mui","parentId":"9F55TQ6W4t","nodes":[],"props":{"children":"Amateur motocross since 2019. Ride with us, sponsor a rider or cheer from the fence.","variant":"lede","aglynAnimation":"slide-up","aglynAnimationTrigger":"load","aglynAnimationDuration":560,"aglynAnimationDelay":115,"aglynAnimationEase":"smooth"},"sx":{"color":"text.secondary"}},
  "V73tNBmmFa": {"$id":"V73tNBmmFa","type":"node","componentId":"muiStack","pluginId":"mui","parentId":"9F55TQ6W4t","nodes":["zdP9w9VLJr","L47jYd5j6S"],"props":{"direction":"row","spacing":"2","useFlexGap":true,"flexWrap":"wrap"}},
  "PXYSzGyCqO": {"$id":"PXYSzGyCqO","type":"node","componentId":"muiListItemText","pluginId":"mui","parentId":"6P7031bB_T","nodes":[],"props":{"primary":"1. Say hello","secondary":"Tell us who you are and what you ride, or want to ride."}},
  "KgM9lVRzMa": {"$id":"KgM9lVRzMa","type":"node","componentId":"muiListItemText","pluginId":"mui","parentId":"OENbAYHu4L","nodes":[],"props":{"primary":"2. Meet the team","secondary":"Come to the track and see how we train and race."}},
  "yiwvKVOd4S": {"$id":"yiwvKVOd4S","type":"node","componentId":"muiListItemText","pluginId":"mui","parentId":"zUWrCyRuHh","nodes":[],"props":{"primary":"3. Find your class","secondary":"We match each rider to an age class and skill level."}},
  "T7rV41X5iD": {"$id":"T7rV41X5iD","type":"node","componentId":"muiListItemText","pluginId":"mui","parentId":"lCOgu79SSA","nodes":[],"props":{"primary":"4. Hit the track","secondary":"Train with the crew and line up at your first race."}},
  "5k0fr7hrvd": {"$id":"5k0fr7hrvd","type":"node","componentId":"muiStack","pluginId":"mui","parentId":"7u7ifzeENB","nodes":["JXCwJvbe5S","5doQLxlQKo"],"props":{"spacing":"2.5"}},
  "8EdmQJL_te": {"$id":"8EdmQJL_te","type":"node","componentId":"muiButton","pluginId":"mui","parentId":"t1J5Xk-c4B","nodes":[],"props":{"children":"See all","variant":"outlined","color":"primary","size":"medium","screenId":"naawt5-QHO"},"sx":{"alignSelf":"flex-start"}},
  "CCQa3OKxmZ": {"$id":"CCQa3OKxmZ","type":"node","componentId":"muiTypography","pluginId":"mui","parentId":"1LMvQIy_EP","nodes":[],"props":{"children":"{{item.name}}","variant":"h5","component":"h3"}},
  "CFUxQ2jEBs": {"$id":"CFUxQ2jEBs","type":"node","componentId":"muiTypography","pluginId":"mui","parentId":"1LMvQIy_EP","nodes":[],"props":{"children":"{{item.bio}}","variant":"body2"},"sx":{"color":"text.secondary"}},
  "_YCvKjLLeW": {"$id":"_YCvKjLLeW","type":"node","componentId":"muiListItemText","pluginId":"mui","parentId":"_XiQ4eRxTA","nodes":[],"props":{"primary":"Gate drop","secondary":"Riders staged and ready for the start."}},
  "BY_6SpbQ_a": {"$id":"BY_6SpbQ_a","type":"node","componentId":"muiListItemText","pluginId":"mui","parentId":"BfHtZS_9Ug","nodes":[],"props":{"primary":"Pit crew","secondary":"Families and friends wrenching together."}},
  "YqEykE6Yi4": {"$id":"YqEykE6Yi4","type":"node","componentId":"muiListItemText","pluginId":"mui","parentId":"kGTWH5lyn1","nodes":[],"props":{"primary":"Practice laps","secondary":"Working the ruts before race day."}},
  "t4rxB-7hbN": {"$id":"t4rxB-7hbN","type":"node","componentId":"muiListItemText","pluginId":"mui","parentId":"atbbM0qf__","nodes":[],"props":{"primary":"Podium moments","secondary":"Celebrating after a hard-fought moto."}},
  "uSNXuAtc2t": {"$id":"uSNXuAtc2t","type":"node","componentId":"muiListItemText","pluginId":"mui","parentId":"h6gd-MGUuc","nodes":[],"props":{"primary":"Young riders","secondary":"Our minis learning the basics."}},
  "TZkHFSor4_": {"$id":"TZkHFSor4_","type":"node","componentId":"muiListItemText","pluginId":"mui","parentId":"RctbIlzdGd","nodes":[],"props":{"primary":"Team spirit","secondary":"Rut Runners Racing on and off the bike."}},
  "yuLAnC5gPK": {"$id":"yuLAnC5gPK","type":"node","componentId":"muiStack","pluginId":"mui","parentId":"jrcqmoTuBG","nodes":["1_gW_5QuC9","s0PPuPw7vo"],"props":{"spacing":"2.5"}},
  "UKp7Uszzjs": {"$id":"UKp7Uszzjs","type":"node","componentId":"muiButton","pluginId":"mui","parentId":"sMZ5pQ9GeT","nodes":[],"props":{"children":"Full schedule and results","variant":"outlined","color":"primary","size":"medium","screenId":"GkTHiM0a0H"},"sx":{"alignSelf":"flex-start"}},
  "ie02T9FvoE": {"$id":"ie02T9FvoE","type":"node","componentId":"image","pluginId":"mui","parentId":"umpjcLUcs6","nodes":[],"props":{"alt":"{{item.image_description}}","objectFit":"cover","width":"100%","loading":"lazy","src":"{{item.image}}"},"sx":{"aspectRatio":"4 / 3","borderRadius":2}},
  "KJhox2-r0x": {"$id":"KJhox2-r0x","type":"node","componentId":"muiTypography","pluginId":"mui","parentId":"umpjcLUcs6","nodes":[],"props":{"children":"{{item.event}}","variant":"h5","component":"h3"}},
  "mA-X3OawwD": {"$id":"mA-X3OawwD","type":"node","componentId":"muiTypography","pluginId":"mui","parentId":"umpjcLUcs6","nodes":[],"props":{"children":"{{item.status}}","variant":"body2"},"sx":{"color":"text.secondary"}},
  "akmx9Fu092": {"$id":"akmx9Fu092","type":"node","componentId":"muiListItemText","pluginId":"mui","parentId":"5YgFqehJCd","nodes":[],"props":{"primary":"Who can join?","secondary":"Young riders of all ages and levels who want to race with a team."}},
  "6DsKd4Tx7Q": {"$id":"6DsKd4Tx7Q","type":"node","componentId":"muiListItemText","pluginId":"mui","parentId":"D874uTSlWR","nodes":[],"props":{"primary":"How do I sponsor a rider?","secondary":"Send us an inquiry and we will talk through options with you."}},
  "Jy5vt4ujWZ": {"$id":"Jy5vt4ujWZ","type":"node","componentId":"muiListItemText","pluginId":"mui","parentId":"-0BPVWRJH9","nodes":[],"props":{"primary":"Where do you race?","secondary":"Across Central Texas, including Lockhart, Luling, San Marcos and Austin."}},
  "v6YzRo7cdU": {"$id":"v6YzRo7cdU","type":"node","componentId":"muiListItemText","pluginId":"mui","parentId":"gFyJBMmzUY","nodes":[],"props":{"primary":"Do you speak Spanish?","secondary":"Yes, we work in English and Spanish."}},
  "_x_3AU4o1J": {"$id":"_x_3AU4o1J","type":"node","componentId":"muiListItemText","pluginId":"mui","parentId":"uUYX5nNM4U","nodes":[],"props":{"primary":"How do I reach you?","secondary":"Call [phone] or email [email]."}},
  "zdP9w9VLJr": {"$id":"zdP9w9VLJr","type":"node","componentId":"muiButton","pluginId":"mui","parentId":"V73tNBmmFa","nodes":[],"props":{"children":"Join the team","variant":"contained","color":"primary","size":"large","screenId":"-u1uZKCfXb","aglynAnimation":"slide-up","aglynAnimationTrigger":"load","aglynAnimationDuration":560,"aglynAnimationDelay":230,"aglynAnimationEase":"smooth"},"sx":{"alignSelf":"flex-start"}},
  "L47jYd5j6S": {"$id":"L47jYd5j6S","type":"node","componentId":"muiButton","pluginId":"mui","parentId":"V73tNBmmFa","nodes":[],"props":{"children":"See the schedule","variant":"outlined","color":"primary","size":"large","screenId":"GkTHiM0a0H","aglynAnimation":"slide-up","aglynAnimationTrigger":"load","aglynAnimationDuration":560,"aglynAnimationDelay":345,"aglynAnimationEase":"smooth"},"sx":{"alignSelf":"flex-start"}},
  "JXCwJvbe5S": {"$id":"JXCwJvbe5S","type":"node","componentId":"muiTypography","pluginId":"mui","parentId":"5k0fr7hrvd","nodes":[],"props":{"children":"Riders and programs","variant":"h2","component":"h2"}},
  "5doQLxlQKo": {"$id":"5doQLxlQKo","type":"node","componentId":"muiTypography","pluginId":"mui","parentId":"5k0fr7hrvd","nodes":[],"props":{"children":"From mini riders to our team captain, there is a place on the line for every age and skill level.","variant":"body1"},"sx":{"color":"text.secondary"}},
  "1_gW_5QuC9": {"$id":"1_gW_5QuC9","type":"node","componentId":"muiTypography","pluginId":"mui","parentId":"yuLAnC5gPK","nodes":[],"props":{"children":"Next races","variant":"h2","component":"h2"}},
  "s0PPuPw7vo": {"$id":"s0PPuPw7vo","type":"node","componentId":"muiTypography","pluginId":"mui","parentId":"yuLAnC5gPK","nodes":[],"props":{"children":"Dates and tracks are being added. Check back to see where we line up next.","variant":"body1"},"sx":{"color":"text.secondary"}},
} as unknown as NodesMap

/** Its root and its sections, in plan order, as the page step hands them to the resolver. */
export const RUT_RUNNERS_HOME_PAGE = {
  "rootId": "_@_",
  "sectionIds": [
    "ai-LpjPaYgvkh-section-1",
    "ai-LpjPaYgvkh-section-2",
    "ai-LpjPaYgvkh-section-3",
    "ai-LpjPaYgvkh-section-4",
    "ai-LpjPaYgvkh-section-5",
    "ai-LpjPaYgvkh-section-6",
    "ai-LpjPaYgvkh-section-7"
  ],
  "sectionNames": [
    "Hero: built in Lockhart, raced across Texas",
    "How to get started with the team",
    "Riders and programs",
    "The team at the track in pictures",
    "Next races",
    "Questions people ask, answered",
    "Call to action: sponsor or join"
  ]
} as const

/** Pit Row Tacos's home page as the start stored it, its photos taken back out to the slots the compiler wrote. */
export const PIT_ROW_HOME: NodesMap = {
  "_@_": {"$id":"_@_","type":"node","componentId":"div","pluginId":"mui","parentId":null,"nodes":["ai-cmKXUpADXV-section-1","ai-cmKXUpADXV-section-2","ai-cmKXUpADXV-section-3","ai-cmKXUpADXV-section-4","ai-cmKXUpADXV-section-5","ai-cmKXUpADXV-section-6"],"props":{}},
  "ai-cmKXUpADXV-section-1": {"$id":"ai-cmKXUpADXV-section-1","type":"node","componentId":"section","pluginId":"mui","parentId":"_@_","nodes":["xLP4kQZkjh","dg6AwLbmuO"],"props":{"element":"section","ariaLabel":"Hero: race-day tacos, made fresh on the line","colorScheme":"dark","underHeader":true},"sx":{"position":"relative","overflow":"hidden","display":"flex","alignItems":{"xs":"flex-end","md":"center"},"minHeight":{"xs":"84vh","md":"94vh"}}},
  "ai-cmKXUpADXV-section-2": {"$id":"ai-cmKXUpADXV-section-2","type":"node","componentId":"section","pluginId":"mui","parentId":"_@_","nodes":["hOuiLJNjzL"],"props":{"element":"section","ariaLabel":"Our story: a taco trailer from Buda"}},
  "ai-cmKXUpADXV-section-3": {"$id":"ai-cmKXUpADXV-section-3","type":"node","componentId":"section","pluginId":"mui","parentId":"_@_","nodes":["EMhhCURseX"],"props":{"element":"section","ariaLabel":"Menu highlights"},"sx":{"bgcolor":"background.paper"}},
  "ai-cmKXUpADXV-section-4": {"$id":"ai-cmKXUpADXV-section-4","type":"node","componentId":"section","pluginId":"mui","parentId":"_@_","nodes":["uSmN3pjoQc"],"props":{"element":"section","ariaLabel":"The trailer and the food in pictures"}},
  "ai-cmKXUpADXV-section-5": {"$id":"ai-cmKXUpADXV-section-5","type":"node","componentId":"section","pluginId":"mui","parentId":"_@_","nodes":["OAcboKZSMV"],"props":{"element":"section","ariaLabel":"Where to find us: races, events and around town"}},
  "ai-cmKXUpADXV-section-6": {"$id":"ai-cmKXUpADXV-section-6","type":"node","componentId":"section","pluginId":"mui","parentId":"_@_","nodes":["1sDC4ReT_R"],"props":{"element":"section","ariaLabel":"Call to action: plan your catering"},"sx":{"bgcolor":"primary.main","color":"primary.contrastText"}},
  "xLP4kQZkjh": {"$id":"xLP4kQZkjh","type":"node","componentId":"muiBox","pluginId":"mui","parentId":"ai-cmKXUpADXV-section-1","nodes":["T8LwMVKXyz"],"props":{},"sx":{"position":"absolute","overflow":"hidden","bgcolor":"common.black","top":0,"left":0,"width":"100%","height":"100%"}},
  "dg6AwLbmuO": {"$id":"dg6AwLbmuO","type":"node","componentId":"muiContainer","pluginId":"mui","parentId":"ai-cmKXUpADXV-section-1","nodes":["QNmOAbSAOM"],"props":{"maxWidth":"lg"},"sx":{"position":"relative","zIndex":1,"py":{"xs":10,"md":14}}},
  "hOuiLJNjzL": {"$id":"hOuiLJNjzL","type":"node","componentId":"muiContainer","pluginId":"mui","parentId":"ai-cmKXUpADXV-section-2","nodes":["AKD9N8mc8g"],"props":{"maxWidth":"lg"},"sx":{"py":{"xs":8,"md":12}}},
  "EMhhCURseX": {"$id":"EMhhCURseX","type":"node","componentId":"muiContainer","pluginId":"mui","parentId":"ai-cmKXUpADXV-section-3","nodes":["2Q231pR2q5"],"props":{"maxWidth":"lg"},"sx":{"py":{"xs":8,"md":12}}},
  "uSmN3pjoQc": {"$id":"uSmN3pjoQc","type":"node","componentId":"muiContainer","pluginId":"mui","parentId":"ai-cmKXUpADXV-section-4","nodes":["vksfe6SmZw"],"props":{"maxWidth":"lg"},"sx":{"py":{"xs":8,"md":12}}},
  "OAcboKZSMV": {"$id":"OAcboKZSMV","type":"node","componentId":"muiContainer","pluginId":"mui","parentId":"ai-cmKXUpADXV-section-5","nodes":["0V5mk_nzLy"],"props":{"maxWidth":"lg"},"sx":{"py":{"xs":8,"md":12}}},
  "1sDC4ReT_R": {"$id":"1sDC4ReT_R","type":"node","componentId":"muiContainer","pluginId":"mui","parentId":"ai-cmKXUpADXV-section-6","nodes":["XrzFi-ENHj"],"props":{"maxWidth":"md"},"sx":{"py":{"xs":8,"md":12}}},
  "T8LwMVKXyz": {"$id":"T8LwMVKXyz","type":"node","componentId":"image","pluginId":"mui","parentId":"xLP4kQZkjh","nodes":[],"props":{"alt":"A buffet in a kitchen","objectFit":"cover","width":"100%","height":"100%"},"sx":{"opacity":0.42}},
  "QNmOAbSAOM": {"$id":"QNmOAbSAOM","type":"node","componentId":"muiBox","pluginId":"mui","parentId":"dg6AwLbmuO","nodes":["4vl4B4Pqei"],"props":{},"sx":{"maxWidth":{"xs":"100%","md":"75%"},"mx":"auto"}},
  "AKD9N8mc8g": {"$id":"AKD9N8mc8g","type":"node","componentId":"muiGrid","pluginId":"mui","parentId":"hOuiLJNjzL","nodes":["D3qJQJggyh","VnrC5jJyrs"],"props":{"container":true,"spacing":"6"},"sx":{"alignItems":"center"}},
  "2Q231pR2q5": {"$id":"2Q231pR2q5","type":"node","componentId":"muiStack","pluginId":"mui","parentId":"EMhhCURseX","nodes":["SEpujhzYsM","UMkACXh9vJ","yju5ZxPrAO"],"props":{"spacing":"6","useFlexGap":true,"alignItems":"center"}},
  "vksfe6SmZw": {"$id":"vksfe6SmZw","type":"node","componentId":"muiStack","pluginId":"mui","parentId":"uSmN3pjoQc","nodes":["E4slLnDAE_","vntvAgygIV"],"props":{"spacing":"4","alignItems":"center"}},
  "0V5mk_nzLy": {"$id":"0V5mk_nzLy","type":"node","componentId":"muiStack","pluginId":"mui","parentId":"OAcboKZSMV","nodes":["mHoRp_mJu2","Y39hGnIwf1"],"props":{"spacing":"4","alignItems":"center"}},
  "XrzFi-ENHj": {"$id":"XrzFi-ENHj","type":"node","componentId":"muiStack","pluginId":"mui","parentId":"1sDC4ReT_R","nodes":["bduy3QVrKV","8xpfPC9OoC","p5JdYfqf4Q"],"props":{"spacing":"2.5","alignItems":"center","aglynAnimation":"fade","aglynAnimationTrigger":"scroll","aglynAnimationDuration":550,"aglynAnimationEase":"overshoot"}},
  "4vl4B4Pqei": {"$id":"4vl4B4Pqei","type":"node","componentId":"muiStack","pluginId":"mui","parentId":"QNmOAbSAOM","nodes":["zHgQm9TwZP","5x_d_Tjvjq","mJgbRRK54j"],"props":{"spacing":"2.5","alignItems":"center"}},
  "D3qJQJggyh": {"$id":"D3qJQJggyh","type":"node","componentId":"muiGrid","pluginId":"mui","parentId":"AKD9N8mc8g","nodes":["vtr2WyR1S4"],"props":{"size":"xs:12 md:6","aglynAnimation":"zoom-in","aglynAnimationTrigger":"scroll","aglynAnimationDuration":550,"aglynAnimationEase":"overshoot"}},
  "VnrC5jJyrs": {"$id":"VnrC5jJyrs","type":"node","componentId":"muiGrid","pluginId":"mui","parentId":"AKD9N8mc8g","nodes":["AKpu7-v9l5"],"props":{"size":"xs:12 md:6","aglynAnimation":"fade","aglynAnimationTrigger":"scroll","aglynAnimationDuration":550,"aglynAnimationDelay":105,"aglynAnimationEase":"overshoot"}},
  "SEpujhzYsM": {"$id":"SEpujhzYsM","type":"node","componentId":"muiContainer","pluginId":"mui","parentId":"2Q231pR2q5","nodes":["f4ld8bgw1g"],"props":{"maxWidth":"md","disableGutters":true,"aglynAnimation":"slide-up","aglynAnimationTrigger":"scroll","aglynAnimationDuration":550,"aglynAnimationEase":"overshoot"}},
  "UMkACXh9vJ": {"$id":"UMkACXh9vJ","type":"node","componentId":"muiBox","pluginId":"mui","parentId":"2Q231pR2q5","nodes":["Uw14qHAJRD"],"props":{"repeatLimit":"3","repeatDataset":"wyeFtRV5_W","aglynAnimation":"zoom-in","aglynAnimationTrigger":"scroll","aglynAnimationDuration":550,"aglynAnimationEase":"overshoot","aglynAnimationStagger":true,"aglynAnimationStaggerStep":105},"sx":{"display":"grid","gridTemplateColumns":{"xs":"1fr","md":"repeat(3, 1fr)"},"gap":5}},
  "yju5ZxPrAO": {"$id":"yju5ZxPrAO","type":"node","componentId":"muiButton","pluginId":"mui","parentId":"2Q231pR2q5","nodes":[],"props":{"children":"Full menu","variant":"outlined","color":"primary","size":"medium","screenId":"P5hKk_STzb","aglynAnimation":"slide-up","aglynAnimationTrigger":"scroll","aglynAnimationDuration":550,"aglynAnimationEase":"overshoot"},"sx":{"alignSelf":"center"}},
  "E4slLnDAE_": {"$id":"E4slLnDAE_","type":"node","componentId":"muiTypography","pluginId":"mui","parentId":"vksfe6SmZw","nodes":[],"props":{"children":"The trailer and the food in pictures","variant":"h2","component":"h2","align":"center","aglynAnimation":"fade","aglynAnimationTrigger":"scroll","aglynAnimationDuration":550,"aglynAnimationEase":"overshoot"}},
  "vntvAgygIV": {"$id":"vntvAgygIV","type":"node","componentId":"muiGrid","pluginId":"mui","parentId":"vksfe6SmZw","nodes":["iJKOU48aEW","pgQwICvfHY","szx6EFt7uv","ZdUsjo2DrM","PeYFJFXj7q","8JuLZdTycY"],"props":{"container":true,"spacing":"3","aglynAnimation":"zoom-in","aglynAnimationTrigger":"scroll","aglynAnimationDuration":550,"aglynAnimationEase":"overshoot","aglynAnimationStagger":true,"aglynAnimationStaggerStep":105}},
  "mHoRp_mJu2": {"$id":"mHoRp_mJu2","type":"node","componentId":"muiTypography","pluginId":"mui","parentId":"0V5mk_nzLy","nodes":[],"props":{"children":"Where to find us: races, events and around town","variant":"h2","component":"h2","align":"center","aglynAnimation":"slide-up","aglynAnimationTrigger":"scroll","aglynAnimationDuration":550,"aglynAnimationEase":"overshoot"}},
  "Y39hGnIwf1": {"$id":"Y39hGnIwf1","type":"node","componentId":"muiGrid","pluginId":"mui","parentId":"0V5mk_nzLy","nodes":["YHFKex-J6k","Bkl1aV5Qj-","KFSw25hpZs","ZyqTrP_-Rp"],"props":{"container":true,"spacing":"3","aglynAnimation":"zoom-in","aglynAnimationTrigger":"scroll","aglynAnimationDuration":550,"aglynAnimationEase":"overshoot","aglynAnimationStagger":true,"aglynAnimationStaggerStep":105}},
  "bduy3QVrKV": {"$id":"bduy3QVrKV","type":"node","componentId":"muiTypography","pluginId":"mui","parentId":"XrzFi-ENHj","nodes":[],"props":{"children":"Plan your catering","variant":"h2","component":"h2","align":"center"}},
  "8xpfPC9OoC": {"$id":"8xpfPC9OoC","type":"node","componentId":"muiTypography","pluginId":"mui","parentId":"XrzFi-ENHj","nodes":[],"props":{"children":"Tell us about your event and we will bring the tacos to you.","variant":"lede","align":"center"}},
  "p5JdYfqf4Q": {"$id":"p5JdYfqf4Q","type":"node","componentId":"muiStack","pluginId":"mui","parentId":"XrzFi-ENHj","nodes":["IMdGc996ym","5O8WnLnd78"],"props":{"direction":"row","spacing":"2","useFlexGap":true,"flexWrap":"wrap","justifyContent":"center"}},
  "zHgQm9TwZP": {"$id":"zHgQm9TwZP","type":"node","componentId":"muiTypography","pluginId":"mui","parentId":"4vl4B4Pqei","nodes":[],"props":{"children":"Race-day tacos, made fresh on the line","variant":"displayXl","component":"h1","align":"center"}},
  "5x_d_Tjvjq": {"$id":"5x_d_Tjvjq","type":"node","componentId":"muiTypography","pluginId":"mui","parentId":"4vl4B4Pqei","nodes":[],"props":{"children":"Street and breakfast tacos, hot off the griddle in Buda and at the track.","variant":"lede","align":"center","aglynAnimation":"slide-up","aglynAnimationTrigger":"load","aglynAnimationDuration":550,"aglynAnimationEase":"overshoot"}},
  "mJgbRRK54j": {"$id":"mJgbRRK54j","type":"node","componentId":"muiStack","pluginId":"mui","parentId":"4vl4B4Pqei","nodes":["JvtAdJeHPs","v6OyB6k4D-"],"props":{"direction":"row","spacing":"2","useFlexGap":true,"flexWrap":"wrap","justifyContent":"center"}},
  "vtr2WyR1S4": {"$id":"vtr2WyR1S4","type":"node","componentId":"muiBox","pluginId":"mui","parentId":"D3qJQJggyh","nodes":["IDStUN3R4g"],"props":{},"sx":{"position":"relative","display":"flex","alignItems":"center","justifyContent":"center","overflow":"hidden","borderRadius":2,"bgcolor":"action.hover","aspectRatio":"4 / 3"}},
  "AKpu7-v9l5": {"$id":"AKpu7-v9l5","type":"node","componentId":"muiStack","pluginId":"mui","parentId":"VnrC5jJyrs","nodes":["xTf-DtTWgL","De9_ftrcYr","BaYmlm6-dq","xH_9NfFShs"],"props":{"spacing":"2.5"}},
  "f4ld8bgw1g": {"$id":"f4ld8bgw1g","type":"node","componentId":"muiStack","pluginId":"mui","parentId":"SEpujhzYsM","nodes":["RPOprHYfY_","MxSkS9CS_E"],"props":{"spacing":"2.5","alignItems":"center"}},
  "Uw14qHAJRD": {"$id":"Uw14qHAJRD","type":"node","componentId":"muiStack","pluginId":"mui","parentId":"UMkACXh9vJ","nodes":["bXOMBMn01W","iznBzd2yCU","sbww9Zw0hH"],"props":{"spacing":"1.5","alignItems":"center"}},
  "iJKOU48aEW": {"$id":"iJKOU48aEW","type":"node","componentId":"muiGrid","pluginId":"mui","parentId":"vntvAgygIV","nodes":["wcuDuX6D3N"],"props":{"size":"xs:12 md:4"}},
  "pgQwICvfHY": {"$id":"pgQwICvfHY","type":"node","componentId":"muiGrid","pluginId":"mui","parentId":"vntvAgygIV","nodes":["o6u9xhbRgA"],"props":{"size":"xs:12 md:4"}},
  "szx6EFt7uv": {"$id":"szx6EFt7uv","type":"node","componentId":"muiGrid","pluginId":"mui","parentId":"vntvAgygIV","nodes":["1DDX0h0FkB"],"props":{"size":"xs:12 md:4"}},
  "ZdUsjo2DrM": {"$id":"ZdUsjo2DrM","type":"node","componentId":"muiGrid","pluginId":"mui","parentId":"vntvAgygIV","nodes":["F36PWjP1oT"],"props":{"size":"xs:12 md:4"}},
  "PeYFJFXj7q": {"$id":"PeYFJFXj7q","type":"node","componentId":"muiGrid","pluginId":"mui","parentId":"vntvAgygIV","nodes":["AIWrzbJmGJ"],"props":{"size":"xs:12 md:4"}},
  "8JuLZdTycY": {"$id":"8JuLZdTycY","type":"node","componentId":"muiGrid","pluginId":"mui","parentId":"vntvAgygIV","nodes":["OjPeK8My40"],"props":{"size":"xs:12 md:4"}},
  "YHFKex-J6k": {"$id":"YHFKex-J6k","type":"node","componentId":"muiGrid","pluginId":"mui","parentId":"Y39hGnIwf1","nodes":["J-uHin6CPe"],"props":{"size":"xs:12 sm:6 md:3"}},
  "Bkl1aV5Qj-": {"$id":"Bkl1aV5Qj-","type":"node","componentId":"muiGrid","pluginId":"mui","parentId":"Y39hGnIwf1","nodes":["Ssfl2jn64c"],"props":{"size":"xs:12 sm:6 md:3"}},
  "KFSw25hpZs": {"$id":"KFSw25hpZs","type":"node","componentId":"muiGrid","pluginId":"mui","parentId":"Y39hGnIwf1","nodes":["EXHZUnq8l1"],"props":{"size":"xs:12 sm:6 md:3"}},
  "ZyqTrP_-Rp": {"$id":"ZyqTrP_-Rp","type":"node","componentId":"muiGrid","pluginId":"mui","parentId":"Y39hGnIwf1","nodes":["YxGyWxlS6a"],"props":{"size":"xs:12 sm:6 md:3"}},
  "IMdGc996ym": {"$id":"IMdGc996ym","type":"node","componentId":"muiButton","pluginId":"mui","parentId":"p5JdYfqf4Q","nodes":[],"props":{"children":"Get in touch","variant":"contained","color":"secondary","size":"medium","screenId":"UmTRfoe2BE"},"sx":{"alignSelf":"center"}},
  "5O8WnLnd78": {"$id":"5O8WnLnd78","type":"node","componentId":"muiButton","pluginId":"mui","parentId":"p5JdYfqf4Q","nodes":[],"props":{"children":"Catering details","variant":"outlined","color":"inherit","size":"medium","screenId":"2oCD7dEdxy"},"sx":{"alignSelf":"center"}},
  "JvtAdJeHPs": {"$id":"JvtAdJeHPs","type":"node","componentId":"muiButton","pluginId":"mui","parentId":"mJgbRRK54j","nodes":[],"props":{"children":"See the menu","variant":"contained","color":"primary","size":"large","screenId":"P5hKk_STzb","aglynAnimation":"slide-up","aglynAnimationTrigger":"load","aglynAnimationDuration":550,"aglynAnimationDelay":140,"aglynAnimationEase":"overshoot"},"sx":{"alignSelf":"center"}},
  "v6OyB6k4D-": {"$id":"v6OyB6k4D-","type":"node","componentId":"muiButton","pluginId":"mui","parentId":"mJgbRRK54j","nodes":[],"props":{"children":"Plan your visit","variant":"outlined","color":"inherit","size":"large","screenId":"UmTRfoe2BE","aglynAnimation":"slide-up","aglynAnimationTrigger":"load","aglynAnimationDuration":550,"aglynAnimationDelay":280,"aglynAnimationEase":"overshoot"},"sx":{"alignSelf":"center"}},
  "IDStUN3R4g": {"$id":"IDStUN3R4g","type":"node","componentId":"image","pluginId":"mui","parentId":"vtr2WyR1S4","nodes":[],"props":{"alt":"A chef with food","objectFit":"cover"},"sx":{"position":"absolute","top":0,"left":0,"width":"100%","height":"100%"}},
  "xTf-DtTWgL": {"$id":"xTf-DtTWgL","type":"node","componentId":"muiTypography","pluginId":"mui","parentId":"AKpu7-v9l5","nodes":[],"props":{"children":"Our story","variant":"overline","component":"p"},"sx":{"color":"primary.main"}},
  "De9_ftrcYr": {"$id":"De9_ftrcYr","type":"node","componentId":"muiTypography","pluginId":"mui","parentId":"AKpu7-v9l5","nodes":[],"props":{"children":"A taco trailer from Buda","variant":"h2","component":"h2"}},
  "BaYmlm6-dq": {"$id":"BaYmlm6-dq","type":"node","componentId":"muiTypography","pluginId":"mui","parentId":"AKpu7-v9l5","nodes":[],"props":{"children":"Since 2021, Pit Row Tacos has fed riders, families and fans with breakfast tacos at dawn and street tacos by the afternoon, made fresh and served in English or Spanish.","variant":"body1"},"sx":{"color":"text.secondary"}},
  "xH_9NfFShs": {"$id":"xH_9NfFShs","type":"node","componentId":"muiButton","pluginId":"mui","parentId":"AKpu7-v9l5","nodes":[],"props":{"children":"Read our story","variant":"text","color":"primary","size":"medium","screenId":"sPptFtUcSJ"},"sx":{"alignSelf":"flex-start"}},
  "RPOprHYfY_": {"$id":"RPOprHYfY_","type":"node","componentId":"muiTypography","pluginId":"mui","parentId":"f4ld8bgw1g","nodes":[],"props":{"children":"Menu highlights","variant":"h2","component":"h2","align":"center"}},
  "MxSkS9CS_E": {"$id":"MxSkS9CS_E","type":"node","componentId":"muiTypography","pluginId":"mui","parentId":"f4ld8bgw1g","nodes":[],"props":{"children":"Eggs sizzling, tortillas warm, salsa bright: start with breakfast, stay for the street tacos.","variant":"lede","align":"center"},"sx":{"color":"text.secondary"}},
  "bXOMBMn01W": {"$id":"bXOMBMn01W","type":"node","componentId":"image","pluginId":"mui","parentId":"Uw14qHAJRD","nodes":[],"props":{"alt":"{{item.image_description}}","objectFit":"cover","width":"100%","loading":"lazy","src":"{{item.image}}"},"sx":{"aspectRatio":"4 / 3","borderRadius":2}},
  "iznBzd2yCU": {"$id":"iznBzd2yCU","type":"node","componentId":"muiTypography","pluginId":"mui","parentId":"Uw14qHAJRD","nodes":[],"props":{"children":"{{item.category}}","variant":"overline","component":"p","align":"center"},"sx":{"color":"primary.main"}},
  "sbww9Zw0hH": {"$id":"sbww9Zw0hH","type":"node","componentId":"muiTypography","pluginId":"mui","parentId":"Uw14qHAJRD","nodes":[],"props":{"children":"{{item.name}}","variant":"h5","component":"h3","align":"center"}},
  "wcuDuX6D3N": {"$id":"wcuDuX6D3N","type":"node","componentId":"muiListItemText","pluginId":"mui","parentId":"iJKOU48aEW","nodes":[],"props":{"primary":"The trailer","secondary":"Our trailer parked and ready on race day."}},
  "o6u9xhbRgA": {"$id":"o6u9xhbRgA","type":"node","componentId":"muiListItemText","pluginId":"mui","parentId":"pgQwICvfHY","nodes":[],"props":{"primary":"Breakfast tacos","secondary":"Egg, cheese and warm tortillas wrapped to go."}},
  "1DDX0h0FkB": {"$id":"1DDX0h0FkB","type":"node","componentId":"muiListItemText","pluginId":"mui","parentId":"szx6EFt7uv","nodes":[],"props":{"primary":"Street tacos","secondary":"Carne asada, al pastor and carnitas piled high."}},
  "F36PWjP1oT": {"$id":"F36PWjP1oT","type":"node","componentId":"muiListItemText","pluginId":"mui","parentId":"ZdUsjo2DrM","nodes":[],"props":{"primary":"The griddle","secondary":"Meat sizzling and tortillas toasting."}},
  "AIWrzbJmGJ": {"$id":"AIWrzbJmGJ","type":"node","componentId":"muiListItemText","pluginId":"mui","parentId":"PeYFJFXj7q","nodes":[],"props":{"primary":"Salsas and toppings","secondary":"Fresh, bright and made for sharing."}},
  "OjPeK8My40": {"$id":"OjPeK8My40","type":"node","componentId":"muiListItemText","pluginId":"mui","parentId":"8JuLZdTycY","nodes":[],"props":{"primary":"Fans in line","secondary":"Riders and families waiting for their order."}},
  "J-uHin6CPe": {"$id":"J-uHin6CPe","type":"node","componentId":"muiListItemText","pluginId":"mui","parentId":"YHFKex-J6k","nodes":[],"props":{"primary":"Buda","secondary":"Our home base at [address], Wed–Sun 9am–5pm."}},
  "Ssfl2jn64c": {"$id":"Ssfl2jn64c","type":"node","componentId":"muiListItemText","pluginId":"mui","parentId":"Bkl1aV5Qj-","nodes":[],"props":{"primary":"Texas motocross races","secondary":"Pull up to the pit row for a hot taco between motos."}},
  "EXHZUnq8l1": {"$id":"EXHZUnq8l1","type":"node","componentId":"muiListItemText","pluginId":"mui","parentId":"KFSw25hpZs","nodes":[],"props":{"primary":"Around town and events","secondary":"Find us at local events around Buda, Kyle, San Marcos, Austin and Lockhart."}},
  "YxGyWxlS6a": {"$id":"YxGyWxlS6a","type":"node","componentId":"muiListItemText","pluginId":"mui","parentId":"ZyqTrP_-Rp","nodes":[],"props":{"primary":"Call ahead","secondary":"Reach us at [phone]."}},
} as unknown as NodesMap

/** Its root and its sections, in plan order, as the page step hands them to the resolver. */
export const PIT_ROW_HOME_PAGE = {
  "rootId": "_@_",
  "sectionIds": [
    "ai-cmKXUpADXV-section-1",
    "ai-cmKXUpADXV-section-2",
    "ai-cmKXUpADXV-section-3",
    "ai-cmKXUpADXV-section-4",
    "ai-cmKXUpADXV-section-5",
    "ai-cmKXUpADXV-section-6"
  ],
  "sectionNames": [
    "Hero: race-day tacos, made fresh on the line",
    "Our story: a taco trailer from Buda",
    "Menu highlights",
    "The trailer and the food in pictures",
    "Where to find us: races, events and around town",
    "Call to action: plan your catering"
  ]
} as const
