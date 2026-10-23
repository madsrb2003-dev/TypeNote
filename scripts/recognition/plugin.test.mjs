import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { createRecognitionService, allowedRequest } from './plugin.mjs'

const score = '<score-partwise><part-list/><part id="P1"><measure number="1"><note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><notations><unknown keep="yes"/></notations></note></measure></part></score-partwise>'

function pdf() {
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] >>']
  let result = '%PDF-1.4\n'
  const offsets = []
  for (const [index, body] of objects.entries()) {
    offsets.push(Buffer.byteLength(result))
    result += `${index + 1} 0 obj\n${body}\nendobj\n`
  }
  const xref = Buffer.byteLength(result)
  result += 'xref\n0 4\n0000000000 65535 f \n'
  result += offsets.map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')
  return Buffer.from(result + `trailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`)
}

test('local request protection rejects remote hosts, clients, origins and cross-site requests', () => {
  const request = (headers = {}, remoteAddress = '127.0.0.1') => ({ headers: { host: 'localhost:5173', ...headers }, socket: { remoteAddress } })
  assert.equal(allowedRequest(request()), true)
  assert.equal(allowedRequest(request({ origin: 'http://localhost:5173' })), true)
  for (const req of [request({ host: 'evil.example' }), request({ origin: 'http://evil.example' }),
    request({ origin: 'null' }), request({ 'sec-fetch-site': 'cross-site' }), request({}, '192.168.1.2')]) {
    assert.equal(allowedRequest(req), false)
  }
})

test('HTTP PDF jobs preserve scores and original, enforce security and cancel local recognition', { timeout: 30000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'typenote-recognition-'))
  const previous = process.env.TYPENOTE_AUDIVERIS
  const provider = join(root, 'synthetic-provider')
  process.env.TYPENOTE_AUDIVERIS = provider
  let service = createRecognitionService(root)
  const server = createServer((req, res) => { void service.handler(req, res) })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = `http://127.0.0.1:${server.address().port}/api/pdf-recognition`
  t.after(async () => {
    await service.close()
    await new Promise(resolve => server.close(resolve))
    if (previous === undefined) delete process.env.TYPENOTE_AUDIVERIS
    else process.env.TYPENOTE_AUDIVERIS = previous
    await rm(root, { recursive: true, force: true })
  })
  async function setProvider({ fail = false, slow = false } = {}) {
    await writeFile(provider, '#!/usr/bin/env python3\nfrom pathlib import Path\nimport sys,time\n' +
      "output = Path(sys.argv[sys.argv.index('-output') + 1])\n" +
      `score = ${JSON.stringify(score)}\n` +
      "(output / 'first.xml').write_text(score)\n(output / 'second.xml').write_text(score.replace('C</step>', 'D</step>'))\n" +
      "print('WARN private OCR score title', flush=True)\n" +
      (slow ? 'time.sleep(60)\n' : '') + (fail ? 'sys.exit(2)\n' : ''), { mode: 0o755 })
  }
  const headers = { 'Content-Type': 'application/pdf', 'X-TypeNote-Request': 'pdf-import', 'X-TypeNote-Filename': encodeURIComponent('synthetic score.pdf') }
  const submit = (body = pdf(), extra = {}) => fetch(`${address}/jobs`, { method: 'POST', headers: { ...headers, ...extra }, body })
  const status = id => fetch(`${address}/jobs/${id}`).then(res => res.json())
  async function finished(id) {
    for (let index = 0; index < 150; index++) {
      const value = await status(id)
      if (['completed', 'failed', 'cancelled'].includes(value.status)) return value
      await delay(50)
    }
    throw new Error('Job did not finish')
  }

  await setProvider()
  assert.equal((await fetch(`${address}/status`).then(res => res.json())).available, true)
  const hostRoot = address.replace('/api/pdf-recognition', '')
  for (const path of ['/.typenote-imports/private/original.pdf', '/@fs/tmp/repo/.typenote-tools/audiveris', '/%2Etypenote-imports/private.pdf']) {
    assert.equal((await fetch(hostRoot + path)).status, 403)
  }
  assert.equal((await submit(pdf(), { Origin: 'http://evil.example' })).status, 403)
  assert.equal((await submit(pdf(), { 'X-TypeNote-Request': '' })).status, 403)
  assert.equal((await submit(pdf(), { 'Content-Type': 'text/plain' })).status, 415)
  assert.equal((await submit(Buffer.from('not pdf'))).status, 400)
  assert.equal((await fetch(`${address}/jobs?pages=1;bad`, { method: 'POST', headers, body: pdf() })).status, 400)
  const started = await submit()
  assert.equal(started.status, 202)
  const { id } = await started.json()
  const job = await finished(id)
  assert.equal(job.status, 'completed')
  assert.equal(job.pages, 1)
  assert.equal(job.outputs.length, 2)
  assert.equal(job.outputs[0].noteCount, 1)
  assert.equal(JSON.stringify(job).includes('private OCR'), false)
  assert.equal(await fetch(`${address}/jobs/${id}/outputs/0`).then(res => res.text()), score)
  assert.match(await fetch(`${address}/jobs/${id}/outputs/1`).then(res => res.text()), /D<\/step>/)
  const original = await fetch(`${address}/jobs/${id}/original`)
  assert.equal(original.headers.get('content-disposition'), 'inline; filename="original.pdf"')
  assert.deepEqual(Buffer.from(await original.arrayBuffer()), pdf())
  assert.match(await fetch(`${address}/jobs/${id}/log`).then(res => res.text()), /private OCR/)
  assert.equal((await fetch(`${address}/jobs/${id}/outputs/../../original.pdf`)).status, 404)
  assert.equal((await fetch(`${address}/jobs/not-a-uuid`)).status, 404)

  // Completed jobs and files remain available after a service restart.
  await service.close()
  service = createRecognitionService(root)
  assert.equal((await status(id)).status, 'completed')
  assert.equal(await fetch(`${address}/jobs/${id}/outputs/0`).then(res => res.text()), score)

  await setProvider({ fail: true })
  const failedId = (await (await submit()).json()).id
  const failed = await finished(failedId)
  assert.equal(failed.status, 'failed')
  assert.equal(failed.outputs.length, 2)

  // Invalid page selections fail before launching the provider.
  const invalid = await fetch(`${address}/jobs?pages=2`, { method: 'POST', headers, body: pdf() }).then(res => res.json())
  assert.match((await finished(invalid.id)).message, /within 1/)
  const malformed = (await (await submit(Buffer.from('%PDF-1.4\nnot a valid document'))).json()).id
  assert.equal((await finished(malformed)).status, 'failed')

  await setProvider({ slow: true })
  const slowId = (await (await submit()).json()).id
  for (let index = 0; index < 100 && (await status(slowId)).status !== 'recognizing'; index++) await delay(20)
  assert.equal((await submit()).status, 409)
  assert.equal((await fetch(`${address}/jobs/${slowId}/cancel`, { method: 'POST', headers })).status, 200)
  assert.equal((await finished(slowId)).status, 'cancelled')

  // A stale unfinished job is reported explicitly after restart, never as success.
  const staleId = randomUUID()
  const stalePath = join(root, '.typenote-imports', staleId)
  await mkdir(stalePath)
  await writeFile(join(stalePath, 'result.json'), JSON.stringify({ id: staleId, status: 'recognizing', outputs: [], diagnostics: [] }))
  assert.equal((await status(staleId)).status, 'failed')

  // Even a modified job record cannot serve files outside its own directory.
  const secret = join(root, 'private.xml')
  await writeFile(secret, 'private')
  await symlink(secret, join(stalePath, 'escape.xml'))
  const value = { id: staleId, status: 'completed', diagnostics: [], outputs: [{ id: '0', name: 'escape', file: 'escape.xml' }] }
  await writeFile(join(stalePath, 'result.json'), JSON.stringify(value))
  assert.equal((await fetch(`${address}/jobs/${staleId}/outputs/0`)).status, 404)

  // Executable discovery can succeed while its shebang interpreter is missing.
  // A spawn error must finalize the job rather than crash the local server.
  const brokenPython = join(root, 'broken-python')
  await writeFile(brokenPython, '#!/missing/typenote-test-interpreter\n', { mode: 0o755 })
  const previousPython = process.env.TYPENOTE_PYTHON
  process.env.TYPENOTE_PYTHON = brokenPython
  try {
    const brokenId = (await (await submit()).json()).id
    assert.equal((await finished(brokenId)).status, 'failed')
    assert.equal((await fetch(`${address}/status`)).status, 200)
  } finally {
    if (previousPython === undefined) delete process.env.TYPENOTE_PYTHON
    else process.env.TYPENOTE_PYTHON = previousPython
  }
})
