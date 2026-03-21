/**
 * CLI adapters for `memorytree report build` and `memorytree report serve`.
 */

import { createServer } from 'node:http'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { extname, join, resolve, sep } from 'node:path'
import { collectExtraManifestDirs as collectRegisteredProjectManifestDirs } from '../report/extra-manifests.js'

// ---------------------------------------------------------------------------
// Build command
// ---------------------------------------------------------------------------

export interface CmdReportBuildOptions {
  root: string
  output: string
  noAi: boolean
  model: string
  locale?: string
  reportBaseUrl?: string
}

export async function cmdReportBuild(opts: CmdReportBuildOptions): Promise<number> {
  const { buildReport } = await import('../report/build.js')
  try {
    const resolvedRoot = resolve(opts.root)
    const buildOptions = {
      root: resolvedRoot,
      output: resolve(opts.output),
      noAi: opts.noAi,
      model: opts.model,
      ...(opts.locale ? { locale: opts.locale } : {}),
      ...(opts.reportBaseUrl ? { reportBaseUrl: opts.reportBaseUrl } : {}),
      extraManifestDirs: collectRegisteredProjectManifestDirs(resolvedRoot),
    }
    await buildReport(buildOptions)
    console.log(`Report generated at: ${resolve(opts.output)}`)
    console.log(`Open: ${join(resolve(opts.output), 'index.html')}`)
    return 0
  } catch (err: unknown) {
    console.error(`Report build failed: ${String(err)}`)
    return 1
  }
}

export function collectExtraManifestDirs(root: string): string[] {
  return collectRegisteredProjectManifestDirs(root)
}

// ---------------------------------------------------------------------------
// Serve command
// ---------------------------------------------------------------------------

export interface CmdReportServeOptions {
  dir: string
  port: number
}

export function cmdReportServe(opts: CmdReportServeOptions): number {
  const root = resolve(opts.dir)
  const port = opts.port

  const MIME: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.json': 'application/json',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
  }

  const server = createServer((req, res) => {
    let urlPath: string
    try {
      urlPath = decodeURIComponent((req.url ?? '/').split('?')[0] ?? '/')
    } catch {
      res.writeHead(400, { 'Content-Type': 'text/plain' })
      res.end('Bad request')
      return
    }

    let filePath = join(root, urlPath)

    // Containment check: reject paths that escape the serve root
    // Use sep (\ on Windows, / on Unix) so the check works cross-platform.
    if (!filePath.startsWith(root + sep) && filePath !== root) {
      res.writeHead(403, { 'Content-Type': 'text/plain' })
      res.end('Forbidden')
      return
    }

    // Serve index.html for directory requests
    if (existsSync(filePath) && statSync(filePath).isDirectory()) {
      filePath = join(filePath, 'index.html')
    }

    if (!existsSync(filePath)) {
      res.writeHead(404, { 'Content-Type': 'text/plain' })
      res.end('Not found')
      return
    }

    const ext = extname(filePath)
    const contentType = MIME[ext] ?? 'application/octet-stream'
    res.writeHead(200, { 'Content-Type': contentType })
    const stream = createReadStream(filePath)
    stream.on('error', () => { res.destroy() })
    stream.pipe(res)
  })

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`Error: port ${port} is already in use.`)
      process.exit(1)
    }
    console.error(`Server error: ${String(err)}`)
    process.exit(1)
  })

  server.listen(port, () => {
    console.log('Temporary local preview server started.')
    console.log('For long-running local access, prefer Caddy hosting this directory.')
    console.log(`Serving ${root}`)
    console.log(`Open: http://localhost:${port}/`)
    console.log('Press Ctrl+C to stop.')
  })

  return 0
}
