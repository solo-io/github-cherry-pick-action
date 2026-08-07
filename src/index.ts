import * as core from '@actions/core'
import * as exec from '@actions/exec'
import * as github from '@actions/github'
import * as io from '@actions/io'
import type {PullRequest} from '@octokit/webhooks-types'
import {createPullRequest, Inputs} from './github-helper'
import * as utils from './utils'

interface GitExecutionOptions {
  allowFailure?: boolean
  input?: Buffer
  logOutput?: boolean
}

interface GitOutput {
  stdout: Buffer
  stderr: string
  exitCode: number
}

export async function run(): Promise<void> {
  try {
    const inputs: Inputs = {
      token: core.getInput('token', {required: true}),
      committer: core.getInput('committer', {required: true}),
      author: core.getInput('author', {required: true}),
      branch: core.getInput('branch', {required: true}),
      title: core.getInput('title'),
      body: core.getInput('body'),
      force: utils.getInputAsBoolean('force'),
      labels: utils.getInputAsArray('labels'),
      inherit_labels: utils.getInputAsBoolean('inherit_labels'),
      assignees: utils.getInputAsArray('assignees'),
      reviewers: utils.getInputAsArray('reviewers'),
      teamReviewers: utils.getInputAsArray('team-reviewers'),
      cherryPickBranch: core.getInput('cherry-pick-branch')
    }

    core.setSecret(inputs.token)
    const pullRequest = github.context.payload.pull_request as
      PullRequest | undefined
    if (!pullRequest) {
      throw new Error('This action must run for a pull_request event')
    }
    if (!pullRequest.merged) {
      throw new Error(
        'The source pull request must be merged before backporting'
      )
    }

    const prBranch =
      inputs.cherryPickBranch ||
      `cherry-pick-${utils.sanitizeBranchComponent(inputs.branch)}-${pullRequest.number}`
    const sourceRef = `refs/remotes/origin/pull/${pullRequest.number}/head`
    const sourceBaseRef = `refs/remotes/origin/backport-base/${pullRequest.number}`

    await validateBranchName(inputs.branch)
    await validateBranchName(pullRequest.base.ref)
    await validateBranchName(prBranch)
    core.info(
      `Backporting pull request #${pullRequest.number} into ${inputs.branch}`
    )

    core.startGroup('Configuring Git identity and authentication')
    const parsedAuthor = utils.parseDisplayNameEmail(inputs.author)
    const parsedCommitter = utils.parseDisplayNameEmail(inputs.committer)
    await gitExecution(['config', '--local', 'user.name', parsedCommitter.name])
    await gitExecution([
      'config',
      '--local',
      'user.email',
      parsedCommitter.email
    ])
    await configureGitAuthentication(inputs.token)
    core.info(
      `Using '${parsedAuthor.name} <${parsedAuthor.email}>' as author and ` +
        `'${parsedCommitter.name} <${parsedCommitter.email}>' as committer`
    )
    core.endGroup()

    core.startGroup('Fetching the target branch and pull request')
    const shallowRepository = await gitExecution([
      'rev-parse',
      '--is-shallow-repository'
    ])
    const fetchArgs = [
      'fetch',
      '--no-tags',
      'origin',
      `+refs/heads/${inputs.branch}:refs/remotes/origin/${inputs.branch}`,
      // Keep the event's base SHA reachable while preserving its pre-merge
      // value for a strategy-independent pull request diff.
      `+refs/heads/${pullRequest.base.ref}:${sourceBaseRef}`,
      `+refs/pull/${pullRequest.number}/head:${sourceRef}`
    ]
    if (shallowRepository.stdout.toString().trim() === 'true') {
      fetchArgs.splice(2, 0, '--unshallow')
    }
    await gitExecution(fetchArgs)
    if (inputs.force) {
      await gitExecution(
        [
          'fetch',
          '--no-tags',
          'origin',
          `+refs/heads/${prBranch}:refs/remotes/origin/${prBranch}`
        ],
        {allowFailure: true}
      )
    }
    core.endGroup()

    core.startGroup(`Creating ${prBranch} from ${inputs.branch}`)
    await gitExecution([
      'checkout',
      '-b',
      prBranch,
      `refs/remotes/origin/${inputs.branch}`
    ])
    core.endGroup()

    core.startGroup('Applying the pull request changes')
    const patch = await gitExecution([
      'diff',
      '--binary',
      '--full-index',
      `${pullRequest.base.sha}...${sourceRef}`
    ])
    if (patch.stdout.length === 0) {
      throw new Error('The pull request has no changes to backport')
    }
    await gitExecution(['apply', '--3way', '--index', '--whitespace=nowarn'], {
      input: patch.stdout
    })

    const stagedChanges = await gitExecution(['diff', '--cached', '--quiet'], {
      allowFailure: true
    })
    if (stagedChanges.exitCode === 0) {
      throw new Error('Applying the pull request produced no changes')
    }
    if (stagedChanges.exitCode !== 1) {
      throw new Error(
        `Unable to inspect the staged changes: ${stagedChanges.stderr}`
      )
    }

    await gitExecution([
      'commit',
      '--author',
      `${parsedAuthor.name} <${parsedAuthor.email}>`,
      '-m',
      `Backport #${pullRequest.number}: ${pullRequest.title}`
    ])
    core.endGroup()

    core.startGroup('Pushing the backport branch')
    const pushArgs = ['push', '-u', 'origin', prBranch]
    if (inputs.force) {
      pushArgs.push('--force-with-lease')
    }
    await gitExecution(pushArgs)
    core.endGroup()

    core.startGroup('Opening the backport pull request')
    const pull = await createPullRequest(inputs, prBranch)
    core.setOutput('data', JSON.stringify(pull.data))
    core.setOutput('number', pull.data.number)
    core.setOutput('html_url', pull.data.html_url)
    core.endGroup()
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    core.setFailed(message)
  }
}

async function validateBranchName(branch: string): Promise<void> {
  await gitExecution(['check-ref-format', '--branch', branch])
}

async function configureGitAuthentication(token: string): Promise<void> {
  const serverUrl = github.context.serverUrl.replace(/\/$/, '')
  const credentials = Buffer.from(`x-access-token:${token}`).toString('base64')
  const authorization = `AUTHORIZATION: basic ${credentials}`
  core.setSecret(credentials)
  core.setSecret(authorization)
  await gitExecution([
    'config',
    '--local',
    `http.${serverUrl}/.extraheader`,
    authorization
  ])
}

async function gitExecution(
  params: string[],
  executionOptions: GitExecutionOptions = {}
): Promise<GitOutput> {
  const stdout: Buffer[] = []
  const stderr: Buffer[] = []
  const options: exec.ExecOptions = {
    ignoreReturnCode: true,
    input: executionOptions.input,
    silent: true,
    listeners: {
      stdout: (data: Buffer) => stdout.push(data),
      stderr: (data: Buffer) => stderr.push(data)
    }
  }

  const gitPath = await io.which('git', true)
  const exitCode = await exec.exec(gitPath, params, options)
  const result = {
    stdout: Buffer.concat(stdout),
    stderr: Buffer.concat(stderr).toString(),
    exitCode
  }

  if (executionOptions.logOutput) {
    const output =
      exitCode === 0 ? result.stdout.toString().trim() : result.stderr.trim()
    if (output) core.info(output)
  }

  if (exitCode !== 0 && !executionOptions.allowFailure) {
    const detail = result.stderr.trim() || result.stdout.toString().trim()
    throw new Error(
      `Git command '${params[0]}' failed with exit code ${exitCode}${
        detail ? `: ${detail}` : ''
      }`
    )
  }

  return result
}

// Do not run when imported as a module.
if (require.main === module) {
  run()
}
