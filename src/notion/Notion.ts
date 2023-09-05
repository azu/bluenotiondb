import { Client, LogLevel } from "@notionhq/client";
import type { ServiceItem } from "../common/ServiceItem.js";
import { PageObjectResponse } from "@notionhq/client/build/src/api-endpoints.js";
import { errorLog, info } from "../common/logger.js";
import { SupportedEnv, typeOfEnv } from "./envs.js";

type PropertyValueType = {
    multi_select: {
        name: string;
    }[]
};
type NotionExtra = {
    [propertyName: string]: PropertyValueType;
}[];
type NotionPropertyNames = {
    Title: string;
    Type: string;
    Date: string;
    URL: string;
    Parent: string;
}
export type NotionEnv = {
    notion_database_id: string;
    notion_api_key: string;

    /**
     * Change the property names of Notion
     * { [original]: [new] }
     * @example
     * { "Title": "Tasks", "URL": "url" }
     */
    notion_property_names?: NotionPropertyNames;
    /**
     * Note: Same property name will be overwritten
     * @example
     * { "Tags" { "multi_select": [{ "name": "foo" }] }
     */
    notion_extra?: NotionExtra;
}
export const assertNotionEnv = (env: any): void => {
    if (env.notion_database_id === undefined) {
        throw new Error("env.notion_database_id is undefined");
    }
    if (env.notion_api_key === undefined) {
        throw new Error("env.notion_api_key is undefined");
    }
}
const getNotionPropertyNames = (env: NotionEnv): NotionPropertyNames => {
    const originalPropertyNames = {
        "Title": "Title",
        "Type": "Type",
        "Date": "Date",
        "URL": "URL",
        "Parent": "Parent"
    };
    if (env.notion_property_names === undefined) {
        return originalPropertyNames;
    }
    const notionPropertyNames = env.notion_property_names;
    return {
        "Title": notionPropertyNames.Title ?? originalPropertyNames.Title,
        "Type": notionPropertyNames.Type ?? originalPropertyNames.Type,
        "Date": notionPropertyNames.Date ?? originalPropertyNames.Date,
        "URL": notionPropertyNames.URL ?? originalPropertyNames.URL,
        "Parent": notionPropertyNames.Parent ?? originalPropertyNames.Parent,
    }
}
export const fetchLastPage = async (env: SupportedEnv): Promise<null | ServiceItem> => {
    const envType = typeOfEnv(env);
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
        filter: {
            property: "Type",
            select: {
                equals: envType,
            }
        },
        page_size: 1,
    });
    if (queryDatabaseResponsePromise.results.length === 0) {
        return null
    } else {
        const propertyNames = getNotionPropertyNames(env);
        const result = queryDatabaseResponsePromise.results[0] as PageObjectResponse;
        // This database is not only bluenotiondb.
        // Maybe the first page is not bluenotiondb.
        if (!result.properties[propertyNames.Date] || !result.properties[propertyNames.Type] || !result.properties[propertyNames.Title]) {
            return null;
        }
        // Notion Date does not have seconds
        // Adjust 1min to avoid duplication
        // @ts-ignore
        const startDate = new Date(result.properties[propertyNames.Date].date.start);
        const adjustedStartDate = new Date(startDate.getTime() + 1000 * 60);
        return {
            //@ts-ignore
            type: result.properties[propertyNames.Type]?.select?.name,
            //@ts-ignore
            url: result.properties[propertyNames.URL]?.url,
            //@ts-ignore
            title: result.properties[propertyNames.Title]?.title?.[0]?.text?.content,
            unixTimeMs: adjustedStartDate.getTime(),

        }
    }
}
export const createPage = async (env: NotionEnv, ir: ServiceItem) => {
    const notion = new Client({
        auth: env.notion_api_key,
        logLevel: LogLevel.WARN,
    });
    const extra = env.notion_extra ?? {};
    const NOTION_MAX_TITLE_LENGTH = 2000;
    const notionPropertyNames = getNotionPropertyNames(env);

    const parentRelation = await (async () => {
        if (!ir.parent) return undefined;

        const parentPage = await notion.databases.query({
            database_id: env.notion_database_id,
            sorts: [
                {
                    property: "Date",
                    direction: "descending",
                    timestamp: "created_time",
                }
            ],
            filter: {
                property: notionPropertyNames.URL,
                url: {
                    equals: ir.parent.url,
                }
            },
            page_size: 1,
        });
        if (parentPage.results.length === 0) {
            return undefined;
        }
        return {
            page_id: parentPage.results[0].id,
        }
    })();
    const properties = {
        [notionPropertyNames.Title]: {
            title: typeof ir.title === "string"
                ? [{
                    type: "text",
                    text: { content: ir.title.slice(0, NOTION_MAX_TITLE_LENGTH) }
                }]
                : ir.title.slice(0, NOTION_MAX_TITLE_LENGTH),
        },
        [notionPropertyNames.Type]: {
            select: { name: ir.type },
        },
        [notionPropertyNames.Date]: {
            date: { start: new Date(ir.unixTimeMs).toISOString() },
        },
        ...(ir.url === undefined ? {} : {
            [notionPropertyNames.URL]: { url: ir.url },
        }),
        ...(parentRelation === undefined ? {} : {
            [notionPropertyNames.Parent]: {
                relation: [{
                    id: parentRelation.page_id,
                }]
            },
        }),
        // extra will overwrite the same property name
        ...extra,
    };
    return notion.pages.create({
        parent: { database_id: env.notion_database_id },
        properties: properties,
    });
};

export const syncToNotion = async (env: NotionEnv, irs: ServiceItem[]) => {
    const isDryRun = Boolean(process.env.BLUE_NOTION_DRY_RUN);
    let count = 1;
    for (const ir of irs) {
        try {
            info(`syncing ${count++}/${irs.length}`);
            if (!isDryRun) {
                await createPage(env, ir);
            }
        } catch (e) {
            errorLog("Fail to sync: " + JSON.stringify(ir));
            errorLog(e);
            throw new Error(`failed to sync at ${count}/${irs.length}`);
        }
    }
}
