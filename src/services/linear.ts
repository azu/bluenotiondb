import { ServiceItem } from "../common/ServiceItem.js";
import { NotionEnv } from "../notion/Notion.js";
import { createLogger } from "../common/logger.js";
import { createCache } from "../common/cache.ts";

const logger = createLogger("Linear");
export type LinearEnv = {
    linear_token: string;
    linear_search_type: "assigned_me" | "created_by_me";
} & NotionEnv;
export const LinearType = "Linear" as const;
export const isLinearEnv = (env: any): env is LinearEnv => {
    return typeof env.linear_token === "string" && typeof env.linear_search_type === "string";
}
type ServiceItemWithId = ServiceItem & { id: string };
type searchAssignedIssuesResponse = {
    data: {
        viewer: {
            assignedIssues: {
                nodes: {
                    id: string;
                    title: string;
                    url: string;
                    updatedAt: string;//ISO8601
                }[]
            }
        }
    }
}
async function searchAssignedIssues({ token }: { token: string }): Promise<ServiceItemWithId[]> {
    // graphql req
    const res = await fetch("https://api.linear.app/graphql", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `${token}`,
        },
        body: JSON.stringify({
            query: `query {
  viewer {
    assignedIssues(orderBy: updatedAt, first: 20, filter: {
        state: {
          type: {
            eq: "started"
          }
        }
    }){
      nodes {
        id
        title
        url
        updatedAt
      }
    }
  }
}`
        })
    });
    if (!res.ok) {
        throw new Error("failed to fetch linear issues");
    }
    const json = await res.json() as searchAssignedIssuesResponse;
    return json.data.viewer.assignedIssues.nodes.map((node) => {
        return {
            id: node.id,
            type: LinearType,
            title: node.title,
            url: node.url,
            unixTimeMs: new Date(node.updatedAt).getTime(),
        }
    });
}

async function searchCreatedByMe({ token }: { token: string }): Promise<ServiceItemWithId[]> {
    // graphql req
    const res = await fetch("https://api.linear.app/graphql", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `${token}`,
        },
        body: JSON.stringify({
            query: `query {
  viewer {
    createdIssues(orderBy: updatedAt, first: 20, filter: {
        state: {
          type: {
            eq: "started"
          }
        }
    }){
      nodes {
        id
        title
        url
        updatedAt
      }
    }
  }
}`
        })
    });
    if (!res.ok) {
        throw new Error("failed to fetch linear issues");
    }
    const json = await res.json() as searchAssignedIssuesResponse;
    return json.data.viewer.assignedIssues.nodes.map((node) => {
        return {
            id: node.id,
            type: LinearType,
            title: node.title,
            url: node.url,
            unixTimeMs: new Date(node.updatedAt).getTime(),
        }
    });

}

async function searchLinear({ type, token }: {
    type: LinearEnv["linear_search_type"],
    token: string
}): Promise<ServiceItemWithId[]> {
    if (type === "assigned_me") {
        return searchAssignedIssues({ token });
    } else if (type === "created_by_me") {
        return searchCreatedByMe({ token });
    }
    throw new Error("invalid type: " + (type satisfies never));
}

export const fetchLinear = async (env: LinearEnv, _lastServiceItem: ServiceItem | null): Promise<ServiceItem[]> => {
    const searchResults = await searchLinear({
        type: env.linear_search_type,
        token: env.linear_token!,
    });
    const cache = createCache<ServiceItemWithId>("linear.json");
    const cachedEvents = await cache.read();
    logger.info("searchResults count", searchResults.length);
    const filteredResults = searchResults.filter((result) => {
        return !cachedEvents.some((cachedEvent) => cachedEvent.id === result.id);

    })
    logger.info("filtered results count", filteredResults.length)
    await cache.write(cachedEvents.concat(filteredResults));
    return filteredResults;
}
