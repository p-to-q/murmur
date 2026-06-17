# Murmur Artwork Seed Pack v0.5

这版是 ZIP 素材包，不依赖外部脚本。它把 v0.4 的内容和新的扩展素材合并在一起，并额外生成了 background-ready 方形版本，方便直接放到 Murmur 的唱片、波形和标题后面做情绪场。

## 核心审美

不是随机名画，也不是艺术史炫技。Murmur 的图像应该像一层 seeded emotional field：有艺术史气质、略冷门、友好、可被 UI 遮挡，作为背景或辅助，而不是抢走封面主角。

## 本版变化

- manifest 总数：63 张。
- v0.5 新增：12 张。
- 新增 `background_ready/`：每张作品都有 1600×1600 的背景友好版本。
- 新增 `previews/`：每个 bucket 的 contact sheet，便于人工快速审美检查。
- 删除单独 pipeline 脚本；这版只作为可交付素材 ZIP。

## 目录

```
manifest.json
seed_summary.csv
bucket_index.md
artwork_taxonomy.json
expanded_candidate_list.json
v0_5_download_log.json
artworks/{bucket}/original-files.jpg
background_ready/{bucket}/square-softened-bg.jpg
previews/{bucket}_contact_sheet.jpg
```

## 使用建议

产品中优先使用 `background_ready`，需要高清原图或重新裁切时再用 `artworks`。运行时集成以仓库根目录的 `src/presets/artworks/catalog.ts` 和 `src/presets/artworks/artwork-matcher.ts` 为准；本目录只保留素材 provenance 和人工审美检查材料。

选择逻辑保持：

```
genre + mood + energy + scene -> bucket -> top scored artworks -> seeded pick -> saved visualConfig
```

## 渲染原则

- artwork 是 sleeve atmosphere，不是 poster。
- 前景仍然应该是 Murmur 的唱片、波形、标题。
- 背景要可被遮挡、可被低对比处理、可裁成正方形。
- 高对比、人群、浪、舞台类图片需要更强 overlay。
- interior / luminist / pastoral 类图片可以更轻处理，保留空气和纸感。
