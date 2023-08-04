import { ServiceItem } from "../common/Interface.js";
import { NotionEnv } from "../notion/Notion.js";
import { Octokit } from "@octokit/rest";
import { createLogger } from "../common/logger.js";
import { Endpoints } from "@octokit/types";
import { compile, parse } from "parse-github-event";

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
const convertSearchResultToServiceItem = (result: Event): ServiceItem => {
    // @ts-expect-error
    const parsed = parse(result);
    if (!parsed) {
        logger.error(new Error("parsed is null" + JSON.stringify(result)));
        throw new Error("parsed is null");
    }
    const title = compile(parsed);
    console.log("result", result);
    console.log("parsed", parsed);
    console.log("title", title);
    const titleWithoutActor = title.replace(parsed.login + " ", "");
    const titleWithEmoji = "action" in parsed.data
        ? getStateEmoji(parsed.data.action) + titleWithoutActor
        : titleWithoutActor;
    return {
        type: "GitHub",
        title: titleWithEmoji,
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
    logger.log("GitHub Events count", events.length);
    // filter
    const filteredResults = lastServiceItem
        ? collectUntil(events, lastServiceItem)
        : events;
    logger.log("filtered GitHub Events count", filteredResults.length)
    // convert
    return filteredResults.map(convertSearchResultToServiceItem);
}
