/**
 * Transcript module — barrel re-export of all public APIs.
 */

// Types
export type { Client, TranscriptMessage, TranscriptToolEvent, ParsedTranscript, ManifestEntry } from '../types/transcript.js'

// Constants
export {
  CLIENTS,
  TEXT_BLOCK_TYPES,
  SKIP_BLOCK_TYPES,
  TOOL_USE_TYPES,
  TOOL_RESULT_TYPES,
} from './common.js'

// Common utilities
export {
  slugify,
  sha256File,
  contentHash,
  normalizeTimestamp,
  earliestTimestamp,
  parseIsoTimestamp,
  timestampPartition,
  joinParagraphs,
  summarizeValue,
  truncate,
  yamlEscape,
  ensureDict,
  ensureList,
  getNested,
  loadJsonl,
  loadJson,
  extractTextBlocks,
  extractSimpleText,
  extractGeminiText,
  extractGeminiParts,
  findFirstMappingWithKeys,
  deduplicateMessages,
  deduplicateToolEvents,
} from './common.js'

// Parsing
export {
  inferClient,
  parseTranscript,
  parseCodexTranscript,
  parseClaudeTranscript,
  parseGeminiTranscript,
} from './parse.js'

// Database
export { upsertSearchIndex } from './db.js'

// Discovery
export {
  defaultGlobalTranscriptRoot,
  defaultClientRoots,
  discoverSourceFiles,
  inferProjectSlug,
  transcriptMatchesRepo,
  projectSlugsMatch,
  safeFileMtime,
} from './discover.js'

// Import
export {
  importTranscript,
  transcriptHasContent,
  writeCleanMarkdown,
  preserveExistingImportTimestamp,
  manifestSignature,
  manifestChanged,
  writeJson,
  appendJsonl,
  copyFile,
} from './import.js'
