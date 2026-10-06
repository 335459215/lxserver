import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))

export const SMOKE_ROOT = path.resolve(here, '..')
export const REPO_ROOT = path.resolve(SMOKE_ROOT, '../..')
export const FIXTURES_DIR = path.join(SMOKE_ROOT, 'fixtures')
export const BASELINE_DIR = path.join(SMOKE_ROOT, 'baseline')

export const TSX_CLI = path.join(REPO_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs')
