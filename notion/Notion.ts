import { Client, LogLevel } from "@notionhq/client";
import type { ServiceItem } from "../common/Interface.js";
import { PageObjectResponse } from "@notionhq/client/build/src/api-endpoints.js";

export type NotionEnv = {
    notion_database_id: string;
    notion_api_key: string;
}
export const assertNotionEnv = (env: any): void => {
    if (env.notion_database_id === undefined) {
        throw new Error("env.notion_database_id is undefined");
    }
    if (env.notion_api_key === undefined) {
        throw new Error("env.notion_api_key is undefined");
    }
}
export const fetchLastPage = async (env: NotionEnv): Promise<null | ServiceItem> => {
    const notion = new Client({
        auth: env.notion_api_key,
        logLevel: LogLevel.WARN,
    });
    const queryDatabaseResponsePromise = await notion.databases.query({
        database_id: env.notion_database_id,
        sorts: [
            {
                property: "Date",
                direction: "descending",
                timestamp: "created_time",
            }
        ],
        page_size: 1,
    });
    if (queryDatabaseResponsePromise.results.length === 0) {
        return null
    } else {
        const result = queryDatabaseResponsePromise.results[0] as PageObjectResponse;
        return {
            //@ts-ignore
            url: result.properties.URL.url,
            //@ts-ignore
            title: result.properties.Title.title[0].text.content,
            //@ts-ignore
            unixTimeMs: new Date(result.properties.Date.date.start).getTime(),

        }
    }
}
export const createPage = async (env: NotionEnv, ir: ServiceItem) => {
    const notion = new Client({
        auth: env.notion_api_key,
        logLevel: LogLevel.WARN,
    });

    return notion.pages.create({
        parent: { database_id: env.notion_database_id },
        properties: {
            Title: {
                title: [{ text: { content: ir.title } }],
            },
            Date: {
                date: { start: new Date(ir.unixTimeMs).toISOString() },
            },
            URL: { url: ir.url },
        },
    });
};

export const syncToNotion = async (env: NotionEnv, irs: ServiceItem[]) => {
    let count = 0;
    for (const ir of irs) {
        try {
            console.info(`syncing ${count++}/${irs.length} - ${ir.url}`);
            await createPage(env, ir);
        } catch (e) {
            console.error(e);
        }
    }
}
