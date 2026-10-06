import { ADMIN_PASSWORD } from './fixture.mjs'

/** 极简 HTTP 客户端：自动带 cookie、管理员头、用户 token 头 */
export function createClient({ baseUrl }) {
  const cookies = new Map()

  const storeCookies = (res) => {
    const raw = res.headers.getSetCookie?.() ?? []
    for (const line of raw) {
      const [pair] = line.split(';')
      const idx = pair.indexOf('=')
      if (idx < 1) continue
      cookies.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim())
    }
  }

  const cookieHeader = () => [...cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ')

  async function request(method, url, { json, form, headers = {}, raw = false, auth = 'auto' } = {}) {
    const finalHeaders = { ...headers }
    let body
    if (json !== undefined) {
      body = JSON.stringify(json)
      finalHeaders['Content-Type'] = 'application/json'
    } else if (form !== undefined) {
      body = new URLSearchParams(form).toString()
      finalHeaders['Content-Type'] = 'application/x-www-form-urlencoded'
    }
    if (auth === 'admin') finalHeaders['x-frontend-auth'] = ADMIN_PASSWORD
    else if (auth === 'none') { /* 故意不带任何鉴权 */ }
    else if (auth === 'token') finalHeaders['x-user-token'] = cookies.get('smoke_token') ?? ''
    else if (auth === 'noheader') { /* auto 但跳过 cookie */ }
    if (finalHeaders['x-user-token'] === undefined && auth === 'token') delete finalHeaders['x-user-token']

    const res = await fetch(url, {
      method,
      headers: finalHeaders,
      body,
      redirect: 'manual',
      signal: AbortSignal.timeout(30000),
    })
    storeCookies(res)
    const text = await res.text()
    let parsed
    const contentType = res.headers.get('content-type') || ''
    if (/json/.test(contentType)) {
      try { parsed = JSON.parse(text) } catch { parsed = null }
    } else {
      try { parsed = JSON.parse(text) } catch { parsed = null }
    }
    return {
      status: res.status,
      headers: res.headers,
      text,
      json: parsed,
      body: raw ? text : (parsed ?? text),
      location: res.headers.get('location'),
    }
  }

  const self = {
    cookies,
    baseUrl,
    setToken(token) { cookies.set('smoke_token', token) },
    get: (p, o) => request('GET', baseUrl + p, o),
    post: (p, o) => request('POST', baseUrl + p, o),
    put: (p, o) => request('PUT', baseUrl + p, o),
    del: (p, o) => request('DELETE', baseUrl + p, o),
    request,
  }
  return self
}

export function assert(cond, message) {
  if (!cond) throw new Error(message)
}

export function assertStatus(res, expected, what) {
  const list = Array.isArray(expected) ? expected : [expected]
  if (!list.includes(res.status)) {
    const snippet = String(res.text ?? '').slice(0, 200)
    throw new Error(`${what}: 期望状态 ${list.join('/')}，实际 ${res.status}；响应片段: ${snippet}`)
  }
}
