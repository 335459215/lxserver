import fs from 'node:fs'
import path from 'node:path'
import { log } from './util.mjs'

/** 汇总一次冒烟运行的结果，产出 JSON + Markdown，并支持新旧两版逐项比对 */
export class Report {
  constructor({ surface, baselineDir, env }) {
    this.surface = surface
    this.baselineDir = baselineDir
    this.env = env
    this.results = []
    this.startedAt = new Date().toISOString()
  }

  add(result) {
    this.results.push(result)
  }

  get summary() {
    const pass = this.results.filter((r) => r.status === 'pass').length
    const fail = this.results.filter((r) => r.status === 'fail').length
    const skip = this.results.filter((r) => r.status === 'skip').length
    return { total: this.results.length, pass, fail, skip }
  }

  finish() {
    return { surface: this.surface, env: this.env, startedAt: this.startedAt, finishedAt: new Date().toISOString(), summary: this.summary, results: this.results }
  }

  save() {
    fs.mkdirSync(this.baselineDir, { recursive: true })
    const jsonPath = path.join(this.baselineDir, `${this.surface}-${this.stamp()}.json`)
    fs.writeFileSync(jsonPath, JSON.stringify(this.finish(), null, 2))

    const mdPath = path.join(this.baselineDir, `${this.surface}-${this.stamp()}.md`)
    fs.writeFileSync(mdPath, this.toMarkdown())

    fs.writeFileSync(path.join(this.baselineDir, `${this.surface}-latest.json`), JSON.stringify(this.finish(), null, 2))
    fs.writeFileSync(path.join(this.baselineDir, `${this.surface}-latest.md`), this.toMarkdown())
    log(`报告已写入: ${mdPath}`)
    return { jsonPath, mdPath }
  }

  stamp() {
    return this.startedAt.replace(/[:.]/g, '-').replace('T', '_').slice(0, 19)
  }

  toMarkdown() {
    const { total, pass, fail, skip } = this.summary
    const lines = []
    lines.push(`# lxserver 冒烟报告 — ${this.surface}`)
    lines.push('')
    lines.push(`- 开始时间: ${this.startedAt}`)
    lines.push(`- 环境: ${JSON.stringify(this.env)}`)
    lines.push(`- 结果: 共 ${total} 项，通过 ${pass}，失败 ${fail}，跳过 ${skip}`)
    lines.push('')
    lines.push('| 用例 | 组 | 结果 | 耗时 | 备注 |')
    lines.push('|---|---|---|---|---|')
    for (const r of this.results) {
      const mark = r.status === 'pass' ? '✅' : r.status === 'fail' ? '❌' : '⏭️'
      const note = r.status === 'fail' ? String(r.error).replace(/\|/g, '\\|').slice(0, 200) : (r.detail ? String(r.detail).replace(/\|/g, '\\|').slice(0, 80) : '')
      lines.push(`| ${r.id} | ${r.group ?? '-'} | ${mark} | ${r.durationMs}ms | ${note} |`)
    }
    lines.push('')
    return lines.join('\n')
  }
}

/** 新旧两版逐项比对：产出"新前端是否丢了旧前端能做的事"的客观证据 */
export function compareSurfaces(oldReport, newReport, { outDir }) {
  const oldById = new Map(oldReport.results.map((r) => [r.id, r]))
  const newById = new Map(newReport.results.map((r) => [r.id, r]))
  const rows = []
  for (const [id, o] of oldById) {
    const n = newById.get(id)
    if (!n) { rows.push({ id, old: o.status, new: 'missing', verdict: '新前端缺少该用例' }); continue }
    if (o.status === n.status) rows.push({ id, old: o.status, new: n.status, verdict: '一致' })
    else if (o.status === 'pass' && n.status !== 'pass') rows.push({ id, old: o.status, new: n.status, verdict: '**回归**' })
    else rows.push({ id, old: o.status, new: n.status, verdict: '改善' })
  }
  for (const [id, n] of newById) {
    if (!oldById.has(id)) rows.push({ id, old: 'missing', new: n.status, verdict: '新前端新增' })
  }

  fs.mkdirSync(outDir, { recursive: true })
  const jsonPath = path.join(outDir, 'compare.json')
  fs.writeFileSync(jsonPath, JSON.stringify({ generatedAt: new Date().toISOString(), rows }, null, 2))

  const lines = ['# 新旧前端冒烟比对', '', '| 用例 | 旧版 | 新版 | 判定 |', '|---|---|---|---|']
  for (const r of rows) lines.push(`| ${r.id} | ${r.old} | ${r.new} | ${r.verdict} |`)
  const regressions = rows.filter((r) => r.verdict === '**回归**').length
  lines.push('', `**回归项: ${regressions}**`, '')
  const mdPath = path.join(outDir, 'compare.md')
  fs.writeFileSync(mdPath, lines.join('\n'))
  if (regressions) log('warn', `发现 ${regressions} 项回归，详见 ${mdPath}`)
  else log('ok', '新旧比对无回归')
  return { jsonPath, mdPath, regressions, rows }
}
