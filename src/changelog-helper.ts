import * as fs from 'fs'
import * as path from 'path'
import * as semver from 'semver'
import * as core from '@actions/core'
import * as io from '@actions/io'

export class ChangelogHelper {
  private changelogRoot: string

  constructor(changelogRoot = 'changelog') {
    this.changelogRoot = changelogRoot
  }

  exists(): boolean {
    return (
      fs.existsSync(this.changelogRoot) &&
      fs.lstatSync(this.changelogRoot).isDirectory()
    )
  }

  async moveEntriesToNextPatchVersion(lastReleasedTag: string): Promise<void> {
    if (!this.exists()) {
      core.warning(`Changelog root ${this.changelogRoot} does not exist.`)
      return
    }

    // Clean the version string (e.g. "v2.7.7" -> "2.7.7")
    const cleanVersion = semver.clean(lastReleasedTag)
    if (!cleanVersion) {
      core.warning(`Invalid last-released-tag: ${lastReleasedTag}`)
      return
    }

    // Calculate next patch version (e.g. "2.7.7" -> "2.7.8")
    const nextPatch = semver.inc(cleanVersion, 'patch')
    if (!nextPatch) {
      core.warning(`Could not increment patch version for ${cleanVersion}`)
      return
    }

    const targetDirName = `v${nextPatch}`
    const targetDir = path.join(this.changelogRoot, targetDirName)

    // Create target directory if it doesn't exist
    if (!fs.existsSync(targetDir)) {
        core.info(`Creating target changelog directory: ${targetDirName}`)
        await io.mkdirP(targetDir)
    }

    core.info(`Moving changelog entries to ${targetDirName}...`)

    const dirents = fs.readdirSync(this.changelogRoot, {withFileTypes: true})
    
    for (const dirent of dirents) {
      if (!dirent.isDirectory()) continue
      
      const dirName = dirent.name

      // if the directory name is the same as the target directory name, skip moving (no-op)
      if (dirName === targetDirName) continue

      // check if the directory name is a valid semver to avoid processing unrelated folders.
      const cleanCoercedDirVersion = semver.coerce(semver.clean(dirName) as string)
      if (!semver.valid(cleanCoercedDirVersion)){
        core.warning(`skipping invalid directory: ${dirName}`)
        continue
      }

      const cleanCoercedTargetVersion = semver.coerce(semver.clean(targetDirName) as string)
      
      // Only move from directories strictly "newer" than our target.
      // This prevents moving entries from older versions (e.g. v2.6.0-rc1 when we are on v2.7.x)
      // into the new folder.
      if (cleanCoercedDirVersion && cleanCoercedTargetVersion && semver.gt(cleanCoercedDirVersion, cleanCoercedTargetVersion)) {
          // Move all contents from other directories to the target directory
          // the thinking is if we are cherry-picking from main, any files under the new dir e.g v2.12.0-beta1
          // can only be on the LTS branch if they were introduced by the cherry-pick, 
          // so we move everything from the new dir to the target dir
          await this.moveContents(dirName, targetDirName)
      }
    }
  }

  private async moveContents(sourceDirName: string, targetDirName: string): Promise<void> {
      const sourceDir = path.join(this.changelogRoot, sourceDirName)
      const targetDir = path.join(this.changelogRoot, targetDirName)
      
      if (!fs.existsSync(sourceDir)) return

      const files = fs.readdirSync(sourceDir)
      for (const file of files) {
          const sourceFile = path.join(sourceDir, file)
          const destFile = path.join(targetDir, file)

          // Ensure unique filename if collision exists
          let finalDestFile = destFile
          if (fs.existsSync(finalDestFile)) {
            const parsed = path.parse(file)
            finalDestFile = path.join(
              targetDir,
              `${parsed.name}-${Date.now()}${parsed.ext}`
            )
          }

          await io.mv(sourceFile, finalDestFile)
          core.info(`Moved ${file} from ${sourceDirName} to ${targetDirName}`)
      }

      // Cleanup empty source directory
      try {
          if (fs.readdirSync(sourceDir).length === 0) {
              fs.rmdirSync(sourceDir)
              core.info(`Removed empty directory ${sourceDirName}`)
          }
      } catch (e) {
          core.warning(`Could not remove empty directory ${sourceDir}: ${e}`)
      }
  }
}
