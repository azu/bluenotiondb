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
if (lastItem?.unixTimeMs) {
    log("last item exists at", new Date(lastItem?.unixTimeMs).toISOString());
} else {
    log("last item not exists");
}
debug("lastItem object", lastItem);
for (const env of envs) {
    const postableItems = await fetchService(env, lastItem);
    // sync to notion
    await syncToNotion(env, postableItems);
}
