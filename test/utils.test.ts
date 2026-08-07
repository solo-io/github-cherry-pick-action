import * as core from '@actions/core'
import {beforeEach, describe, expect, jest, test} from '@jest/globals'
import {
  getInputAsBoolean,
  getStringAsArray,
  parseDisplayNameEmail,
  sanitizeBranchComponent
} from '../src/utils'

jest.mock(
  '@actions/core',
  () => ({
    getInput: jest.fn(),
    getBooleanInput: jest.fn()
  }),
  {virtual: true}
)

describe('input helpers', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('parses comma- and newline-separated values', () => {
    expect(getStringAsArray('one, two\nthree\n\n')).toEqual([
      'one',
      'two',
      'three'
    ])
  })

  test('uses the toolkit boolean parser for non-empty inputs', () => {
    jest.mocked(core.getInput).mockReturnValue('true')
    jest.mocked(core.getBooleanInput).mockReturnValue(true)

    expect(getInputAsBoolean('force')).toBe(true)
    expect(core.getBooleanInput).toHaveBeenCalledWith('force', undefined)
  })

  test('returns undefined for an omitted boolean', () => {
    jest.mocked(core.getInput).mockReturnValue('')

    expect(getInputAsBoolean('force')).toBeUndefined()
    expect(core.getBooleanInput).not.toHaveBeenCalled()
  })

  test('sanitizes target branch names for default backport branches', () => {
    expect(sanitizeBranchComponent('release/v1.2')).toBe('release-v1-2')
    expect(sanitizeBranchComponent('///')).toBe('branch')
  })

  test('parses and trims an author identity', () => {
    expect(parseDisplayNameEmail('Example User <user@example.com>')).toEqual({
      name: 'Example User',
      email: 'user@example.com'
    })
  })

  test('rejects malformed author identities', () => {
    expect(() => parseDisplayNameEmail('user@example.com')).toThrow(
      'is not a valid email address with display name'
    )
  })
})
