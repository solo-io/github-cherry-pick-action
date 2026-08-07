import * as core from '@actions/core'
import * as exec from '@actions/exec'
import * as github from '@actions/github'
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test
} from '@jest/globals'
import {createPullRequest} from '../src/github-helper'
import {run} from '../src/index'

const defaultInputs: Record<string, string> = {
  token: 'secret-token',
  author: 'Source Author <author@example.com>',
  committer: 'Backport Bot <bot@example.com>',
  branch: 'release/v1',
  inherit_labels: 'true'
}

let mockedInputs = {...defaultInputs}

const createdPullRequest = {
  data: {
    number: 54,
    html_url: 'https://github.com/example/repository/pull/54'
  }
}

jest.mock(
  '@actions/core',
  () => ({
    info: jest.fn(),
    warning: jest.fn(),
    setFailed: jest.fn(),
    setSecret: jest.fn(),
    startGroup: jest.fn(),
    endGroup: jest.fn(),
    getInput: jest
      .fn<(name: string) => string>()
      .mockImplementation(name => mockedInputs[name] ?? ''),
    getBooleanInput: jest
      .fn<(name: string) => boolean>()
      .mockImplementation(name => mockedInputs[name]?.toLowerCase() === 'true'),
    setOutput: jest.fn()
  }),
  {virtual: true}
)

jest.mock(
  '@actions/exec',
  () => ({
    exec: jest.fn<() => Promise<number>>()
  }),
  {virtual: true}
)

jest.mock(
  '@actions/io',
  () => ({
    which: jest.fn<() => Promise<string>>().mockResolvedValue('git')
  }),
  {virtual: true}
)

jest.mock(
  '@actions/github',
  () => ({
    context: {
      payload: {
        pull_request: {
          number: 42,
          title: 'Fix the important bug',
          merged: true,
          base: {ref: 'main', sha: 'base-sha'},
          head: {ref: 'feature/fix'},
          labels: [],
          user: {login: 'source-author'}
        }
      },
      serverUrl: 'https://github.com'
    }
  }),
  {virtual: true}
)

jest.mock('../src/github-helper', () => ({
  createPullRequest: jest.fn()
}))

function gitArguments(): string[][] {
  return jest.mocked(exec.exec).mock.calls.map(call => call[1] ?? [])
}

describe('run', () => {
  beforeEach(() => {
    mockedInputs = {...defaultInputs}
    Object.assign(github.context.payload.pull_request as object, {
      merged: true
    })
    jest
      .mocked(createPullRequest)
      .mockResolvedValue(createdPullRequest as never)
    jest
      .mocked(exec.exec)
      .mockImplementation(async (_command, args = [], options = {}) => {
        if (args[0] === 'rev-parse') {
          options.listeners?.stdout?.(Buffer.from('false\n'))
        }
        if (args[0] === 'diff' && args.includes('--binary')) {
          options.listeners?.stdout?.(Buffer.from('binary patch contents'))
        }
        if (args[0] === 'diff' && args.includes('--cached')) return 1
        return 0
      })
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  test('applies the complete PR diff and pushes a valid default branch', async () => {
    await run()

    const branch = 'cherry-pick-release-v1-42'
    expect(gitArguments()).toEqual([
      ['check-ref-format', '--branch', 'release/v1'],
      ['check-ref-format', '--branch', 'main'],
      ['check-ref-format', '--branch', branch],
      ['config', '--local', 'user.name', 'Backport Bot'],
      ['config', '--local', 'user.email', 'bot@example.com'],
      [
        'config',
        '--local',
        'http.https://github.com/.extraheader',
        expect.stringMatching(/^AUTHORIZATION: basic /)
      ],
      ['rev-parse', '--is-shallow-repository'],
      [
        'fetch',
        '--no-tags',
        'origin',
        '+refs/heads/release/v1:refs/remotes/origin/release/v1',
        '+refs/heads/main:refs/remotes/origin/backport-base/42',
        '+refs/pull/42/head:refs/remotes/origin/pull/42/head'
      ],
      ['checkout', '-b', branch, 'refs/remotes/origin/release/v1'],
      [
        'diff',
        '--binary',
        '--full-index',
        'base-sha...refs/remotes/origin/pull/42/head'
      ],
      ['apply', '--3way', '--index', '--whitespace=nowarn'],
      ['diff', '--cached', '--quiet'],
      [
        'commit',
        '--author',
        'Source Author <author@example.com>',
        '-m',
        'Backport #42: Fix the important bug'
      ],
      ['push', '-u', 'origin', branch]
    ])

    const applyCall = jest
      .mocked(exec.exec)
      .mock.calls.find(call => call[1]?.[0] === 'apply')
    expect(applyCall?.[2]?.input?.toString()).toBe('binary patch contents')
    expect(createPullRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        branch: 'release/v1',
        teamReviewers: [],
        inherit_labels: true
      }),
      branch
    )
    expect(core.setOutput).toHaveBeenCalledWith('number', 54)
    expect(core.setOutput).toHaveBeenCalledWith(
      'html_url',
      createdPullRequest.data.html_url
    )
    expect(core.setFailed).not.toHaveBeenCalled()
  })

  test('honors custom branch, team reviewers, and force-with-lease', async () => {
    mockedInputs['cherry-pick-branch'] = 'backport/custom'
    mockedInputs['team-reviewers'] = 'release-team,security-team'
    mockedInputs.force = 'true'

    await run()

    expect(gitArguments()).toContainEqual([
      'fetch',
      '--no-tags',
      'origin',
      '+refs/heads/backport/custom:refs/remotes/origin/backport/custom'
    ])
    expect(gitArguments()).toContainEqual([
      'push',
      '-u',
      'origin',
      'backport/custom',
      '--force-with-lease'
    ])
    expect(createPullRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        teamReviewers: ['release-team', 'security-team'],
        force: true
      }),
      'backport/custom'
    )
  })

  test('fails safely when the patch cannot be applied', async () => {
    jest
      .mocked(exec.exec)
      .mockImplementation(async (_command, args = [], options = {}) => {
        if (args[0] === 'rev-parse') {
          options.listeners?.stdout?.(Buffer.from('false\n'))
        }
        if (args[0] === 'diff' && args.includes('--binary')) {
          options.listeners?.stdout?.(Buffer.from('conflicting patch'))
        }
        if (args[0] === 'apply') {
          options.listeners?.stderr?.(Buffer.from('patch does not apply'))
          return 1
        }
        return 0
      })

    await run()

    expect(core.setFailed).toHaveBeenCalledWith(
      expect.stringContaining("Git command 'apply' failed")
    )
    expect(gitArguments().some(args => args[0] === 'commit')).toBe(false)
    expect(gitArguments().some(args => args[0] === 'push')).toBe(false)
    expect(createPullRequest).not.toHaveBeenCalled()
  })

  test('rejects events for pull requests that were not merged', async () => {
    Object.assign(github.context.payload.pull_request as object, {
      merged: false
    })

    await run()

    expect(core.setFailed).toHaveBeenCalledWith(
      'The source pull request must be merged before backporting'
    )
    expect(exec.exec).not.toHaveBeenCalled()
    expect(createPullRequest).not.toHaveBeenCalled()
  })
})
