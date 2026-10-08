#!/usr/bin/env bash
#
# Build the macOS Preview surface (spec #12, ticket #14): the carrier app and
# its Quick Look Preview app extension.
#
#   pnpm package:macos
#
# Steps:
#   1. build the worker-less, classic preview web bundle   (packages/web)
#   2. stage it into the extension's Resources/preview/    (folder reference)
#   3. generate HPGLViewer.xcodeproj from project.yml      (XcodeGen)
#   4. xcodebuild the app + appex                          (ad-hoc signed)
#
# Deliberately NOT named `build`: the repo-wide `pnpm -r build` runs on Linux CI
# and must never invoke this (spec #12).
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

macos_dir="packages/macos"
project="$macos_dir/HPGLViewer.xcodeproj"
staged="$macos_dir/PreviewExtension/Resources/preview"
build_dir="$macos_dir/build"

XCODEGEN="${XCODEGEN:-xcodegen}"

echo "==> [1/4] building the preview web bundle"
pnpm --filter @hpgl-viewer/web build:preview

echo "==> [2/4] staging packages/web/dist/preview/ -> $staged/"
mkdir -p "$staged"
rsync -a --delete packages/web/dist/preview/ "$staged/"

echo "==> [3/4] generating $project with XcodeGen"
( cd "$macos_dir" && "$XCODEGEN" generate )

echo "==> [4/4] building with xcodebuild"
xcodebuild \
  -project "$project" \
  -scheme HPGLViewer \
  -configuration Release \
  -derivedDataPath "$build_dir" \
  -destination 'platform=macOS' \
  CODE_SIGN_IDENTITY=- \
  CODE_SIGNING_REQUIRED=YES \
  CODE_SIGNING_ALLOWED=YES \
  build

echo
echo "Built: $build_dir/Build/Products/Release/HPGLViewer.app"
echo "Install + register:"
echo "  ditto $build_dir/Build/Products/Release/HPGLViewer.app /Applications/HPGLViewer.app"
echo "  open -a /Applications/HPGLViewer.app"
