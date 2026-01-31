import { ServiceItem } from "../common/ServiceItem.js";
import { NotionEnv } from "../notion/Notion.js";
import { createLogger } from "../common/logger.js";
import { createCache } from "../common/cache.ts";

const logger = createLogger("Linear");
export type LinearEnv = {
    linear_token: string;
    linear_search_type: "assigned_me" | "created_by_me" | "activity";
} & NotionEnv;
export const LinearType = "Linear" as const;
export const isLinearEnv = (env: any): env is LinearEnv => {
    return typeof env.linear_token === "string" && typeof env.linear_search_type === "string";
}
type ServiceItemWithId = ServiceItem & { id: string };
type IssueNode = {
    id: string;
    title: string;
    url: string;
    updatedAt: string; // ISO8601
    createdAt: string; // ISO8601
};
type searchAssignedIssuesResponse = {
    data: {
        viewer: {
            assignedIssues: {
                nodes: IssueNode[];
            };
        };
    };
};
type searchCreatedIssuesResponse = {
    data: {
        viewer: {
            createdIssues: {
                nodes: IssueNode[];
            };
        };
    };
};

// Activity related types
type CommentNode = {
    id: string;
    body: string;
    createdAt: string;
    issue: {
        id: string;
        title: string;
        url: string;
    } | null;
};
type CommentsResponse = {
    data: {
        comments: {
            nodes: CommentNode[];
        };
    };
    errors?: Array<{ message: string }>;
};
type HistoryNode = {
    id: string;
    createdAt: string;
    actor: {
        id: string;
        isMe: boolean;
        name: string;
    } | null;
    fromState: { name: string } | null;
    toState: { name: string } | null;
    fromAssignee: { name: string } | null;
    toAssignee: { name: string } | null;
    fromPriority: number | null;
    toPriority: number | null;
};
type IssueWithHistory = {
    id: string;
    title: string;
    url: string;
    history: {
        nodes: HistoryNode[];
    };
};
type IssueHistoryResponse = {
    data: {
        viewer: {
            assignedIssues: {
                nodes: IssueWithHistory[];
            };
        };
    };
    errors?: Array<{ message: string }>;
};
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
    const json = await res.json() as searchCreatedIssuesResponse;
    return json.data.viewer.createdIssues.nodes.map((node) => {
        return {
            id: node.id,
            type: LinearType,
            title: node.title,
            url: node.url,
            unixTimeMs: new Date(node.updatedAt).getTime(),
        };
    });
}

// Activity: 自分のコメントを取得
async function searchMyComments({ token }: { token: string }): Promise<ServiceItemWithId[]> {
    const res = await fetch("https://api.linear.app/graphql", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `${token}`,
        },
        body: JSON.stringify({
            query: `query {
  comments(filter: { user: { isMe: { eq: true } } }, first: 50, orderBy: createdAt) {
    nodes {
      id
      body
      createdAt
      issue { id title url }
    }
  }
}`
        })
    });
    if (!res.ok) {
        throw new Error("failed to fetch linear comments");
    }
    const json = await res.json() as CommentsResponse;
    if (json.errors) {
        logger.warn("comments query failed, trying fallback", json.errors);
        return [];
    }
    return json.data.comments.nodes
        .filter((node) => node.issue !== null)
        .map((node) => {
            const bodyPreview = node.body.length > 100 ? node.body.slice(0, 100) + "..." : node.body;
            return {
                id: `comment-${node.id}`,
                type: LinearType,
                title: `💬 ${node.issue!.title}: ${bodyPreview}`,
                url: node.issue!.url,
                unixTimeMs: new Date(node.createdAt).getTime(),
            };
        });
}

// Activity: IssueのHistory（ステータス変更、アサイン変更、優先度変更など）を取得
async function searchMyIssueHistory({ token }: { token: string }): Promise<ServiceItemWithId[]> {
    const res = await fetch("https://api.linear.app/graphql", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `${token}`,
        },
        body: JSON.stringify({
            query: `query {
  viewer {
    assignedIssues(first: 20, orderBy: updatedAt) {
      nodes {
        id
        title
        url
        history(first: 10) {
          nodes {
            id
            createdAt
            actor { id isMe name }
            fromState { name }
            toState { name }
            fromAssignee { name }
            toAssignee { name }
            fromPriority
            toPriority
          }
        }
      }
    }
  }
}`
        })
    });
    if (!res.ok) {
        throw new Error("failed to fetch linear issue history");
    }
    const json = await res.json() as IssueHistoryResponse;
    if (json.errors) {
        logger.warn("issue history query failed", json.errors);
        return [];
    }
    const results: ServiceItemWithId[] = [];
    for (const issue of json.data.viewer.assignedIssues.nodes) {
        for (const history of issue.history.nodes) {
            // 自分のアクションのみ
            if (!history.actor?.isMe) continue;

            // ステータス変更
            if (history.fromState && history.toState) {
                results.push({
                    id: `history-state-${history.id}`,
                    type: LinearType,
                    title: `🔄 ${issue.title}: ${history.fromState.name} → ${history.toState.name}`,
                    url: issue.url,
                    unixTimeMs: new Date(history.createdAt).getTime(),
                });
                continue;
            }

            // アサイン変更
            if (history.fromAssignee || history.toAssignee) {
                const from = history.fromAssignee?.name ?? "未割り当て";
                const to = history.toAssignee?.name ?? "未割り当て";
                results.push({
                    id: `history-assign-${history.id}`,
                    type: LinearType,
                    title: `👤 ${issue.title}: ${from} → ${to}`,
                    url: issue.url,
                    unixTimeMs: new Date(history.createdAt).getTime(),
                });
                continue;
            }

            // 優先度変更
            if (history.fromPriority !== null || history.toPriority !== null) {
                const priorityLabels = ["なし", "Urgent", "High", "Medium", "Low"];
                const from = priorityLabels[history.fromPriority ?? 0] ?? String(history.fromPriority);
                const to = priorityLabels[history.toPriority ?? 0] ?? String(history.toPriority);
                results.push({
                    id: `history-priority-${history.id}`,
                    type: LinearType,
                    title: `⬆️ ${issue.title}: ${from} → ${to}`,
                    url: issue.url,
                    unixTimeMs: new Date(history.createdAt).getTime(),
                });
                continue;
            }
        }
    }
    return results;
}

// Activity: 自分が作成したIssueを取得
async function searchMyCreatedIssues({ token }: { token: string }): Promise<ServiceItemWithId[]> {
    const res = await fetch("https://api.linear.app/graphql", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `${token}`,
        },
        body: JSON.stringify({
            query: `query {
  viewer {
    createdIssues(first: 20, orderBy: createdAt) {
      nodes {
        id
        title
        url
        createdAt
      }
    }
  }
}`
        })
    });
    if (!res.ok) {
        throw new Error("failed to fetch linear created issues");
    }
    const json = await res.json() as searchCreatedIssuesResponse;
    return json.data.viewer.createdIssues.nodes.map((node) => {
        return {
            id: `created-${node.id}`,
            type: LinearType,
            title: `📝 ${node.title}`,
            url: node.url,
            unixTimeMs: new Date(node.createdAt).getTime(),
        };
    });
}

// Activity: コメント + ステータス変更 + Issue作成を取得
async function searchActivity({ token }: { token: string }): Promise<ServiceItemWithId[]> {
    const [comments, history, created] = await Promise.all([
        searchMyComments({ token }),
        searchMyIssueHistory({ token }),
        searchMyCreatedIssues({ token }),
    ]);
    // 全て結合して時間順にソート
    const all = [...comments, ...history, ...created];
    all.sort((a, b) => b.unixTimeMs - a.unixTimeMs);
    return all;
}

async function searchLinear({ type, token }: {
    type: LinearEnv["linear_search_type"],
    token: string
}): Promise<ServiceItemWithId[]> {
    if (type === "assigned_me") {
        return searchAssignedIssues({ token });
    } else if (type === "created_by_me") {
        return searchCreatedByMe({ token });
    } else if (type === "activity") {
        return searchActivity({ token });
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
