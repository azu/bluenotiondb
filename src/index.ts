import { fetchBluesky, isBlueSkyEnv } from "./services/bluesky.js";
import { fetchLastPage, syncToNotion } from "./notion/Notion.js";
import { parserEnvs, SupportedEnv } from "./notion/envs.js";
import { ServiceItem } from "./common/Interface.js";
import { debug, info, warn } from "./common/logger.js";
import { fetchGitHubSearch, isGitHubSearchEnv } from "./services/github_search.js";
import { fetchGitHubEvents, isGithubEnv } from "./services/github.js";
import { RetryAbleError } from "./common/RetryAbleError.js";
import { RateLimitError } from "./common/RateLimitError.js";
import { fetchCalendar, isCalendarEnv } from "./services/calendar.js";

if (Boolean(process.env.DRY_RUN)) {
    info("DRY_RUN mode");
}
const fetchService = async (env: SupportedEnv, lastItem: ServiceItem | null): Promise<Promise<ServiceItem[]>> => {
    try {
        if (isBlueSkyEnv(env)) {
            return await fetchBluesky(env, lastItem);
        } else if (isGithubEnv(env)) {
            return await fetchGitHubEvents(env, lastItem)
        } else if (isGitHubSearchEnv(env)) {
            return await fetchGitHubSearch(env, lastItem);
        } else if (isCalendarEnv(env)) {
            return await fetchCalendar(env, lastItem);
        }
    } catch (error) {
        if (error instanceof RetryAbleError) {
            info("retryable error", error.message);
            return fetchService(env, lastItem);
        } else if (error instanceof RateLimitError) {
            warn("rate limit error", error.message);
            warn("treat rate limit error as success");
            return Promise.resolve([]); //
        }
        throw error;
    }
    throw new Error("unsupported env");
}
const envs = parserEnvs();
const lastItem = await fetchLastPage(envs[0]);
if (lastItem?.unixTimeMs) {
    info("last item exists at", new Date(lastItem?.unixTimeMs).toISOString());
} else {
    info("last item not exists");
}
debug("lastItem object", lastItem);
for (const env of envs) {
    const postableItems = await fetchService(env, lastItem);
    // sync to notion
    await syncToNotion(env, postableItems);
}
