import { BlueSkyEnv, BlueskyType, isBlueSkyEnv } from "../services/bluesky.js";
import { assertNotionEnv } from "./Notion.js";
import { GitHubSearchEnv, GitHubSearchType, isGitHubSearchEnv } from "../services/github_search.js";
import { GitHubEnv, GitHubType, isGithubEnv } from "../services/github.js";
import { CalendarEnv, CalendarType, isCalendarEnv } from "../services/calendar.js";
import { isRssEnv, RssEnv, RSSType } from "../services/rss.js";

export type SupportedEnv = BlueSkyEnv | GitHubEnv | GitHubSearchEnv | CalendarEnv | RssEnv;
export const typeOfEnv = (env: SupportedEnv) => {
    // @ts-expect-error: notion_extra is not defined in SupportedEnv
    const notionExtraType = env.notion_extra?.Type.select?.name;
    if (typeof notionExtraType === "string") {
        return notionExtraType;
    }
    if (isBlueSkyEnv(env)) {
        return BlueskyType;
    } else if (isGithubEnv(env)) {
        return GitHubType;
    } else if (isGitHubSearchEnv(env)) {
        return GitHubSearchType;
    } else if (isCalendarEnv(env)) {
        return CalendarType;
    } else if (isRssEnv(env)) {
        return RSSType;
    }
    throw new Error("unknown env type");
}

export const parserEnvs = () => {
    const env = process.env.BLUE_NOTION_ENVS;
    if (env === undefined) {
        throw new Error("env BLUE_NOTION_ENVS is undefined");
    }
    const envs = JSON.parse(env);
    for (const e of envs) {
        assertNotionEnv(e);
    }
    return envs as SupportedEnv[];
}
