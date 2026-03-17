/**
 * Translations type definition.
 */

export interface Translations {
  nav: {
    dashboard: string
    sessions: string
    projects: string
    graph: string
    goals: string
    todos: string
    knowledge: string
    archive: string
    search: string
  }
  dashboard: {
    title: string
    subtitle: string
    sessions: string
    messages: string
    toolEvents: string
    activeDays: string
    recentSessions: string
  }
  sessions: {
    title: string
    noSessions: string
    client: string
    date: string
    id: string
    msgs: string
    tools: string
    all: string
  }
  transcript: {
    aiSummary: string
    referencedBy: string
    messages: string
    noMessages: string
    client: string
    sessionId: string
    branch: string
    workingDir: string
    sha256: string
    toolEvents: string
  }
  graph: {
    title: string
    subtitle: string
    noData: string
  }
  projects: {
    title: string
    noProjects: string
    sessions: string
  }
  search: {
    title: string
    placeholder: string
    results: string
    noResults: string
  }
  common: {
    loading: string
    unknown: string
  }
}
