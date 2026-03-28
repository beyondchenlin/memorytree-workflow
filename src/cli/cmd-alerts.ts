import { clearAlerts, formatAlertsForDisplay, readAlerts } from '../heartbeat/alert.js'

export interface AlertsReport {
  readonly alerts: ReturnType<typeof readAlerts>
  readonly count: number
  readonly cleared: boolean
}

export function cmdAlerts(options: { format?: string; clear?: boolean } = {}): number {
  const report = buildAlertsReport(options)
  const format = (options.format ?? 'text').trim().toLowerCase()

  if (format === 'json') {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
    return 0
  }

  if (report.count === 0) {
    process.stdout.write('No pending alerts.\n')
    return 0
  }

  process.stdout.write('Pending alerts:\n')
  process.stdout.write(`${formatAlertsForDisplay(report.alerts)}\n`)
  process.stdout.write(report.cleared ? 'Displayed alerts have been cleared.\n' : 'Alerts kept on disk.\n')
  return 0
}

export function buildAlertsReport(options: { clear?: boolean } = {}): AlertsReport {
  const alerts = [...readAlerts()]
  const clear = options.clear ?? true
  const cleared = clear && alerts.length > 0

  if (cleared) {
    clearAlerts()
  }

  return {
    alerts,
    count: alerts.length,
    cleared,
  }
}
