import { BlueSkyEnv } from "../services/bluesky.js";
import { assertNotionEnv } from "./Notion.js";

export type SupportedEnv = BlueSkyEnv;
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
