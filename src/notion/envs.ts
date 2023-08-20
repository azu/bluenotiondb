import { BlueSkyEnv } from "../services/bluesky.js";
import { assertNotionEnv } from "./Notion.js";
import { GitHubSearchEnv } from "../services/github_search.js";
import { GitHubEnv } from "../services/github.js";
import { CalendarEnv } from "../services/calendar.js";

export type SupportedEnv = BlueSkyEnv | GitHubEnv | GitHubSearchEnv | CalendarEnv;
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
