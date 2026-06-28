#!/usr/bin/env node

// sync-version: Read version from root pkg and sync to all sub-pkgs and files
// Usage: node scripts/sync-version.mjs [--check]
//   --check: Only check, do not modify (for CI)

import { readFileSync, writeFileSync, readdirSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const rootDir = resolve(__dirname, '..')
const checkOnly = process.argv.includes('--check')

// Read root version
const rootPkgPath = resolve(rootDir, 'package.json')
const rootPkg = JSON.parse(readFileSync(rootPkgPath, 'utf-8'))
const rootVersion = rootPkg.version

if (!rootVersion) {
  console.error('Root pkg missing version field')
  process.exit(1)
}

console.log(`Root version: ${rootVersion}`)

let mismatches = 0

function syncFile(label, filePath, oldContent, newContent) {
  if (oldContent === newContent) {
    console.log(`  ok ${label} already ${rootVersion}`)
    return
  }
  if (checkOnly) {
    console.log(`  MISMATCH ${label}`)
    mismatches++
  } else {
    writeFileSync(filePath, newContent, 'utf-8')
    console.log(`  synced ${label} -> ${rootVersion}`)
  }
}

// Sync sub-pkg version fields
const subDir = resolve(rootDir, 'packages')
const subDirs = readdirSync(subDir, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)

for (const dir of subDirs) {
  const pkgPath = resolve(subDir, dir, 'package.json')
  try {
    const raw = readFileSync(pkgPath, 'utf-8')
    const pkg = JSON.parse(raw)
    const label = `@mail-agent/${dir}`
    if (pkg.version === rootVersion) {
      console.log(`  ok ${label} already ${rootVersion}`)
    } else {
      if (checkOnly) {
        console.log(`  MISMATCH ${label} (${pkg.version})`)
        mismatches++
      } else {
        pkg.version = rootVersion
        writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf-8')
        console.log(`  synced ${label} ${pkg.version} -> ${rootVersion}`)
      }
    }
  } catch {
    /* skip dirs without package.json */
  }
}

// Sync CLI .version()
const cliIndexPath = resolve(rootDir, 'packages', 'cli', 'src', 'index.ts')
{
  const raw = readFileSync(cliIndexPath, 'utf-8')
  const pattern = /\.version\(['"]([^'"]+)['"]\)/
  const match = raw.match(pattern)
  if (match) {
    const oldVer = match[1]
    if (oldVer === rootVersion) {
      console.log(`  ok CLI .version() already ${rootVersion}`)
    } else {
      if (checkOnly) {
        console.log(`  MISMATCH CLI .version() (${oldVer})`)
        mismatches++
      } else {
        const updated = raw.replace(pattern, `.version('${rootVersion}')`)
        writeFileSync(cliIndexPath, updated, 'utf-8')
        console.log(`  synced CLI .version() ${oldVer} -> ${rootVersion}`)
      }
    }
  }
}

// Sync SKILL.md frontmatter
const skillPath = resolve(rootDir, 'SKILL.md')
{
  const raw = readFileSync(skillPath, 'utf-8')
  const pattern = /^version:\s*(.+)$/m
  const match = raw.match(pattern)
  if (match) {
    const oldVer = match[1].trim()
    if (oldVer === rootVersion) {
      console.log(`  ok SKILL.md version already ${rootVersion}`)
    } else {
      if (checkOnly) {
        console.log(`  MISMATCH SKILL.md version (${oldVer})`)
        mismatches++
      } else {
        const updated = raw.replace(pattern, `version: ${rootVersion}`)
        writeFileSync(skillPath, updated, 'utf-8')
        console.log(`  synced SKILL.md version ${oldVer} -> ${rootVersion}`)
      }
    }
  }
}

// Sync cli-setup.md frontmatter
const cliSetupPath = resolve(rootDir, 'cli-setup.md')
{
  const raw = readFileSync(cliSetupPath, 'utf-8')
  const pattern = /^version:\s*(.+)$/m
  const match = raw.match(pattern)
  if (match) {
    const oldVer = match[1].trim()
    if (oldVer === rootVersion) {
      console.log(`  ok cli-setup.md version already ${rootVersion}`)
    } else {
      if (checkOnly) {
        console.log(`  MISMATCH cli-setup.md version (${oldVer})`)
        mismatches++
      } else {
        const updated = raw.replace(pattern, `version: ${rootVersion}`)
        writeFileSync(cliSetupPath, updated, 'utf-8')
        console.log(`  synced cli-setup.md version ${oldVer} -> ${rootVersion}`)
      }
    }
  }
}

// Summary
if (checkOnly) {
  if (mismatches > 0) {
    console.error(`\nFound ${mismatches} version mismatch(es). Run: pnpm sync-version`)
    process.exit(1)
  } else {
    console.log(`\nAll versions match: ${rootVersion}`)
  }
} else {
  console.log(`\nAll versions synced to ${rootVersion}`)
}
