import ical from "node-ical"
import { NotionEnv } from "../notion/Notion.js";
import { ServiceItem } from "../common/ServiceItem.js";
import { createCache } from "../common/cache.js";

export type CalendarEnv = {
    calendar_url: string;
} & NotionEnv;
export const CalendarType = "calendar";
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
const cacheFileName = "calendar.json" as const;
type CacheItem = {
    id: string;
    unixTimeMs: number;
}
const updateCacheEvents = ({
                               oldEvents,
                               newEvents,
                               today = new Date()
                           }: { oldEvents: CacheItem[], newEvents: { uid: string; unixTimeMs: number }[], today?: Date }) => {
    // add serviceItems to cache
    const newCache = oldEvents.concat(newEvents.map(item => {
        return {
            unixTimeMs: item.unixTimeMs,
            id: item.uid,
        }
    }));
    // remove old cache - before FETCH_DAYS
    const CacheLimitDate = new Date(today.getTime() - (24 * 60 * 60 * 1000) * FETCH_DAYS);
    return newCache.filter(item => {
        return item.unixTimeMs >= CacheLimitDate.getTime();
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
    const cache = createCache<CacheItem>(cacheFileName);
    const cachedEvents = await cache.read();
    const newEvents = events.filter(event => {
        return !cachedEvents.some(item => item.id === event.uid);
    });
    const newCache = updateCacheEvents({
        oldEvents: cachedEvents,
        newEvents: newEvents,
        today: startOfToday
    });
    await cache.write(newCache);
    return newEvents.map(item => {
        return {
            type: CalendarType,
            title: item.title,
            url: item.url,
            unixTimeMs: item.unixTimeMs,
        }
    });
}
