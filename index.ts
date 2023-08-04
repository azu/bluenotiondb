import { fetchBluesky, isBlueSkyEnv } from "./services/bluesky.js";
import { fetchLastPage, syncToNotion } from "./notion/Notion.js";
import { parserEnvs, SupportedEnv } from "./notion/envs.js";
import { ServiceItem } from "./common/Interface.js";
import { debug, log } from "./common/logger.js";
import { fetchGitHubSearch, isGitHubSearchEnv } from "./services/github_search.js";

const fetchService = (env: SupportedEnv, lastItem: ServiceItem | null) => {
    if (isBlueSkyEnv(env)) {
        return fetchBluesky(env, lastItem);
    } else if (isGitHubSearchEnv(env)) {
        return fetchGitHubSearch(env, lastItem);
    }
    throw new Error("unsupported env");
}
const envs = parserEnvs();
const lastItem = await fetchLastPage(envs[0]);
for (const env of envs) {
    log("last item exists: %s", lastItem ? "true" : "false");
    debug("lastItem object", lastItem);
    const postableItems = await fetchService(env, lastItem);
    // sync to notion
    await syncToNotion(env, postableItems);
}
