import { spawn, SpawnOptions } from 'child_process'
import { existsSync, readFileSync } from 'fs'
import { join, sep } from 'path'
import t from 'tap'
import { fileURLToPath } from 'url'
import { globSync } from 'glob'

const { version } = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('../package.json', import.meta.url)),
    'utf8',
  ),
)
const bin = fileURLToPath(new URL('../dist/esm/bin.mjs', import.meta.url))

t.cleanSnapshot = s => s.split(version).join('{VERSION}')

interface Result {
  args: string[]
  options: SpawnOptions
  stdout: string
  stderr: string
  code: number | null
  signal: NodeJS.Signals | null
}
const run = async (args: string[], options = {}) => {
  const proc = spawn(
    process.execPath,
    ['--enable-source-maps', bin, ...args],
    options,
  )
  const out: Buffer[] = []
  const err: Buffer[] = []
  proc.stdout.on('data', c => out.push(c))
  proc.stderr.on('data', c => err.push(c))
  return new Promise<Result>(res => {
    proc.on('close', (code, signal) => {
      res({
        args,
        options,
        stdout: Buffer.concat(out).toString(),
        stderr: Buffer.concat(err).toString(),
        code,
        signal,
      })
    })
  })
}

t.test('usage', async t => {
  t.matchSnapshot(await run(['-h']), '-h shows usage')
  const res = await run([])
  t.equal(res.code, 1, 'exit with code 1 when no args')
  t.match(res.stderr, 'No patterns provided')
  t.match(res.stderr, /-h --help +Show this usage information$/m)
  const badp = await run(['--platform=glorb'])
  t.equal(badp.code, 1, 'exit with code 1 on bad platform arg')
  t.match(badp.stderr, 'Invalid value provided for --platform: "glorb"\n')
})

t.test('finds matches for a pattern', async t => {
  const cwd = t.testdir({
    a: {
      'x.y': '',
      'x.a': '',
      b: {
        'z.y': '',
        'z.a': '',
      },
    },
  })

  const files = globSync('**/*.y', { cwd })
  const res = await run(files, { cwd })
  t.match(res.stdout, `a${sep}x.y\n`)
  t.match(res.stdout, `a${sep}b${sep}z.y\n`)
})

t.test('prioritizes exact match if exists, unless --all', async t => {
  const cwd = t.testdir({
    routes: {
      '[id].tsx': '',
      'i.tsx': '',
      'd.tsx': '',
    },
  })
  const res = await run(['routes/[id].tsx'], { cwd })
  t.equal(res.stdout, `routes${sep}[id].tsx\n`)

  const all = await run(['routes/[id].tsx', '--all'], { cwd })
  t.match(all.stdout, `routes${sep}i.tsx\n`)
  t.match(all.stdout, `routes${sep}d.tsx\n`)
})

t.test('uses default pattern if none provided', async t => {
  const cwd = t.testdir({
    a: {
      'x.y': '',
      'x.a': '',
      b: {
        'z.y': '',
        'z.a': '',
      },
    },
  })

  const def = await run(['-p', '**/*.y'], { cwd })
  t.match(def.stdout, `a${sep}x.y\n`)
  t.match(def.stdout, `a${sep}b${sep}z.y\n`)

  const exp = await run(['-p', '**/*.y', '**/*.a'], { cwd })
  t.match(exp.stdout, `a${sep}x.a\n`)
  t.match(exp.stdout, `a${sep}b${sep}z.a\n`)
})

t.test('prevents command injection via -c/--cmd', async t => {
  const cwd = t.testdir({
    '$(touch injected_poc)': '',
    'normal-file.txt': '',
  })

  const injectedFile = join(cwd, 'injected_poc')
  t.equal(existsSync(injectedFile), false, 'injected file should not exist before test')

  const res = await run(['-c', 'echo', '**/*'], { cwd })
  t.equal(res.code, 0, 'command should succeed')
  t.match(res.stdout, /\$\(touch injected_poc\)/, 'filename should be echoed as literal')
  t.match(res.stdout, /normal-file\.txt/, 'normal file should be echoed')

  t.equal(existsSync(injectedFile), false, 'injected file should not exist after test (command injection prevented)')
})
