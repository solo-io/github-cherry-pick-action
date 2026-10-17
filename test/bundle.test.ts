import {describe, expect, it} from '@jest/globals'
import {spawnSync} from 'child_process'
import {mkdtempSync, writeFileSync} from 'fs'
import {tmpdir} from 'os'
import {dirname, join, resolve} from 'path'

// The unit tests import run() directly and never execute the bundle. This test
// runs the committed dist/index.js the way a workflow does, in an isolated
// environment with no git on PATH, and asserts that the action actually starts.
// (A Node 24 build once turned the `require.main === module` guard into a
// no-op, so the bundle exited 0 without doing anything; this catches that.)
describe('dist/index.js', () => {
  it('starts the action when executed as the workflow entry point', () => {
    const bundle = resolve(process.env.BUNDLE_PATH ?? 'dist/index.js')
    const scratch = mkdtempSync(join(tmpdir(), 'cherry-pick-bundle-'))
    const eventPath = join(scratch, 'event.json')
    writeFileSync(
      eventPath,
      JSON.stringify({
        pull_request: {
          number: 42,
          merged: true,
          merge_commit_sha: '0123456789abcdef0123456789abcdef01234567',
          head: {ref: 'feature'},
          base: {ref: 'main', sha: 'fedcba9876543210fedcba9876543210fedcba98'}
        }
      })
    )
    const result = spawnSync(process.execPath, [bundle], {
      cwd: scratch,
      encoding: 'utf8',
      env: {
        // only node's own directory on PATH: git is deliberately unavailable
        PATH: dirname(process.execPath),
        HOME: scratch,
        GITHUB_REPOSITORY: 'example/repo',
        GITHUB_EVENT_PATH: eventPath,
        INPUT_TOKEN: 'token',
        INPUT_COMMITTER: 'Bot <bot@example.com>',
        INPUT_AUTHOR: 'Author <author@example.com>',
        INPUT_BRANCH: 'release/v1'
      }
    })
    const output = result.stdout + result.stderr
    // the first thing run() does is announce the target branch
    expect(output).toContain('Cherry pick into branch release/v1')
    // and without git it must fail, not silently succeed
    expect(result.status).toBe(1)
    expect(output).toMatch(/::error::/)
  })
})
