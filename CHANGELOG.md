# Changelog

## 1.1.0

- Added streamed upload handling with a 20 MB default size limit.
- Added decoded-image pixel limits and content-type validation.
- Added EXIF orientation correction for phone/camera photos.
- Added OCR downscaling for large images while preserving original-coordinate overlays.
- Added cached online definition translations.
- Added persistent pinyin key arrays instead of rebuilding them per search.
- Added sorted simplified/traditional headword indexes for fast prefix searches.
- Clamped dictionary API result limits to a safe range.
- Added browser-side image type and upload-size checks.
- Added dependency upper bounds to reduce future breaking changes.
- Expanded README documentation for upload limits, OCR scaling, and translation privacy.
- Expanded .gitignore for logs, editor metadata, OS files, and distribution ZIPs.
- Distribution package no longer includes .git, __pycache__, or runtime logs.

## 2026-09-06 — Clean UI refresh
- Reworked the visual system with a lighter, calmer dictionary-app layout.
- Reduced heavy shadows and excess borders while improving spacing and hierarchy.
- Refined search, dictionary cards, camera sheet, settings, segmented controls, and bottom navigation.
- Added clearer focus states, hover states, reduced-motion support, and improved small-screen behavior.
- Replaced several emoji-heavy interface icons with quieter text symbols for a more consistent appearance.
