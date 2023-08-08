import { ServiceItem } from "../common/Interface.js";
import { NotionEnv } from "../notion/Notion.js";
import { Octokit } from "@octokit/rest";
import { createLogger } from "../common/logger.js";
import { Endpoints } from "@octokit/types";
import { compile, parse } from "parse-github-event";
import { RetryAbleError } from "../common/RetryAbleError.js";

const logger = createLogger("GitHub");
export type GitHubEnv = {
    github_token: string;
    github_username: string;
} & NotionEnv;
export const isGithubEnv = (env: any): env is GitHubEnv => {
    return typeof env.github_token === "string" && typeof env.github_username === "string";
}
type Events = Endpoints["GET /users/{username}/events"]["response"]["data"];
type Event = Endpoints["GET /users/{username}/events"]["response"]["data"][number];
export const searchGithub = async ({
                                       github_username,
                                       GITHUB_TOKEN
                                   }: { github_username: string; GITHUB_TOKEN: string }): Promise<Events> => {
    const octokit = new Octokit({
        auth: GITHUB_TOKEN,
    });
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
const getStateEmoji = (state: string): string => {
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

function compileFormPushEvent(event: any) {
    const commits = event.payload.commits;
    return commits.map(function (commit: any) {
        return "- " + commit.message;
    }).join("\n");
}

function parseEventTitle(event: Event) {
    if (event.payload.issue) {
        // {state} {issue.title} on {repo.name}#{issue.number}
        return `${getStateEmoji(event.payload.issue.state)} ${event.payload.issue.title} on ${event.repo.name}#${event.payload.issue.number}`;
    } else { // @ts-expect-error
        if (event.payload.pull_request) {
            // {state} {pull_request.title} on {repo.name}#{issue.number}
            // @ts-expect-error
            return `${getStateEmoji(event.payload.pull_request.state)} ${event.payload.pull_request.title} on ${event.repo.name}#${event.payload.pull_request.number}`;
        } else {
            // @ts-expect-error
            const parsedEvent = parse(event);
            // @ts-expect-error
            return compile(parsedEvent);
        }
    }
}

function parseEventBody(event: Event) {
    const payload = event.payload;
    if (payload.comment) {
        return payload.comment.body;
    } else if (payload.issue) {
        return payload.issue.body;
    } else if (event.type === "PushEvent") {
        return compileFormPushEvent(event);
    } else { // @ts-expect-error
        if (payload.pull_request) {
            // @ts-expect-error
            return payload.pull_request.body;
        }
    }
    return "";
}

const convertSearchResultToServiceItem = (result: Event): ServiceItem => {
    const title = parseEventTitle(result);
    const body = parseEventBody(result);
    // @ts-expect-error
    const parsed = parse(result);
    return {
        type: "GitHub",
        title: body ? `${title}\n\n${body}` : title,
        url: parsed?.html_url ?? "",
        unixTimeMs: result.created_at ? new Date(result.created_at).getTime() : 0,
    }
}
export const fetchGitHubEvents = async (env: GitHubEnv, lastServiceItem: ServiceItem | null): Promise<ServiceItem[]> => {
    // fetch
    const events = await searchGithub({
        github_username: env.github_username,
        GITHUB_TOKEN: env.github_token,
    });
    logger.info("GitHub Events count", events.length);
    // filter
    const filteredResults = lastServiceItem
        ? collectUntil(events, lastServiceItem)
        : events;
    logger.info("filtered GitHub Events count", filteredResults.length)
    // convert
    return filteredResults.map(convertSearchResultToServiceItem);
}
