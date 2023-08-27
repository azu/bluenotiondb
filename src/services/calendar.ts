import ical from "node-ical"
import { NotionEnv } from "../notion/Notion.js";
import { ServiceItem } from "../common/Interface.js";
import * as fs from "fs/promises";

const CACHE_DIR = process.env.CACHE_DIR || "./cache"
export type CalendarEnv = {
    calendar_url: string;
} & NotionEnv;
// Days to fetch from today
const FETCH_DAYS = 28;
export const isCalendarEnv = (env: any): env is CalendarEnv => {
    return typeof env.calendar_url === "string";
}
// is targetDate between start and start + days
const isBetween = (targetDate: Date, start: Date, days: number) => {
    // early return
    if (targetDate.getTime() < start.getTime()) return false;
    const endDate = new Date(start.getTime() + days * 24 * 60 * 60 * 1000);
    return start <= targetDate && targetDate <= endDate;
}
const cacheFileName = "calendar.json";
type CacheItem = {
    id: string;
    unixTimeMs: number;
}

const readCache = async (): Promise<CacheItem[]> => {
    const cachePath = `${CACHE_DIR}/${cacheFileName}`;
    try {
        const cache = await fs.readFile(cachePath, "utf-8");
        return JSON.parse(cache) as CacheItem[];
    } catch (e) {
        return [];
    }
}
const writeCache = async (cache: CacheItem[]) => {
    await fs.mkdir(CACHE_DIR, { recursive: true });
    const cachePath = `${CACHE_DIR}/${cacheFileName}`;
    await fs.writeFile(cachePath, JSON.stringify(cache));
}
const updateCacheEvents = ({
                               cache,
                               newEvents,
                               today = new Date()
                           }: { cache: CacheItem[], newEvents: { uid: string; unixTimeMs: number }[], today?: Date }) => {
    // add serviceItems to cache
    const newCache = cache.concat(newEvents.map(item => {
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
export const fetchCalendar = async (env: CalendarEnv, lastServiceItem: ServiceItem | null): Promise<ServiceItem[]> => {
    const res = await fetch(env.calendar_url).then(res => {
        if (res.ok) {
            return res.text();
        }
        throw new Error("Calendar fetch failed");
    });
    const ics = await ical.parseICS(res);
    // start of day
    const startOfToday = new Date(new Date().setHours(0, 0, 0, 0));
    const events = Object.values(ics)
        .filter((event) => {
            if (event.type !== "VEVENT") {
                return false;
            }
            return isBetween(event.start, startOfToday, FETCH_DAYS);
        })
        .map(event => {
            if (event.type !== "VEVENT") {
                throw new Error("Event type is not VEVENT");
            }
            return {
                uid: event.uid,
                title: event.summary,
                url: event.url,
                unixTimeMs: event.start.getTime(),
            }
        });
    const cache = await readCache();
    const newEvents = events.filter(event => {
        return !cache.some(item => item.id === event.uid);
    });
    const newCache = updateCacheEvents({ cache, newEvents: newEvents, today: startOfToday });
    await writeCache(newCache);
    return newEvents.map(item => {
        return {
            type: "calendar",
            title: item.title,
            url: item.url,
            unixTimeMs: item.unixTimeMs,
        }
    });
}
