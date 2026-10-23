const VALUE_FLAGS = new Set(['cash', 'codes', 'poll', 'from'])

export function parseArgs(argv) {
  const positional = []
  const flags = {}
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (!arg.startsWith('--')) {
      positional.push(arg)
      continue
    }
    const [key, inline] = arg.slice(2).split('=')
    if (inline !== undefined) {
      flags[key] = inline === 'true' ? true : inline === 'false' ? false : inline
    } else if (VALUE_FLAGS.has(key) && i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
      flags[key] = argv[++i]
    } else {
      flags[key] = true
    }
  }
  return { positional, flags }
}
