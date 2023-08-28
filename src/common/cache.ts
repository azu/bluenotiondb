import * as fs from "fs/promises";

const CACHE_DIR = process.env.CACHE_DIR || "./cache"
export const createCache = <T>(cacheFileName: string) => {
    const read = async (): Promise<T[]> => {
        const cachePath = `${CACHE_DIR}/${cacheFileName}`;
        try {
            const cache = await fs.readFile(cachePath, "utf-8");
            return JSON.parse(cache) as T[];
        } catch (e) {
            return [];
        }
    }
    const write = async (cache: T[]) => {
        await fs.mkdir(CACHE_DIR, { recursive: true });
        const cachePath = `${CACHE_DIR}/${cacheFileName}`;
        await fs.writeFile(cachePath, JSON.stringify(cache));
    }

    return {
        read,
        write
    }
}
