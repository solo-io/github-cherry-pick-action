import * as core from '@actions/core'
import * as github from '@actions/github'
import type {PullRequest} from '@octokit/webhooks-types'

export interface Inputs {
  token: string
  committer: string
  author: string
  branch: string
  title?: string
  body?: string
  labels: string[]
  inherit_labels?: boolean
  assignees: string[]
  reviewers: string[]
  teamReviewers: string[]
  cherryPickBranch?: string
  force?: boolean
}

type Octokit = ReturnType<typeof github.getOctokit>
type CreatedPullRequest = Awaited<
  ReturnType<Octokit['rest']['pulls']['create']>
>

export async function createPullRequest(
  inputs: Inputs,
  prBranch: string
): Promise<CreatedPullRequest> {
  const pullRequest = github.context.payload.pull_request as
    PullRequest | undefined
  if (!pullRequest) {
    throw new Error('The GitHub event payload does not contain a pull request')
  }

  const repository = process.env.GITHUB_REPOSITORY?.split('/')
  if (
    repository?.length !== 2 ||
    repository[0] === '' ||
    repository[1] === ''
  ) {
    throw new Error('GITHUB_REPOSITORY must be in the form owner/repository')
  }
  const [owner, repo] = repository
  const octokit = github.getOctokit(inputs.token)

  const title = inputs.title
    ? inputs.title.replaceAll('{old_title}', pullRequest.title)
    : pullRequest.title

  const body = inputs.body
    ? inputs.body.replaceAll(
        '{old_pull_request_id}',
        pullRequest.number.toString()
      )
    : (pullRequest.body ?? undefined)
  core.info('Creating the backport pull request')
  const pull = await octokit.rest.pulls.create({
    owner,
    repo,
    head: prBranch,
    base: inputs.branch,
    title,
    body
  })

  const appliedLabels = new Set(inputs.labels)
  if (inputs.inherit_labels) {
    for (const label of pullRequest.labels) {
      if (label.name !== inputs.branch) appliedLabels.add(label.name)
    }
  }
  if (appliedLabels.size > 0) {
    const labels = [...appliedLabels]
    core.info(`Applying ${labels.length} label(s)`)
    await octokit.rest.issues.addLabels({
      owner,
      repo,
      issue_number: pull.data.number,
      labels
    })
  }

  if (inputs.assignees.length > 0) {
    core.info(`Applying ${inputs.assignees.length} assignee(s)`)
    await octokit.rest.issues.addAssignees({
      owner,
      repo,
      issue_number: pull.data.number,
      assignees: inputs.assignees
    })
  }

  const sourceAuthor = pullRequest.user.login.toLowerCase()
  const reviewers = inputs.reviewers.filter(
    reviewer => reviewer.toLowerCase() !== sourceAuthor
  )
  if (reviewers.length !== inputs.reviewers.length) {
    core.warning('A pull request author cannot review their own pull request')
  }
  if (reviewers.length > 0 || inputs.teamReviewers.length > 0) {
    core.info(
      `Requesting ${reviewers.length} user review(s) and ` +
        `${inputs.teamReviewers.length} team review(s)`
    )
    await octokit.rest.pulls.requestReviewers({
      owner,
      repo,
      pull_number: pull.data.number,
      reviewers,
      team_reviewers: inputs.teamReviewers
    })
  }

  return pull
}
