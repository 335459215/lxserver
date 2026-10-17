/**
 * dockerfileEnv.test.ts — 守住「镜像不替用户决定监听地址」这条。
 *
 * 【背景（真实踩坑）】
 * Dockerfile 里曾有 `ENV BIND_IP='0.0.0.0'`。环境变量优先级**高于** config.js
 * （index.ts 里 `envParams.BIND_IP` 覆盖配置文件），于是：
 *   - 用户在 config.js 里把 bindIP 改成 127.0.0.1（挂反代时的常见做法）
 *   - 容器仍然监听 0.0.0.0，`/config.json` 与启动日志也都显示 0.0.0.0
 *   - 从任何界面都看不出"是镜像的默认值压住了我的配置"
 * 这个测试就是防止那个 ENV 再被加回来。
 *
 * 【为什么用"读 Dockerfile 文本"这种形式】
 * 这一条约束**只存在于 Dockerfile 里**，没有可调用的函数能断言它。
 * 它不是"测实现细节"，而是"测部署契约"：镜像不得预设 BIND_IP。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const dockerfilePath = path.join(process.cwd(), 'Dockerfile')

/** 取 Dockerfile 里所有**生效**的 ENV 指令（排除注释行）。 */
function activeEnvLines(): Array<{ line: number, name: string, value: string }> {
  const text = fs.readFileSync(dockerfilePath, 'utf8')
  const out: Array<{ line: number, name: string, value: string }> = []
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim()
    if (!line || line.startsWith('#')) return // 注释掉的 ENV 不算生效
    const m = /^ENV\s+([A-Za-z_][A-Za-z0-9_]*)[=\s]+(.+)$/.exec(line)
    if (!m) return
    let value = m[2].trim()
    if ((value.startsWith("'") && value.endsWith("'")) || (value.startsWith('"') && value.endsWith('"'))) {
      value = value.slice(1, -1)
    }
    out.push({ line: i + 1, name: m[1], value })
  })
  return out
}

test('Dockerfile 不得预设 BIND_IP（否则 config.js 的 bindIP 永远失效）', () => {
  const envs = activeEnvLines()
  const bind = envs.filter((e) => e.name === 'BIND_IP')
  assert.equal(
    bind.length,
    0,
    `Dockerfile 第 ${bind.map((b) => b.line).join(', ')} 行设置了 BIND_IP —— ` +
    `环境变量优先级高于 config.js，会让用户的 bindIP 配置静默失效。` +
    `如需固定监听地址，应由使用者在自己 compose.yaml 的 environment 里给。`,
  )
})

test('Dockerfile 仍应保留 PORT 默认值（这是合理的部署默认，不覆盖用户配置）', () => {
  // PORT 与 BIND_IP 不同：它在本项目里同时也是"容器对外端口"的说明，
  // 且 compose 里通常会显式映射。保留它不会造成"配置静默失效"的困惑。
  const envs = activeEnvLines()
  const port = envs.find((e) => e.name === 'PORT')
  assert.ok(port, 'Dockerfile 应保留 ENV PORT 默认值')
  assert.equal(port!.value, '9527')
})

test('Dockerfile 的 ENV 解析本身要能区分注释与生效行（防止上面的断言恒真）', () => {
  // 这条是"测试的测试"：如果 activeEnvLines 把注释行也算进来，
  // 那么第一条断言在"已注释掉 BIND_IP"时也会失败，说明解析有 bug。
  const envs = activeEnvLines()
  // 我们的 Dockerfile 里 BIND_IP 现在是注释状态，解析结果不应包含它
  assert.equal(envs.some((e) => e.name === 'BIND_IP'), false)
  // 但要能解析出确实生效的 NODE_ENV / PORT
  assert.ok(envs.some((e) => e.name === 'NODE_ENV'), '应能解析出 NODE_ENV')
  assert.ok(envs.some((e) => e.name === 'PORT'), '应能解析出 PORT')
  // 且注释行里的 BIND_IP 在原文中确实存在（证明确实是"注释掉"而非删除）
  const text = fs.readFileSync(dockerfilePath, 'utf8')
  assert.match(text, /#\s*ENV\s+BIND_IP/, 'BIND_IP 应以注释形式保留，说明为何不要加回来')
})
