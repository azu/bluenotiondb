import ical from "node-ical"
import { NotionEnv } from "../notion/Notion.js";
import { ServiceItem } from "../common/Interface.js";
import Parser from 'rss-parser';
import { createCache } from "../common/cache.js";

export type RssEnv = {
    rss_url: string;
} & NotionEnv;
export const RSSType = "RSS" as const;
export const isRssEnv = (env: any): env is RssEnv => {
    return typeof env.rss_url === "string";
}
type CacheItem = {
    id: string;
    unixTimeMs: number;
}
const updateCacheEvents = ({
                               oldEvents,
                               newEvents,
                               today = new Date()
                           }: {
    oldEvents: CacheItem[],
    newEvents: { uid: string; unixTimeMs: number }[], today?: Date
}) => {
    // add serviceItems to cache
    const newCache = oldEvents.concat(newEvents.map(item => {
        return {
            unixTimeMs: item.unixTimeMs,
            id: item.uid,
        }
    }));
    // remove old cache - before yesterday
    const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
    return newCache.filter(item => {
        return item.unixTimeMs >= yesterday.getTime();
    });
}
type FeedItem = {
    title: string;
    link: string;
    pubDate: Date;
}
const isFeedItem = (v: any): v is FeedItem => {
    return v && v.pubDate && v.title && v.link;
}
export const fetchRss = async (env: RssEnv, lastServiceItem: ServiceItem | null): Promise<ServiceItem[]> => {
    const parser = new Parser();
    const feed = await parser.parseURL(env.rss_url);
    const cache = createCache<CacheItem>("rss.json");
    const oldItems = await cache.read();
    const newItems = feed.items.filter(item => {
        if (!isFeedItem(item)) {
            return false;
        }
        const id = item.link;
        return !oldItems.find(oldItem => oldItem.id === id);
    })
    const newEvents = newItems.map(item => {
        return {
            id: item.link,
            unixTimeMs: item.pubDate ? new Date(item.pubDate).getTime() : Date.now(),
        }
    }) as CacheItem[];
    await cache.merge(newEvents);
    return newItems.map(item => {
        if (!isFeedItem(item)) {
            throw new Error("invalid feed item");
        }
        return {
            type: RSSType,
            title: item.title,
            url: item.link,
            unixTimeMs: new Date(item.pubDate).getTime(),
        };
    });
}
