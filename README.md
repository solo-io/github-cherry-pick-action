# Backport merged pull requests

This GitHub Action opens a pull request that backports the complete change set of
a merged pull request to a release or maintenance branch.

The action:

- fetches the source pull request and its base branch;
- creates a new branch from the requested target branch;
- applies the pull request's aggregate diff with Git's three-way merge support;
- creates one backport commit with the configured author and committer;
- pushes the branch and opens a pull request; and
- optionally applies labels, assignees, and requested reviewers.

Using the aggregate pull request diff makes the result independent of whether
GitHub merged the source pull request with a merge commit, squash merge, or
rebase merge. If Git cannot apply the changes cleanly, the action fails without
committing conflict markers or pushing a partial backport.

## Example

The workflow token needs permission to push the backport branch, open a pull
request, and update its labels or assignees. Pin third-party actions to immutable
commit SHAs in production workflows.

```yaml
name: Backport pull requests

on:
  pull_request:
    branches: [main]
    types: [closed]

permissions:
  contents: write
  pull-requests: write
  issues: write

jobs:
  backport_release_v1:
    if: >-
      github.event.pull_request.merged == true &&
      contains(github.event.pull_request.labels.*.name, 'release-v1.0')
    runs-on: ubuntu-latest
    steps:
      - name: Check out the repository
        uses: actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803 # v6.1.0
        with:
          persist-credentials: false

      - name: Backport to release-v1.0
        id: backport
        uses: ashleywang1/github-cherry-pick-action@v1.0.1
        with:
          branch: release-v1.0
          labels: cherry-pick
          reviewers: aReviewerUser
          title: '[backport] {old_title}'
          body: 'Backports #{old_pull_request_id} to release-v1.0'

      - name: Show the created pull request
        env:
          PULL_REQUEST_NUMBER: ${{ steps.backport.outputs.number }}
          PULL_REQUEST_URL: ${{ steps.backport.outputs.html_url }}
        run: |
          echo "$PULL_REQUEST_NUMBER"
          echo "$PULL_REQUEST_URL"
```

The action uses its `token` input for both Git operations and GitHub API calls.
When a personal access token is required, pass it explicitly and keep
`persist-credentials: false` on the checkout step:

```yaml
- uses: ashleywang1/github-cherry-pick-action@v1.0.1
  with:
    token: ${{ secrets.BACKPORT_TOKEN }}
    branch: release-v1.0
```

Pull request workflows created with the repository `GITHUB_TOKEN` may require
manual approval. Use a GitHub App installation token or personal access token if
the resulting checks must start without approval; see GitHub's documentation on
[workflow runs triggered by `GITHUB_TOKEN`](https://docs.github.com/en/actions/concepts/security/github_token#when-github_token-triggers-workflow-runs).

## Pull requests from forks

Workflows triggered by `pull_request` from forks receive a read-only token. If
forked pull requests must be backported automatically, use a carefully scoped
`pull_request_target` workflow and do not check out or execute code from the
untrusted pull request. Keep the `closed` event and merged-pull-request condition
shown above.

```yaml
on:
  pull_request_target:
    branches: [main]
    types: [closed]
```

## Inputs

| Name | Description | Default |
| --- | --- | --- |
| `branch` | Target branch for the backport pull request. Required. | — |
| `token` | Token used for Git pushes and GitHub API calls. | `${{ github.token }}` |
| `committer` | Committer in `Display Name <email@example.com>` format. | `GitHub <noreply@github.com>` |
| `author` | Author in `Display Name <email@example.com>` format. | Triggering GitHub user |
| `title` | New pull request title. Every `{old_title}` token is replaced with the source title. | Source title |
| `body` | New pull request body. Every `{old_pull_request_id}` token is replaced with the source number. | Source body |
| `labels` | Comma- or newline-separated labels. | — |
| `inherit_labels` | Inherit source pull request labels other than a label matching the target branch. | `true` |
| `assignees` | Comma- or newline-separated GitHub usernames. | — |
| `reviewers` | Comma- or newline-separated GitHub usernames. The source author is skipped. | — |
| `team-reviewers` | Comma- or newline-separated GitHub team slugs. | — |
| `cherry-pick-branch` | Backport branch name. | `cherry-pick-{sanitized target branch}-{source PR number}` |
| `force` | Update an existing backport branch with `--force-with-lease`. | `false` |

## Outputs

| Name | Description |
| --- | --- |
| `data` | JSON representation of the created pull request. |
| `number` | Number of the created pull request. |
| `html_url` | URL of the created pull request. |

## License

[MIT](LICENSE)
