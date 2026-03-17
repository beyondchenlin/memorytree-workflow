/**
 * MemoryTree CLI — unified entry point.
 * Registers all subcommands via commander.
 */

import { Command } from 'commander'

const program = new Command()

program
  .name('memorytree')
  .description('MemoryTree — transcript import, dedup, indexing, and session continuity')
  .version('0.1.0')

// ── init ──────────────────────────────────────────────────────────────────

program
  .command('init')
  .description('Initialize a MemoryTree workspace in a repository')
  .option('--root <path>', 'Target repository root', '.')
  .option('--project-name <name>', 'Project name', 'this project')
  .option('--goal-summary <text>', 'Initial goal summary', 'Describe the long-term project goal here.')
  .option('--locale <locale>', 'Template locale: auto, en, or zh-cn', 'auto')
  .option('--date <date>', 'Override date as YYYY-MM-DD')
  .option('--time <time>', 'Override time as HH:MM')
  .option('--skip-agents', 'Deprecated — use upgrade instead')
  .option('--force', 'Overwrite existing generated files')
  .action(async (opts) => {
    const { cmdInit } = await import('./cmd-init.js')
    process.exitCode = cmdInit({
      root: opts.root,
      projectName: opts.projectName,
      goalSummary: opts.goalSummary,
      locale: opts.locale,
      date: opts.date ?? '',
      time: opts.time ?? '',
      skipAgents: opts.skipAgents ?? false,
      force: opts.force ?? false,
    })
  })

// ── upgrade ───────────────────────────────────────────────────────────────

program
  .command('upgrade')
  .description('Upgrade a repository to MemoryTree without overwriting existing policy')
  .option('--root <path>', 'Target repository root', '.')
  .option('--project-name <name>', 'Project name', 'this project')
  .option('--goal-summary <text>', 'Fallback goal summary', 'Describe the long-term project goal here.')
  .option('--locale <locale>', 'Requested locale: auto, en, or zh-cn', 'auto')
  .option('--date <date>', 'Override date as YYYY-MM-DD')
  .option('--time <time>', 'Override time as HH:MM')
  .option('--format <format>', 'Output format: text or json', 'text')
  .action(async (opts) => {
    const { cmdUpgrade } = await import('./cmd-upgrade.js')
    process.exitCode = cmdUpgrade({
      root: opts.root,
      projectName: opts.projectName,
      goalSummary: opts.goalSummary,
      locale: opts.locale,
      date: opts.date ?? '',
      time: opts.time ?? '',
      format: opts.format,
    })
  })

// ── import ────────────────────────────────────────────────────────────────

program
  .command('import')
  .description('Import one local transcript into MemoryTree archives')
  .requiredOption('--source <path>', 'Raw transcript source file path')
  .option('--root <path>', 'Target repository root', '.')
  .option('--client <client>', 'Transcript client: auto, codex, claude, gemini, doubao', 'auto')
  .option('--project-name <name>', 'Project label', '')
  .option('--global-root <path>', 'Override global transcript root')
  .option('--raw-upload-permission <perm>', 'Permission: not-set, approved, denied', 'not-set')
  .option('--format <format>', 'Output format: text or json', 'text')
  .option('--force-repo', 'Force writing to repo Memory/ (use for external imports like doubao)', false)
  .action(async (opts) => {
    const { cmdImport } = await import('./cmd-import.js')
    process.exitCode = await cmdImport({
      root: opts.root,
      source: opts.source,
      client: opts.client,
      projectName: opts.projectName,
      globalRoot: opts.globalRoot ?? '',
      rawUploadPermission: opts.rawUploadPermission,
      format: opts.format,
      forceRepo: opts.forceRepo ?? false,
    })
  })

// ── discover ──────────────────────────────────────────────────────────────

program
  .command('discover')
  .description('Discover and import local AI transcripts')
  .option('--root <path>', 'Target repository root', '.')
  .option('--client <client>', 'Client filter: all, codex, claude, gemini', 'all')
  .option('--scope <scope>', 'Scope: current-project or all-projects', 'all-projects')
  .option('--project-name <name>', 'Project label', '')
  .option('--global-root <path>', 'Override global transcript root')
  .option('--raw-upload-permission <perm>', 'Permission: not-set, approved, denied', 'not-set')
  .option('--limit <n>', 'Limit discovered sources', '0')
  .option('--format <format>', 'Output format: text or json', 'text')
  .action(async (opts) => {
    const { cmdDiscover } = await import('./cmd-discover.js')
    process.exitCode = await cmdDiscover({
      root: opts.root,
      client: opts.client,
      scope: opts.scope,
      projectName: opts.projectName,
      globalRoot: opts.globalRoot ?? '',
      rawUploadPermission: opts.rawUploadPermission,
      limit: parseInt(opts.limit, 10) || 0,
      format: opts.format,
    })
  })

// ── locale ────────────────────────────────────────────────────────────────

program
  .command('locale')
  .description('Detect the effective locale for a repository')
  .option('--root <path>', 'Target repository root', '.')
  .option('--locale <locale>', 'Requested locale value', 'auto')
  .option('--format <format>', 'Output format: text or json', 'text')
  .action(async (opts) => {
    const { cmdLocale } = await import('./cmd-locale.js')
    process.exitCode = cmdLocale({
      root: opts.root,
      locale: opts.locale,
      format: opts.format,
    })
  })

// ── recall ────────────────────────────────────────────────────────────────

program
  .command('recall')
  .description('On-demand transcript sync and latest session recall')
  .option('--root <path>', 'Target repository root', '.')
  .option('--project-name <name>', 'Project label', '')
  .option('--global-root <path>', 'Override global transcript root')
  .option('--activation-time <time>', 'ISO timestamp of session activation')
  .option('--format <format>', 'Output format: text or json', 'text')
  .action(async (opts) => {
    const { cmdRecall } = await import('./cmd-recall.js')
    process.exitCode = await cmdRecall({
      root: opts.root,
      projectName: opts.projectName,
      globalRoot: opts.globalRoot ?? '',
      activationTime: opts.activationTime ?? '',
      format: opts.format,
    })
  })

// ── report ────────────────────────────────────────────────────────────────

const report = program
  .command('report')
  .description('Generate or serve the MemoryTree HTML report website')

report
  .command('build')
  .description('Build a self-contained HTML report website from Memory/')
  .option('--root <path>', 'Repository root (must contain Memory/)', '.')
  .option(
    '--output <path>',
    'Output directory (default: <root>/Memory/07_reports)',
    '',
  )
  .option('--no-ai', 'Disable AI-generated session summaries')
  .option(
    '--model <model>',
    'Claude model for AI summaries',
    'claude-haiku-4-5-20251001',
  )
  .option('--locale <locale>', 'Report locale: en or zh-CN', '')
  .option('--report-base-url <url>', 'Absolute base URL for RSS and OG meta (e.g. https://memory.example.com)', '')
  .action(async (opts) => {
    const { cmdReportBuild } = await import('./cmd-report.js')
    const root = opts.root as string
    const rawOutput = opts.output as string
    const output = rawOutput || `${root}/Memory/07_reports`
    // Commander's --no-ai sets opts.ai = false
    const noAi = opts.ai === false
    const buildOpts = {
      root,
      output,
      noAi,
      model: opts.model as string,
      ...((opts.locale as string) ? { locale: opts.locale as string } : {}),
      ...((opts.reportBaseUrl as string) ? { reportBaseUrl: opts.reportBaseUrl as string } : {}),
    }
    process.exitCode = await cmdReportBuild(buildOpts)
  })

report
  .command('serve')
  .description('Serve the generated report website on a local HTTP server')
  .option(
    '--dir <path>',
    'Report directory to serve (default: ./Memory/07_reports)',
    './Memory/07_reports',
  )
  .option('--port <n>', 'Port to listen on', '4321')
  .action(async (opts) => {
    const { cmdReportServe } = await import('./cmd-report.js')
    process.exitCode = cmdReportServe({
      dir: opts.dir as string,
      port: parseInt(opts.port as string, 10) || 4321,
    })
  })

// ── daemon ────────────────────────────────────────────────────────────────

const daemon = program
  .command('daemon')
  .description('Manage the MemoryTree heartbeat lifecycle')

daemon
  .command('install')
  .description('Register heartbeat with the OS scheduler')
  .option('--interval <interval>', 'Override heartbeat interval (e.g., "5m")')
  .option('--auto-push <bool>', 'Override auto_push setting (true/false)')
  .action(async (opts) => {
    const { cmdInstall } = await import('./cmd-daemon.js')
    process.exitCode = cmdInstall({
      interval: opts.interval,
      autoPush: opts.autoPush,
    })
  })

daemon
  .command('uninstall')
  .description('Remove the heartbeat scheduled task')
  .action(async () => {
    const { cmdUninstall } = await import('./cmd-daemon.js')
    process.exitCode = cmdUninstall()
  })

daemon
  .command('run-once')
  .description('Execute a single heartbeat cycle now')
  .action(async () => {
    const { cmdRunOnce } = await import('./cmd-daemon.js')
    process.exitCode = await cmdRunOnce()
  })

daemon
  .command('watch')
  .description('Continuous heartbeat loop (development only)')
  .option('--interval <interval>', 'Override interval')
  .action(async (opts) => {
    const { cmdWatch } = await import('./cmd-daemon.js')
    process.exitCode = await cmdWatch({ interval: opts.interval })
  })

daemon
  .command('status')
  .description('Show heartbeat registration and lock state')
  .action(async () => {
    const { cmdStatus } = await import('./cmd-daemon.js')
    process.exitCode = cmdStatus()
  })

program.parse()
