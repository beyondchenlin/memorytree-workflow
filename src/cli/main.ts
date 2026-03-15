import { Command } from 'commander'

const program = new Command()

program
  .name('memorytree')
  .description('MemoryTree — transcript import, dedup, indexing, and session continuity')
  .version('0.1.0')

program.parse()
