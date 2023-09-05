import { CreatePageParameters } from "@notionhq/client/build/src/api-endpoints.js";

type ExtractRecordValue<R> = R extends Record<infer _, infer V> ? V : never;
type PropertyTypes = ExtractRecordValue<CreatePageParameters["properties"]>;
// get title type
type TitleProperty = Extract<PropertyTypes, { type?: "title" | undefined }>;
export type ServiceItem = {
    type: string;
    title: string | TitleProperty["title"];
    unixTimeMs: number;
    url?: string;
    // If the service is a child of another service, this will be the parent service's url
    parent?: {
        url: string;
    };
}
