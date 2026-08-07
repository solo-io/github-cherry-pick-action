import * as core from '@actions/core'
import * as github from '@actions/github'
import {afterAll, beforeEach, describe, expect, jest, test} from '@jest/globals'
import {createPullRequest, Inputs} from '../src/github-helper'

jest.mock(
  '@actions/core',
  () => ({
    info: jest.fn(),
    warning: jest.fn()
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
          title: 'Original title',
          body: 'Original body',
          labels: [{name: 'bug'}, {name: 'release/v1'}],
          user: {login: 'source-author'}
        }
      }
    },
    getOctokit: jest.fn()
  }),
  {virtual: true}
)

const originalRepository = process.env.GITHUB_REPOSITORY

const defaultInputs: Inputs = {
  token: 'token',
  committer: 'Bot <bot@example.com>',
  author: 'Author <author@example.com>',
  branch: 'release/v1',
  title: '{old_title} / {old_title}',
  body: 'Backport #{old_pull_request_id} ({old_pull_request_id})',
  labels: ['maintenance', 'bug'],
  inherit_labels: true,
  assignees: ['maintainer'],
  reviewers: ['source-author', 'reviewer'],
  teamReviewers: ['release-team']
}

describe('createPullRequest', () => {
  const create = jest
    .fn<
      (args: unknown) => Promise<{
        data: {number: number; html_url: string}
      }>
    >()
    .mockResolvedValue({
      data: {number: 99, html_url: 'https://github.com/example/repo/pull/99'}
    })
  const addLabels = jest
    .fn<(args: unknown) => Promise<object>>()
    .mockResolvedValue({})
  const addAssignees = jest
    .fn<(args: unknown) => Promise<object>>()
    .mockResolvedValue({})
  const requestReviewers = jest
    .fn<(args: unknown) => Promise<object>>()
    .mockResolvedValue({})

  beforeEach(() => {
    jest.clearAllMocks()
    process.env.GITHUB_REPOSITORY = 'example/repo'
    jest.mocked(github.getOctokit).mockReturnValue({
      rest: {
        pulls: {create, requestReviewers},
        issues: {addLabels, addAssignees}
      }
    } as never)
  })

  afterAll(() => {
    if (originalRepository === undefined) {
      delete process.env.GITHUB_REPOSITORY
    } else {
      process.env.GITHUB_REPOSITORY = originalRepository
    }
  })

  test('creates and configures the backport pull request without mutating inputs', async () => {
    const inputs = {...defaultInputs, labels: [...defaultInputs.labels]}

    const result = await createPullRequest(inputs, 'backport/42')

    expect(result.data.number).toBe(99)
    expect(create).toHaveBeenCalledWith({
      owner: 'example',
      repo: 'repo',
      head: 'backport/42',
      base: 'release/v1',
      title: 'Original title / Original title',
      body: 'Backport #42 (42)'
    })
    expect(addLabels).toHaveBeenCalledWith({
      owner: 'example',
      repo: 'repo',
      issue_number: 99,
      labels: ['maintenance', 'bug']
    })
    expect(inputs.labels).toEqual(['maintenance', 'bug'])
    expect(addAssignees).toHaveBeenCalledWith({
      owner: 'example',
      repo: 'repo',
      issue_number: 99,
      assignees: ['maintainer']
    })
    expect(requestReviewers).toHaveBeenCalledWith({
      owner: 'example',
      repo: 'repo',
      pull_number: 99,
      reviewers: ['reviewer'],
      team_reviewers: ['release-team']
    })
    expect(core.warning).toHaveBeenCalledWith(
      'A pull request author cannot review their own pull request'
    )
  })

  test('rejects a malformed repository environment value', async () => {
    process.env.GITHUB_REPOSITORY = 'invalid'

    await expect(
      createPullRequest(defaultInputs, 'backport/42')
    ).rejects.toThrow('GITHUB_REPOSITORY must be in the form owner/repository')
    expect(create).not.toHaveBeenCalled()
  })
})
