import * as fs from "fs/promises";
import * as path from "path";
import { debug } from "./logger.js";

const CACHE_DIR = process.env.CACHE_DIR || path.join(process.cwd(), "./cache");
/**
 * Create cache object
 * store cache in CACHE_DIR
 * @param cacheFileName
 */
export const createCache = <T>(cacheFileName: string) => {
    const read = async (): Promise<T[]> => {
        const cachePath = path.join(CACHE_DIR, cacheFileName);
        try {
            const cache = await fs.readFile(cachePath, "utf-8");
            const cachedItems = JSON.parse(cache) as T[];
            debug("read cache", cachedItems);
            return cachedItems;
        } catch (e) {
            return [];
        }
    }
    const write = async (cache: T[]) => {
        // DRY run
        if (process.env.BLUE_NOTION_DRY_RUN) {
            debug("[DRY RUN] write cache", cache)
            return;
        }
        await fs.mkdir(CACHE_DIR, { recursive: true });
        const cachePath = path.join(CACHE_DIR, cacheFileName);
        debug("write cache", cache)
        await fs.writeFile(cachePath, JSON.stringify(cache), "utf-8");
    }

    const merge = async (cache: T[]) => {
        const oldCache = await read();
        const newCache = [...oldCache, ...cache];
        await write(newCache);
    }
    return {
        read,
        write,
        merge
    }
}
