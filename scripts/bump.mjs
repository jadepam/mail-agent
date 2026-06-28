#!/usr/bin/env node

// bump: Increment version in root pkg, then sync everywhere
// Usage: node scripts/bump.mjs <patch|minor|major|exact-version>

import { readFileSync, writeFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { execSync } from 'child_process'

const __dirname = dirname(fileURLToPath(import.meta.url))
const rootDir = resolve(__dirname, '..')

const arg = process.argv[2]
if (!arg) {
  console.error('Usage: pnpm bump <patch|minor|major|1.2.3>')
  process.exit(1)
}

// Read current version
const rootPkgPath = resolve(rootDir, 'package.json')
const rootPkg = JSON.parse(readFileSync(rootPkgPath, 'utf-8'))
const currentVersion = rootPkg.version

// Compute new version
function bumpVersion(current, type) {
  const parts = current.split('.').map(Number)
  if (parts.length !== 3 || parts.some(isNaN)) {
    throw new Error(`Invalid version format: ${current}`)
  }
  const [major, minor, patch] = parts
  switch (type) {
    case 'patch':
      return `${major}.${minor}.${patch + 1}`
    case 'minor':
      return `${major}.${minor + 1}.0`
    case 'major':
      return `${major + 1}.0.0`
    default:
      // Treat as exact version
      if (!/^\d+\.\d+\.\d+$/.test(type)) {
        throw new Error(`Invalid argument: ${type}. Use patch|minor|major or exact version like 1.2.3`)
      }
      return type
  }
}

const newVersion = bumpVersion(currentVersion, arg)

if (newVersion === currentVersion) {
  console.log(`Version unchanged: ${currentVersion} (no bump needed)`)
  process.exit(0)
}

// Update root package.json
rootPkg.version = newVersion
writeFileSync(rootPkgPath, JSON.stringify(rootPkg, null, 2) + '\n', 'utf-8')
console.log(`Root version: ${currentVersion} -> ${newVersion}`)

// Run sync-version
execSync('node scripts/sync-version.mjs', { cwd: rootDir, stdio: 'inherit' })

// Summary
console.log('')
console.log('---')
console.log(`Version bumped: ${currentVersion} -> ${newVersion}`)
console.log('')
console.log('Next steps:')
console.log('  1. Review changes: git diff')
console.log('  2. Commit:         git commit -am "chore: release v' + newVersion + '"')
console.log('  3. Push & merge to main, CI will auto-publish')
