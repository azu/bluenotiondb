import { fetchBluesky, isBlueSkyEnv } from "./services/bluesky.js";
import { fetchLastPage, syncToNotion } from "./notion/Notion.js";
import { parserEnvs, SupportedEnv } from "./notion/envs.js";
import { ServiceItem } from "./common/Interface.js";

const fetchService = (env: SupportedEnv, lastItem: ServiceItem | null) => {
    if (isBlueSkyEnv(env)) {
        return fetchBluesky(env, lastItem);
    }
    throw new Error("unsupported env type" + JSON.stringify(env));
}
const envs = parserEnvs();
for (const env of envs) {
    const lastItem = await fetchLastPage(env);
    console.log("lastItem", lastItem);
    const postableItems = await fetchService(env, lastItem);
    // sync to notion
    await syncToNotion(env, postableItems);
}
