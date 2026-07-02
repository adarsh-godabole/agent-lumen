import { Octokit } from "@octokit/rest";

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
const owner = process.env.GITHUB_OWNER!;
const repo = process.env.GITHUB_REPO!;

/** Check whether a file exists at the given path on the repo's default branch. */
export async function fileExistsInRepo(path: string): Promise<boolean> {
  try {
    await octokit.repos.getContent({ owner, repo, path });
    return true;
  } catch (err: any) {
    if (err.status === 404) return false;
    throw err;
  }
}
