import { Client, LogLevel } from "@notionhq/client";
import type { ServiceItem } from "../common/Interface.js";
import { PageObjectResponse } from "@notionhq/client/build/src/api-endpoints.js";
import { errorLog, info } from "../common/logger.js";

type PropertyValueType = {
    multi_select: {
        name: string;
    }[]
};
type NotionExtra = {
    propertyName: string;
    propertyValue: PropertyValueType;
}[]
export type NotionEnv = {
    notion_database_id: string;
    notion_api_key: string;

    /**
     * @example
     * [{ "propertyName":"Tags", "propertyValue": { "multi_select": [{ "name": "foo" }] } }]
     */
    notion_extra: NotionExtra;
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
        // Notion Date does not have seconds
        // Adjust 1min to avoid duplication
        // @ts-ignore
        const startDate = new Date(result.properties.Date.date.start);
        const adjustedStartDate = new Date(startDate.getTime() + 1000 * 60);
        return {
            //@ts-ignore
            type: result.properties.Type?.select?.name,
            //@ts-ignore
            url: result.properties.URL.url,
            //@ts-ignore
            title: result.properties.Title.title?.[0]?.text?.content,
            unixTimeMs: adjustedStartDate.getTime(),

        }
    }
}
export const createPage = async (env: NotionEnv, ir: ServiceItem) => {
    const notion = new Client({
        auth: env.notion_api_key,
        logLevel: LogLevel.WARN,
    });
    const extra = env.notion_extra ?? [];
    return notion.pages.create({
        parent: { database_id: env.notion_database_id },
        properties: {
            Title: {
                title: typeof ir.title === "string"
                    ? [{
                        type: "text",
                        text: { content: ir.title }
                    }]
                    : ir.title,
            },
            Type: {
                select: { name: ir.type },
            },
            Date: {
                date: { start: new Date(ir.unixTimeMs).toISOString() },
            },
            URL: { url: ir.url },
            ...(Object.fromEntries(extra.map(e => [e.propertyName, e.propertyValue]))),
        },
    });
};

export const syncToNotion = async (env: NotionEnv, irs: ServiceItem[]) => {
    const isDryRun = process.env.DRY_RUN === "true";
    let count = 0;
    for (const ir of irs) {
        try {
            info(`syncing ${count++}/${irs.length}`);
            if (!isDryRun) {
                await createPage(env, ir);
            }
        } catch (e) {
            errorLog(e);
            throw new Error(`failed to sync at ${count}/${irs.length}`);
        }
    }
}
