# Usage
# $ npm run sync-version
# Target README.md and .github/workflows/*.yml
# Update `BLUE_NOTION_VERSION: xxx` to `npm pkg version`
projectDir=$(git rev-parse --show-toplevel)
target_files=(
  "${projectDir}/README.md"
  "${projectDir}"/.github/workflows/*.yml
)
currentPackageVersion=$(cat "${projectDir}/package.json" | jq -r '.version')
# update
for file in "${target_files[@]}"; do
  # without backup
  sed -i '' -e "s/BLUE_NOTION_VERSION: v.*/BLUE_NOTION_VERSION: v${currentPackageVersion}/g" "${file}"
done
