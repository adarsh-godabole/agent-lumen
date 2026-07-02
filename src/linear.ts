import { LinearClient } from "@linear/sdk";

const linear = new LinearClient({ apiKey: process.env.LINEAR_API_KEY! });

export async function postComment(issueId: string, body: string): Promise<string> {
  const result = await linear.createComment({ issueId, body });
  const comment = await result.comment;
  console.log(`[Linear] Comment posted on ${issueId}`);
  return comment?.id ?? "";
}

export async function getIssue(issueId: string) {
  return linear.issue(issueId);
}
