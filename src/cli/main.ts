/**
 * MemoryTree CLI — unified entry point.
 * Registers all subcommands via commander.
 */

import { Command } from 'commander'
import { resolve } from 'node:path'

const program = new Command()

program
  .name('memorytree')
  .description('MemoryTree — transcript import, dedup, indexing, and session continuity')
  .version('0.1.0')

// ── init ──────────────────────────────────────────────────────────────────

program
  .command('init')
  .description('Initialize MemoryTree files in a repository without registering heartbeat')
  .option('--root <path>', 'Target repository root', '.')
  .option('--project-name <name>', 'Project name', 'this project')
  .option('--goal-summary <text>', 'Initial goal summary', 'Describe the long-term project goal here.')
  .option('--locale <locale>', 'Template locale: auto, en, or zh-cn', 'auto')
  .option('--date <date>', 'Override date as YYYY-MM-DD')
  .option('--time <time>', 'Override time as HH:MM')
  .option('--skip-agents', 'Deprecated — use upgrade instead')
  .option('--force', 'Overwrite existing generated files')
  .addHelpText('after', [
    '',
    'This command only creates repository files.',
    'It does not register the repository with heartbeat or modify ~/.memorytree/config.toml.',
    '',
    'If you want the default heartbeat setup afterwards:',
    '  memorytree daemon quick-start --root .',
  ].join('\n'))
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
  .description('Upgrade repository files to MemoryTree without registering heartbeat')
  .option('--root <path>', 'Target repository root', '.')
  .option('--project-name <name>', 'Project name', 'this project')
  .option('--goal-summary <text>', 'Fallback goal summary', 'Describe the long-term project goal here.')
  .option('--locale <locale>', 'Requested locale: auto, en, or zh-cn', 'auto')
  .option('--date <date>', 'Override date as YYYY-MM-DD')
  .option('--time <time>', 'Override time as HH:MM')
  .option('--format <format>', 'Output format: text or json', 'text')
  .addHelpText('after', [
    '',
    'This command updates repository files only.',
    'It does not register the repository with heartbeat or modify ~/.memorytree/config.toml.',
    '',
    'If you want the default heartbeat setup afterwards:',
    '  memorytree daemon quick-start --root .',
  ].join('\n'))
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
  .description('Build the MemoryTree HTML report site and preview it locally when needed')
  .addHelpText('after', [
    '',
    'Local hosting guidance:',
    '  Recommended for long-running local access:',
    '    Use Caddy to host ./Memory/07_reports on your chosen port (for example 10010).',
    '  Temporary fallback preview:',
    '    memorytree report serve --dir ./Memory/07_reports --port 10010',
  ].join('\n'))

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
  .addHelpText('after', [
    '',
    'After building, keep Caddy pointed at the output directory for long-running local access.',
  ].join('\n'))
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
  .description('Temporarily serve the generated report locally (fallback when Caddy is not used)')
  .option(
    '--dir <path>',
    'Report directory to serve (default: ./Memory/07_reports)',
    './Memory/07_reports',
  )
  .option('--port <n>', 'Port to listen on (default: ~/.memorytree/config.toml report_port or 10010)')
  .addHelpText('after', [
    '',
    'Example:',
    '  memorytree report serve --dir ./Memory/07_reports --port 10010',
    '',
    'Use this for temporary preview or as a fallback. For long-running local access, prefer Caddy.',
  ].join('\n'))
  .action(async (opts) => {
    const [{ cmdReportServe }, { loadConfig, resolveReportPort }] = await Promise.all([
      import('./cmd-report.js'),
      import('../heartbeat/config.js'),
    ])
    const requestedPort = typeof opts.port === 'string' ? parseInt(opts.port, 10) : NaN
    const resolvedDir = resolve(opts.dir as string)
    const config = loadConfig()
    process.exitCode = cmdReportServe({
      dir: opts.dir as string,
      port: Number.isInteger(requestedPort) && requestedPort > 0 && requestedPort <= 65535
        ? requestedPort
        : resolveReportPort(config, resolvedDir),
    })
  })

// ── daemon ────────────────────────────────────────────────────────────────

const caddy = program
  .command('caddy')
  .description('Manage MemoryTree-owned Caddy config for long-running local report hosting')
  .addHelpText('after', [
    '',
    'Scenario examples:',
    '  Connect the current repository to Caddy:',
    '    memorytree caddy enable --root .',
    '  Check the current repository Caddy status:',
    '    memorytree caddy status --root .',
    '  Remove the current repository from MemoryTree-managed Caddy:',
    '    memorytree caddy disable --root .',
  ].join('\n'))

caddy
  .command('enable')
  .description('Write/update the current project Caddy fragment and reload Caddy')
  .option('--root <path>', 'Project root that is already registered with MemoryTree', '.')
  .action(async (opts) => {
    const { cmdCaddyEnable } = await import('./cmd-caddy.js')
    process.exitCode = await cmdCaddyEnable({
      root: opts.root,
    })
  })

caddy
  .command('disable')
  .description('Remove the current project Caddy fragment and reload Caddy')
  .option('--root <path>', 'Project root that is already registered with MemoryTree', '.')
  .action(async (opts) => {
    const { cmdCaddyDisable } = await import('./cmd-caddy.js')
    process.exitCode = await cmdCaddyDisable({
      root: opts.root,
    })
  })

caddy
  .command('status')
  .description('Show whether the current project is connected to MemoryTree-managed Caddy')
  .option('--root <path>', 'Project root that is already registered with MemoryTree', '.')
  .action(async (opts) => {
    const { cmdCaddyStatus } = await import('./cmd-caddy.js')
    process.exitCode = await cmdCaddyStatus({
      root: opts.root,
    })
  })

const daemonHelpExamples = [
  '',
  'Scenario examples:',
  '  First time on this machine:',
  '    memorytree daemon install --interval 5m --auto-push true',
  '  First time for the current repository:',
  '    memorytree daemon register --root . --quick-start',
  '  Run now without waiting:',
  '    memorytree daemon run-once --root . --force',
  '  One-command setup for the current repository:',
  '    memorytree daemon quick-start --root .',
].join('\n')

const daemon = program
  .command('daemon')
  .description('Manage the MemoryTree heartbeat lifecycle')
  .addHelpText('after', daemonHelpExamples)

daemon
  .command('install')
  .description('Register heartbeat with the OS scheduler')
  .option('--interval <interval>', 'Override heartbeat interval (e.g., "5m")')
  .option('--auto-push <bool>', 'Override auto_push setting (true/false)')
  .addHelpText('after', [
    '',
    'Example:',
    '  memorytree daemon install --interval 5m --auto-push true',
    '',
    'Use this once per machine to enable the background scheduler.',
  ].join('\n'))
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
  .option('--root <path>', 'Run only the project that matches this path')
  .option('--force', 'Run even when the project is not yet due')
  .addHelpText('after', [
    '',
    'Example:',
    '  memorytree daemon run-once --root . --force',
    '',
    'Use this when you want to sync immediately instead of waiting for the scheduler.',
  ].join('\n'))
  .action(async (opts) => {
    const { cmdRunOnce } = await import('./cmd-daemon.js')
    process.exitCode = await cmdRunOnce({
      root: opts.root,
      force: opts.force ?? false,
    })
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

daemon
  .command('quick-start')
  .description('Quick install: connect this repository to heartbeat with the shared memory branch + local cache mirror defaults')
  .option('--root <path>', 'Development directory to quick-start', '.')
  .option('--name <name>', 'Project display name')
  .addHelpText('after', [
    '',
    'Example:',
    '  memorytree daemon quick-start --root .',
    '',
    'This is the default first-time setup path when you want heartbeat for the current repository.',
    'It keeps the dedicated memorytree branch as the shared source of truth and refreshes this repository as a local cache mirror.',
    'Raw transcript mirror commits stay disabled until you explicitly approve them later.',
  ].join('\n'))
  .action(async (opts) => {
    const { cmdQuickStart } = await import('./cmd-daemon.js')
    process.exitCode = await cmdQuickStart({
      root: opts.root,
      name: opts.name,
    })
  })

daemon
  .command('register')
  .description('Advanced heartbeat setup for a repository with a dedicated MemoryTree worktree and local cache mirrors')
  .option('--root <path>', 'Development directory to register', '.')
  .option('--name <name>', 'Project display name')
  .option('--worktree <path>', 'Override the dedicated MemoryTree worktree path')
  .option('--quick-start', 'Use the recommended single-source defaults: memorytree branch, 5m heartbeat, auto_push=true, generate_report=true, raw_upload_permission=not-set')
  .option('--branch <name>', 'Detailed setup only: override the dedicated MemoryTree branch name (default: memorytree)')
  .option('--heartbeat-interval <interval>', 'Per-project heartbeat interval (e.g. 5m)')
  .option('--refresh-interval <interval>', 'Compatibility only: override the development-cache mirror sync cadence')
  .option('--auto-push <bool>', 'Per-project auto_push value (true/false)')
  .option('--generate-report <bool>', 'Per-project generate_report value (true/false)')
  .option('--report-port <n>', 'Per-project local report port')
  .option('--raw-upload-permission <perm>', 'Per-project raw transcript mirror commit permission: not-set, approved, or denied')
  .addHelpText('after', [
    '',
    'Examples:',
    '  Recommended defaults for the current repository:',
    '    memorytree daemon register --root . --quick-start',
    '  Advanced setup with custom values:',
    '    memorytree daemon register --root . --branch memorytree-docs --heartbeat-interval 10m --auto-push false --generate-report true --report-port 10010 --raw-upload-permission approved',
    '',
    'Use this command when you want to choose the branch, heartbeat cadence, auto_push, raw transcript permission, report port, or worktree path yourself.',
    'Compatibility note: --refresh-interval only tunes how often cache mirrors are copied back to the development directory.',
  ].join('\n'))
  .action(async (opts) => {
    const { cmdRegisterProject } = await import('./cmd-daemon.js')
    process.exitCode = cmdRegisterProject({
      root: opts.root,
      name: opts.name,
      worktree: opts.worktree,
      branch: opts.branch,
      quickStart: opts.quickStart ?? false,
      heartbeatInterval: opts.heartbeatInterval,
      refreshInterval: opts.refreshInterval,
      autoPush: opts.autoPush,
      generateReport: opts.generateReport,
      reportPort: opts.reportPort,
      rawUploadPermission: opts.rawUploadPermission,
    })
  })

program.parse()
