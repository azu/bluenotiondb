import { BlueSkyEnv } from "../services/bluesky.js";
import { NotionEnv } from "./Notion.js";

export type SupportedEnv = (NotionEnv & BlueSkyEnv);
export const parserEnvs = () => {
    const env = process.env.BLUE_NOTION_ENVS;
    if (env === undefined) {
        throw new Error("env BLUE_NOTION_ENVS is undefined");
    }
    const envs = JSON.parse(env);
    return envs as SupportedEnv[];
}
