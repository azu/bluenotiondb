import { describe, expect, test } from "bun:test";
import { typeOfEnv } from "./envs.js";

describe('envs', function () {
    test("typeofEnv(env) returns type string of the env", () => {
        const type = typeOfEnv({
            "notion_database_id": "xxx",
            "notion_api_key": "xxx",
            "rss_url": "https://rsshub.app/github/repos/azu",
        });
        expect(type).toBe("RSS");
    });
    test("when env has notion_extra type, should return the name of the type", () => {
        const type = typeOfEnv({
            "notion_database_id": "xxx",
            "notion_api_key": "xxx",
            "rss_url": "https://rsshub.app/github/repos/azu",
            // @ts-expect-error
            "notion_extra": { "Type": { "select": { "name": "My GitHub Repository" } } }
        });
        expect(type).toBe("My GitHub Repository");
    })
});
