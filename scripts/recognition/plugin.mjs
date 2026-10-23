/** Local-only PDF recognition API for Vite development and preview servers. */
import { createReadStream } from 'node:fs'
import { access, mkdir, open, readFile, rename, rm, stat, writeFile, realpath } from 'node:fs/promises'
import { constants } from 'node:fs'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { isAbsolute, join, relative, resolve, delimiter } from 'node:path'
import { fileURLToPath } from 'node:url'

const base = '/api/pdf-recognition'
const worker = fileURLToPath(new URL('./worker.py', import.meta.url))
const maximumBytes = 100 * 1024 * 1024
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/
const terminal = new Set(['completed', 'failed', 'cancelled'])

function send(res, code, data) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(data))
}

async function executable(name) {
  const choices = isAbsolute(name) || name.includes('/') ? [resolve(name)]
    : (process.env.PATH || '').split(delimiter).map(dir => join(dir, name))
  for (const choice of choices) {
    try {
      await access(choice, constants.X_OK)
      if ((await stat(choice)).isFile()) return choice
    } catch { /* try next configured location */ }
  }
  return undefined
}

export async function localConfiguration(root) {
  const python = await executable(process.env.TYPENOTE_PYTHON || 'python3')
  const pdfinfo = await executable('pdfinfo')
  let audiveris
  for (const choice of process.env.TYPENOTE_AUDIVERIS
    ? [process.env.TYPENOTE_AUDIVERIS]
    : [join(root, '.typenote-tools/audiveris'), '/Applications/Audiveris.app/Contents/MacOS/Audiveris', 'audiveris']) {
    audiveris = await executable(choice)
    if (audiveris) break
  }
  const missing = [!python && 'Python 3 (or set TYPENOTE_PYTHON)', !pdfinfo && 'Poppler pdfinfo on PATH',
    !audiveris && 'Audiveris (set TYPENOTE_AUDIVERIS to its executable)'].filter(Boolean)
  return { available: !missing.length,
    message: missing.length ? `Local PDF recognition requires ${missing.join('; ')}. Restart the local server after setup.`
      : 'PDF recognition is available locally. Scores stay on this computer.', python, pdfinfo, audiveris }
}

export function allowedRequest(req) {
  try {
    const host = req.headers.host
    if (typeof host !== 'string') return false
    const url = new URL(`http://${host}`)
    if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return false
    const remote = req.socket.remoteAddress
    if (remote && !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote)) return false
    const origin = req.headers.origin
    if (origin && origin !== `http://${host}` && origin !== `https://${host}`) return false
    if (req.headers['sec-fetch-site'] === 'cross-site') return false
    return true
  } catch { return false }
}

async function atomicJson(path, value) {
  const temp = `${path}.${randomUUID()}.tmp`
  await writeFile(temp, JSON.stringify(value))
  await rename(temp, path)
}

/** Exported for direct HTTP contract tests, without a Vite dependency. */
export function createRecognitionService(root) {
  const directory = resolve(root, '.typenote-imports')
  let active = null
  let closing = false

  async function load(id) {
    const path = join(directory, id, 'result.json')
    if ((await stat(path)).size > 1024 * 1024) throw new Error('Invalid job record')
    const value = JSON.parse(await readFile(path, 'utf8'))
    if (!Array.isArray(value.outputs) || !Array.isArray(value.diagnostics)) throw new Error('Invalid job record')
    // A previous server process may have stopped before it could finalize this job.
    if (!terminal.has(value.status) && active?.id !== id) {
      value.status = 'failed'
      value.message = 'The local server stopped before recognition finished. Original PDF and provider files are retained; start a new import.'
      await atomicJson(path, value)
    }
    return value
  }

  function publicJob(value) {
    return { id: value.id, status: value.status, message: String(value.message || '').slice(0, 1000),
      ...(Number.isInteger(value.pages) ? { pages: value.pages } : {}),
      diagnostics: value.diagnostics.slice(0, 100).map(line => String(line).slice(0, 500)),
      outputs: value.outputs.slice(0, 100).map(output => ({ id: String(output.id),
        name: String(output.name).slice(0, 200), ...(Number.isInteger(output.noteCount) ? { noteCount: output.noteCount } : {}) })) }
  }

  async function finalize(record, error) {
    try {
      const value = await load(record.id)
      if (record.cancelled || !terminal.has(value.status)) {
        const cancelled = record.cancelled
        value.status = cancelled ? 'cancelled' : 'failed'
        value.message = cancelled ? 'Recognition cancelled. Original PDF retained locally.'
          : 'Local recognition stopped unexpectedly. Check the provider setup and local log.'
        if (error) value.diagnostics.push('The local recognition worker could not start.')
        await atomicJson(join(record.path, 'result.json'), value)
      }
    } finally {
      if (active === record) active = null
    }
  }

  async function cancel(record) {
    record.cancelled = true
    await writeFile(join(record.path, 'cancel.requested'), '')
    // The worker handles SIGTERM and stops its provider process group before exiting.
    record.child?.kill('SIGTERM')
  }

  async function upload(req, res, url) {
    if (closing) return send(res, 503, { message: 'The local server is shutting down.' })
    if (active) return send(res, 409, { message: 'Another PDF is being recognized. Wait or cancel it before importing another.' })
    if (!/^application\/pdf(?:\s*;|$)/i.test(req.headers['content-type'] || '')) {
      return send(res, 415, { message: 'Choose a PDF file.' })
    }
    if (Number(req.headers['content-length']) > maximumBytes) {
      return send(res, 413, { message: 'PDF exceeds the 100 MiB recognition limit.' })
    }
    const pages = url.searchParams.get('pages') || ''
    if (pages.length > 1000 || (pages && !/^\s*\d+(?:\s*-\s*\d+)?(?:\s*,\s*\d+(?:\s*-\s*\d+)?)*\s*$/.test(pages))) {
      return send(res, 400, { message: 'Use page numbers and ranges, for example 1,2,4-6.' })
    }
    // Reserve before awaiting setup or disk I/O so concurrent uploads cannot both start.
    const record = { id: randomUUID(), cancelled: false }
    record.path = join(directory, record.id)
    active = record
    let handle
    try {
      const configuration = await localConfiguration(root)
      if (!configuration.available) {
        active = null
        return send(res, 503, { message: configuration.message })
      }
      await mkdir(record.path, { recursive: true, mode: 0o700 })
      handle = await open(join(record.path, 'upload.partial'), 'wx', 0o600)
      let size = 0
      let prefix = Buffer.alloc(0)
      for await (const chunk of req.iterator({ destroyOnReturn: false })) {
        size += chunk.length
        if (size > maximumBytes) {
          const error = new Error('PDF exceeds the 100 MiB recognition limit.')
          error.httpCode = 413
          throw error
        }
        if (prefix.length < 1024) prefix = Buffer.concat([prefix, chunk]).subarray(0, 1024)
        await handle.writeFile(chunk)
      }
      await handle.close()
      handle = null
      if (!prefix.includes(Buffer.from('%PDF-'))) {
        const error = new Error('This file is not a readable PDF.')
        error.httpCode = 400
        throw error
      }
      await rename(join(record.path, 'upload.partial'), join(record.path, 'original.pdf'))
      let name = 'score.pdf'
      try { name = decodeURIComponent(String(req.headers['x-typenote-filename'] || 'score.pdf')).replace(/[\x00-\x1f\x7f/\\]/g, '_').slice(0, 200) } catch { /* keep fallback */ }
      const state = { id: record.id, name, status: 'validating', message: 'Checking the PDF before local recognition.', diagnostics: [], outputs: [] }
      await atomicJson(join(record.path, 'result.json'), state)
      if (closing || record.cancelled) {
        await cancel(record)
        await finalize(record)
        return send(res, 202, { id: record.id })
      }
      const log = await open(join(record.path, 'worker.log'), 'a', 0o600)
      try {
        record.child = spawn(configuration.python, [worker, '--job', record.path,
          '--audiveris', configuration.audiveris, '--pdfinfo', configuration.pdfinfo, '--pages', pages],
        { cwd: root, stdio: ['ignore', log.fd, log.fd] })
        record.child.once('error', error => { void finalize(record, error).catch(() => {}) })
        record.child.once('exit', () => { void finalize(record).catch(() => {}) })
      } finally { await log.close() }
      send(res, 202, { id: record.id })
    } catch (error) {
      await handle?.close().catch(() => {})
      // An interrupted or excessive upload is not a valid original PDF.
      await rm(join(record.path, 'upload.partial'), { force: true }).catch(() => {})
      if (active === record) active = null
      req.resume()
      if (!res.destroyed && !res.headersSent) send(res, error.httpCode || 500, { message: error.httpCode ? error.message : 'The PDF could not be saved for local recognition.' })
    }
  }

  async function stream(res, jobPath, filename, type, downloadName, inline = false) {
    const path = await realpath(resolve(jobPath, filename))
    const within = relative(await realpath(jobPath), path)
    if (within.startsWith('..') || isAbsolute(within)) return send(res, 404, { message: 'File not found.' })
    const info = await stat(path)
    if (!info.isFile()) return send(res, 404, { message: 'File not found.' })
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': info.size, 'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff', 'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${downloadName}"` })
    const source = createReadStream(path)
    source.on('error', () => res.destroy())
    res.on('close', () => source.destroy())
    source.pipe(res)
  }

  async function handler(req, res, next = () => send(res, 404, { message: 'Not found.' })) {
    let url, pathname
    try { url = new URL(req.url || '/', 'http://localhost'); pathname = decodeURIComponent(url.pathname) }
    catch { return send(res, 400, { message: 'Invalid request path.' }) }
    if (/(?:^|[/\\])\.typenote-(?:imports|tools)(?:[/\\]|$)/.test(pathname)) {
      return send(res, 403, { message: 'Private local recognition files are available only through TypeNote’s import controls.' })
    }
    if (url.pathname !== base && !url.pathname.startsWith(`${base}/`)) return next()
    if (!allowedRequest(req)) return send(res, 403, { message: 'PDF recognition is restricted to this computer and this app’s origin.' })
    if (req.method !== 'GET' && (req.method !== 'POST' || req.headers['x-typenote-request'] !== 'pdf-import')) {
      return send(res, 403, { message: 'Use TypeNote’s PDF import controls to start or cancel recognition.' })
    }
    try {
      const route = url.pathname.slice(base.length)
      if (req.method === 'GET' && route === '/status') {
        const config = await localConfiguration(root)
        return send(res, 200, { available: config.available, message: config.message })
      }
      if (req.method === 'POST' && route === '/jobs') return await upload(req, res, url)
      const match = /^\/jobs\/([^/]+)(?:\/(cancel|original|log|outputs\/([0-9]{1,3})))?$/.exec(route)
      if (!match || !uuid.test(match[1])) return send(res, 404, { message: 'Recognition job not found.' })
      const id = match[1]
      const value = await load(id)
      const jobPath = join(directory, id)
      if (req.method === 'GET' && !match[2]) return send(res, 200, publicJob(value))
      if (req.method === 'POST' && match[2] === 'cancel') {
        if (active?.id === id && !terminal.has(value.status)) await cancel(active)
        return send(res, 200, publicJob(await load(id)))
      }
      if (req.method === 'GET' && match[2] === 'original') return await stream(res, jobPath, 'original.pdf', 'application/pdf', 'original.pdf', true)
      if (req.method === 'GET' && match[2] === 'log') return await stream(res, jobPath, 'recognition.log', 'text/plain; charset=utf-8', 'recognition.log')
      if (req.method === 'GET' && match[3] !== undefined) {
        const output = value.outputs.find(item => String(item.id) === match[3])
        if (output && typeof output.file === 'string') return await stream(res, jobPath, output.file, 'application/vnd.recordare.musicxml+xml', `score-${match[3]}.musicxml`)
      }
      return send(res, 404, { message: 'Recognition file not found.' })
    } catch (error) {
      if (!res.headersSent) send(res, error.code === 'ENOENT' ? 404 : 500, { message: error.code === 'ENOENT' ? 'Recognition job or file not found.' : 'The local recognition result could not be read.' })
      else res.destroy()
    }
  }

  return { handler, async close() { closing = true; if (active) await cancel(active).catch(() => {}) } }
}

export function pdfRecognitionPlugin() {
  function configure(server) {
    const service = createRecognitionService(server.config.root)
    server.middlewares.use((req, res, next) => { void service.handler(req, res, next) })
    server.httpServer?.once('close', () => { void service.close() })
  }
  return { name: 'typenote-local-pdf-recognition', configureServer: configure, configurePreviewServer: configure }
}
