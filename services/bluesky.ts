import { AppBskyFeedGetAuthorFeed, BskyAgent } from "@atproto/api";
import { PostView } from "@atproto/api/dist/client/types/app/bsky/feed/defs";
import { ServiceItem } from "../common/Interface.js";
import { NotionEnv } from "../notion/Notion.js";
import { createLogger } from "../common/logger.js";

const logger = createLogger("Bluesky");
export type BlueSkyEnv = {
    bluesky_identifier: string;
    bluesky_app_password: string;

} & NotionEnv;
export const isBlueSkyEnv = (env: unknown): env is BlueSkyEnv => {
    return (env as BlueSkyEnv).bluesky_identifier !== undefined && (env as BlueSkyEnv).bluesky_app_password !== undefined;
}
// Issue: https://github.com/bluesky-social/atproto/issues/910
export const convertPostToServiceIr = (post: PostView): ServiceItem => {
    const record = post.record as { text?: string };
    if (typeof record.text !== "string") {
        throw new Error("post.record.text is not string");
    }
    const match = post.uri.match(/at:\/\/(did:plc:.*?)\/app.bsky.feed.post\/(.*)/);
    if (match === null) {
        throw new Error(`post.uri is invalid: ${post.uri}`);
    }
    const did = match[1];
    const contentId = match[2];
    return {
        type: "Bluesky",
        // at://did:plc:niluiwex7fsnjak2wxs4j47y/app.bsky.feed.post/3jz3xglxhzu27@@azu.bsky.social
        title: record.text,
        url: `https://bsky.app/profile/${did}/post/${contentId}`,
        unixTimeMs: new Date(post.indexedAt).getTime()
    };
};

type Feed = AppBskyFeedGetAuthorFeed.Response["data"]["feed"];
export const collectTweetsUntil = async (timeline: ServiceItem[], lastTweet: ServiceItem): Promise<ServiceItem[]> => {
    const results: ServiceItem[] = [];
    try {
        for (const tweet of timeline) {
            if (lastTweet.url === tweet.url) {
                return results;
            }
            if (lastTweet.unixTimeMs < tweet.unixTimeMs) {
                results.push(tweet);
            } else {
                return results;
            }
        }
    } catch (error) {
        logger.error(new Error("collect error", {
            cause: error,
        }));
    }
    return results;
};

export async function fetchBluesky(env: BlueSkyEnv, lastServiceItem: ServiceItem | null): Promise<ServiceItem[]> {
    const agent = new BskyAgent({
        service: "https://bsky.social"
    });
    if (!env.bluesky_identifier || !env.bluesky_app_password) {
        throw new Error("bluesky_identifier or bluesky_app_password is not set");
    }
    await agent.login({
        identifier: env.bluesky_identifier,
        password: env.bluesky_app_password
    });

    type FetchAuthorFeedParams = {
        actor: string;
        feed: Feed;
        cursor?: string;
    };
    // collect feed 100 * 10
    const fetchAuthorFeed = async ({ actor, feed, cursor }: FetchAuthorFeedParams): Promise<Feed> => {
        if (feed.length >= 1000) {
            return feed;
        }
        const timeline = await agent.getAuthorFeed({
            actor,
            limit: 100,
            cursor
        });
        if (timeline.success) {
            // if found older tweet than lasttweet , stop fetching
            const latestPost = timeline.data.feed.at(-1);
            if (lastServiceItem && latestPost) {
                const lastItemDate = new Date(latestPost?.post?.indexedAt);
                if (lastItemDate.getTime() < lastServiceItem.unixTimeMs) {
                    return [...feed, ...timeline.data.feed];
                }
            }
            if (timeline.data.cursor) {
                return fetchAuthorFeed({
                    actor: actor,
                    feed: [...feed, ...timeline.data.feed],
                    cursor: timeline.data.cursor
                });
            } else {
                return [...feed, ...timeline.data.feed];
            }
        } else {
            throw new Error("timeline fetch error:" + JSON.stringify(timeline.data));
        }
    };

    logger.log("fetching from bluesky since %s", lastServiceItem?.unixTimeMs !== undefined
        ? new Date(lastServiceItem.unixTimeMs).toISOString()
        : "first");
    const feed = await fetchAuthorFeed({
        actor: env.bluesky_identifier,
        feed: []
    });
    const convertedPosts = feed.map((post) => {
        return convertPostToServiceIr(post.post);
    })
    const sortedPosts = convertedPosts.sort((a, b) => {
        return a.unixTimeMs > b.unixTimeMs ? -1 : 1;
    });
    logger.log("fetched item count", sortedPosts.length);
    const postItems = lastServiceItem ? await collectTweetsUntil(sortedPosts, lastServiceItem) : sortedPosts;
    logger.log("post-able items count", postItems.length);
    return postItems;
}
