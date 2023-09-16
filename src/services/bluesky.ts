import { AppBskyFeedGetAuthorFeed, BskyAgent } from "@atproto/api";
import { PostView } from "@atproto/api/dist/client/types/app/bsky/feed/defs";
import { ServiceItem } from "../common/ServiceItem.js";
import { NotionEnv } from "../notion/Notion.js";
import { createLogger } from "../common/logger.js";

const logger = createLogger("Bluesky");
export type BlueSkyEnv = {
    bluesky_identifier: string;
    bluesky_app_password: string;

} & NotionEnv;
export const BlueskyType = "Bluesky";
export const isBlueSkyEnv = (env: unknown): env is BlueSkyEnv => {
    return (env as BlueSkyEnv).bluesky_identifier !== undefined && (env as BlueSkyEnv).bluesky_app_password !== undefined;
}
const convertHttpUrlFromAtProto = (url: string): string => {
    const match = url.match(/at:\/\/(did:plc:.*?)\/app.bsky.feed.post\/(.*)/);
    if (match === null) {
        throw new Error(`post.uri is invalid: ${url}`);
    }
    const did = match[1];
    const contentId = match[2];
    return `https://bsky.app/profile/${did}/post/${contentId}`
}
const getRootPost = (post: PostView): { url: string; } | undefined => {
    // @ts-expect-error no reply type
    if (!post.record?.reply?.root) {
        return undefined;
    }
    // @ts-expect-error no reply type
    const url = convertHttpUrlFromAtProto(post.record.reply.root.uri);
    return {
        url,
    }
}
// Issue: https://github.com/bluesky-social/atproto/issues/910
export const convertPostToServiceIr = (post: PostView, identifier: string): ServiceItem => {
    const record = post.record as { text?: string };
    if (typeof record.text !== "string") {
        throw new Error("post.record.text is not string");
    }
    // if post is reply, get root post
    const rootPost = getRootPost(post);
    return {
        type: BlueskyType,
        // at://did:plc:niluiwex7fsnjak2wxs4j47y/app.bsky.feed.post/3jz3xglxhzu27@@azu.bsky.social
        title: record.text,
        url: convertHttpUrlFromAtProto(post.uri),
        unixTimeMs: new Date(post.indexedAt).getTime(),
        // if the reply is self post
        ...(rootPost ? {
            parent: {
                url: rootPost.url
            },
        } : {})
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
        throw new Error("collect error at bluesky");
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
    }).catch((error) => {
        logger.error("login error", {
            status: error.status,
            error: error.error,
            // filter `ratelimit-*` headers
            rateLimitHeaders: Object.fromEntries(Object.entries(error.headers).filter(([key]) => {
                return key.startsWith("ratelimit-")
            })),
        });
        throw error;
    });

    type FetchAuthorFeedParams = {
        actor: string;
        feed: Feed;
        cursor?: string;
    };
    const fetchAuthorFeed = async ({ actor, feed, cursor }: FetchAuthorFeedParams): Promise<Feed> => {
        try {
            const timeline = await agent.getAuthorFeed({
                actor,
                limit: 50,
                cursor
            });

            if (timeline.success) {
                // if found older tweet than lasttweet , stop fetching
                const latestPost = timeline.data.feed.at(-1);
                if (lastServiceItem && latestPost) {
                    const lastItemDate = new Date(latestPost?.post?.indexedAt ?? "");
                    if (lastItemDate.getTime() < lastServiceItem.unixTimeMs) {
                        return [...feed, ...timeline.data.feed];
                    }
                }
                return [...feed, ...timeline.data.feed];
            } else {
                throw new Error("timeline fetch error:" + JSON.stringify(timeline.data));
            }
        } catch (error) {
            logger.debug("fetch error", {
                // @ts-ignore
                status: error.status,
                // @ts-ignore
                code: error.code,
            });
            throw error;
        }
    };

    logger.info("fetching from bluesky since %s", lastServiceItem?.unixTimeMs !== undefined
        ? new Date(lastServiceItem.unixTimeMs).toISOString()
        : "first");
    const feed = await fetchAuthorFeed({
        actor: env.bluesky_identifier,
        feed: []
    });
    const convertedPosts = feed.map((post) => {
        return convertPostToServiceIr(post.post, env.bluesky_identifier);
    })
    const sortedPosts = convertedPosts.sort((a, b) => {
        return a.unixTimeMs > b.unixTimeMs ? -1 : 1;
    });
    logger.info("fetched item count", sortedPosts.length);
    const postItems = lastServiceItem ? await collectTweetsUntil(sortedPosts, lastServiceItem) : sortedPosts;
    logger.info("post-able items count", postItems.length);
    return postItems;
}
