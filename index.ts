import { fetchBluesky } from "./services/bluesky.js";
import { fetchLastPage, syncToNotion } from "./notion/Notion.js";
import { parserEnvs } from "./notion/envs.js";

const envs = parserEnvs();
for (const env of envs) {
    const lastTweet = await fetchLastPage(env);
    console.log("lastTweet", lastTweet);
// bluesky
    const tweets = await fetchBluesky(env, lastTweet);
// sync to notion
    await syncToNotion(env, tweets);
}
