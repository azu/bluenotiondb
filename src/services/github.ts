import { ServiceItem } from "../common/ServiceItem.js";
import { NotionEnv } from "../notion/Notion.js";
import { Octokit } from "@octokit/rest";
import { createLogger } from "../common/logger.js";
import { Endpoints } from "@octokit/types";
import { compile, parse } from "parse-github-event";
import { RetryAbleError } from "../common/RetryAbleError.js";
import { RateLimitError } from "../common/RateLimitError.js";

const logger = createLogger("GitHub");
export type GitHubEnv = {
    github_token: string;
    github_username: string;
} & NotionEnv;
export const GitHubType = "GitHub" as const;
export const isGithubEnv = (env: any): env is GitHubEnv => {
    return typeof env.github_token === "string" && typeof env.github_username === "string";
}
type Events = Endpoints["GET /users/{username}/events"]["response"]["data"];
type Event = Endpoints["GET /users/{username}/events"]["response"]["data"][number];
export const fetchUserEvents = async ({
                                          github_username,
                                          GITHUB_TOKEN
                                      }: { github_username: string; GITHUB_TOKEN: string }): Promise<Events> => {
    const octokit = new Octokit({
        auth: GITHUB_TOKEN,
    });
    try {
        const rest = await octokit.request('GET /users/{username}/events', {
            username: github_username,
            headers: {
                'X-GitHub-Api-Version': '2022-11-28'
            }
        });

        // 50x error will be retry-able error
        if (rest.status >= 500 && rest.status < 600) {
            throw new RetryAbleError("Retry-able Error on GitHub: " + rest.status);
        }
        return rest.data
    } catch (error) {
        // rate limit error
        if ((error as { status: number }).status === 403) {
            throw new RateLimitError("Rate Limit Error on GitHub", {
                cause: error,
            });
        }
        throw error;
    }
};

export const collectUntil = (events: Events, lastServiceItem: ServiceItem): Events => {
    const filteredResults: Events = [];
    try {
        for (const event of events) {
            if (!event.created_at) continue;
            const createAtTime = new Date(event.created_at).getTime();
            if (lastServiceItem.unixTimeMs < createAtTime) {
                filteredResults.push(event);
            } else {
                return filteredResults;
            }
        }
    } catch (error) {
        logger.error(new Error("collect error", {
            cause: error,
        }));
        throw new Error("collect error at GitHub");
    }
    return filteredResults;
};
const getStateEmoji = (state: string | undefined): string => {
    if (!state) {
        return "";
    }
    switch (state.toUpperCase()) {
        case "OPEN":
        case "OPENED":
            return "🟢 ";
        case "CLOSED":
            return "🔴 ";
        case "MERGED":
            return "🟣 ";
    }
    return "";
}

async function fetchCommitMessage(
    octokit: Octokit,
    owner: string,
    repo: string,
    sha: string
): Promise<string> {
    try {
        const response = await octokit.rest.repos.getCommit({
            owner,
            repo,
            ref: sha,
            headers: {
                'X-GitHub-Api-Version': '2022-11-28'
            }
        });
        return response.data.commit.message;
    } catch (error) {
        logger.error(new Error(`Failed to fetch commit message for ${sha}`, { cause: error }));
        return "";
    }
}

type PullRequestDetails = {
    title: string;
    body: string | null;
    state: string;
};

async function fetchPullRequestDetails(
    octokit: Octokit,
    owner: string,
    repo: string,
    pull_number: number
): Promise<PullRequestDetails | null> {
    try {
        const response = await octokit.rest.pulls.get({
            owner,
            repo,
            pull_number,
            headers: {
                'X-GitHub-Api-Version': '2022-11-28'
            }
        });
        return {
            title: response.data.title,
            body: response.data.body,
            state: response.data.merged ? "merged" : response.data.state
        };
    } catch (error) {
        logger.error(new Error(`Failed to fetch PR #${pull_number}`, { cause: error }));
        return null;
    }
}

type IssueDetails = {
    title: string;
    body: string | null;
    state: string;
};

async function fetchIssueDetails(
    octokit: Octokit,
    owner: string,
    repo: string,
    issue_number: number
): Promise<IssueDetails | null> {
    try {
        const response = await octokit.rest.issues.get({
            owner,
            repo,
            issue_number,
            headers: {
                'X-GitHub-Api-Version': '2022-11-28'
            }
        });
        return {
            title: response.data.title,
            body: response.data.body ?? null,
            state: response.data.state ?? "open"
        };
    } catch (error) {
        logger.error(new Error(`Failed to fetch issue #${issue_number}`, { cause: error }));
        return null;
    }
}

async function compileFormPushEvent(octokit: Octokit, event: any): Promise<string> {
    const commits = event.payload.commits;
    if (!commits || !Array.isArray(commits)) {
        return "";
    }
    const repoFullName = event.repo.name;
    const [owner, repo] = repoFullName.split('/');
    const messages: string[] = [];
    for (const commit of commits) {
        if (commit.message) {
            messages.push("- " + commit.message);
        } else if (commit.sha) {
            const message = await fetchCommitMessage(octokit, owner, repo, commit.sha);
            if (message) {
                messages.push("- " + message);
            }
        }
    }
    return messages.join("\n");
}

async function parseEventTitle(octokit: Octokit, event: Event): Promise<string> {
    const repoFullName = event.repo.name;
    const [owner, repo] = repoFullName.split('/');

    if (event.payload.issue) {
        const issue = event.payload.issue;
        // Fetch from API if title is missing
        if (!issue.title && issue.number) {
            const details = await fetchIssueDetails(octokit, owner, repo, issue.number);
            if (details) {
                return `${getStateEmoji(details.state)} ${details.title} on ${event.repo.name}#${issue.number}`;
            }
        }
        return `${getStateEmoji(issue.state)} ${issue.title} on ${event.repo.name}#${issue.number}`;
    } else { // @ts-expect-error
        if (event.payload.pull_request) {
            // @ts-expect-error
            const pr = event.payload.pull_request;
            // Fetch from API if title is missing
            if (!pr.title && pr.number) {
                const details = await fetchPullRequestDetails(octokit, owner, repo, pr.number);
                if (details) {
                    return `${getStateEmoji(details.state)} ${details.title} on ${event.repo.name}#${pr.number}`;
                }
            }
            return `${getStateEmoji(pr.state)} ${pr.title} on ${event.repo.name}#${pr.number}`;
        } else {
            // @ts-expect-error
            const parsedEvent = parse(event);
            if (!parsedEvent) {
                return `${event.type} on ${event.repo.name}`;
            }
            // @ts-expect-error
            return compile(parsedEvent);
        }
    }
}

async function parseEventBody(octokit: Octokit, event: Event): Promise<string> {
    const payload = event.payload;
    const repoFullName = event.repo.name;
    const [owner, repo] = repoFullName.split('/');

    if (payload.comment) {
        return payload.comment.body ?? "";
    } else if (payload.issue) {
        if (payload.issue.body) {
            return payload.issue.body;
        }
        // Fetch from API if body is missing
        if (payload.issue.number) {
            const details = await fetchIssueDetails(octokit, owner, repo, payload.issue.number);
            return details?.body ?? "";
        }
        return "";
    } else if (event.type === "PushEvent") {
        return compileFormPushEvent(octokit, event);
    } else { // @ts-expect-error
        if (payload.pull_request) {
            // @ts-expect-error
            if (payload.pull_request.body) {
                // @ts-expect-error
                return payload.pull_request.body;
            }
            // Fetch from API if body is missing
            // @ts-expect-error
            if (payload.pull_request.number) {
                // @ts-expect-error
                const details = await fetchPullRequestDetails(octokit, owner, repo, payload.pull_request.number);
                return details?.body ?? "";
            }
            return "";
        }
    }
    return "";
}

const convertSearchResultToServiceItem = async (octokit: Octokit, result: Event): Promise<ServiceItem> => {
    const title = await parseEventTitle(octokit, result);
    const body = await parseEventBody(octokit, result);
    // @ts-expect-error
    const parsed = parse(result);
    return {
        type: GitHubType,
        title: body ? `${title}\n\n${body}` : title,
        url: parsed?.html_url ?? "https://",
        unixTimeMs: result.created_at ? new Date(result.created_at).getTime() : 0,
    }
}
export const fetchGitHubEvents = async (env: GitHubEnv, lastServiceItem: ServiceItem | null): Promise<ServiceItem[]> => {
    const octokit = new Octokit({
        auth: env.github_token,
    });
    // fetch
    const events = await fetchUserEvents({
        github_username: env.github_username,
        GITHUB_TOKEN: env.github_token,
    });
    logger.info("GitHub Events count", events.length);
    // filter
    const filteredResults = lastServiceItem
        ? collectUntil(events, lastServiceItem)
        : events;
    logger.info("filtered GitHub Events count", filteredResults.length)
    // convert (sequential to avoid rate limiting)
    const serviceItems: ServiceItem[] = [];
    for (const event of filteredResults) {
        const item = await convertSearchResultToServiceItem(octokit, event);
        logger.info("converted item", { type: event.type, title: item.title.substring(0, 200) });
        serviceItems.push(item);
    }
    return serviceItems;
}
