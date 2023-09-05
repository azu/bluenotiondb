import { ServiceItem } from "../common/ServiceItem.js";
import { NotionEnv } from "../notion/Notion.js";
import { graphql, GraphqlResponseError } from "@octokit/graphql";
import { SearchResultItemConnection } from "@octokit/graphql-schema";
import { createLogger } from "../common/logger.js";
import { RetryAbleError } from "../common/RetryAbleError.js";

const logger = createLogger("GitHubSearch");
export type GitHubSearchEnv = {
    github_token: string;
    github_search_query: string;
    github_search_type: "ISSUE" | "REPOSITORY";
} & NotionEnv;
export const isGitHubSearchEnv = (env: any): env is GitHubSearchEnv => {
    return typeof env.github_token === "string" && typeof env.github_search_query === "string";
}
export const GitHubSearchType = "GitHubSearch";
type SearchResultRepo = {
    __typename: "Repository";
    url: string;
    name: string;
    nameWithOwner: string;
    createdAt: string;
    updatedAt: string;
    description: string;
    owner: {
        avatarUrl: string;
        login: string;
        url: string;
    };
}
type SearchResultIssueOrPullRequest = {
    __typename: "PullRequest" | "Issue";
    number: number;
    url: string;
    title: string;
    createdAt: string;
    updatedAt: string;

    state: "OPEN" | "CLOSED" | "MERGED";
    author: {
        login: string;
    };
    repository: {
        nameWithOwner: string;
    }
    comments: {
        nodes: {
            body: string;
            url: string;
        }[];
    }
}
type SearchResultItem = SearchResultRepo | SearchResultIssueOrPullRequest;
export const searchGithub = ({
                                 query,
                                 size,
                                 type,
                                 GITHUB_TOKEN
                             }: { query: string, size: number; type: GitHubSearchEnv["github_search_type"]; GITHUB_TOKEN: string }): Promise<SearchResultItem[]> => {
    return graphql<{ search: SearchResultItemConnection }>(
        `
            query($QUERY: String!, $TYPE: SearchType!, $SIZE: Int!) {
                search(query: $QUERY, type: $TYPE, first: $SIZE) {
                    edges {
                        node {
                            __typename
                            ... on Repository {
                                url
                                name
                                nameWithOwner
                                createdAt
                                updatedAt
                            }
                            ... on PullRequest {
                                number
                                url
                                title
                                createdAt
                                updatedAt
                                state
                                author {
                                    login
                                }
                                repository {
                                    nameWithOwner
                                }
                                comments(last: 1) {
                                  nodes {
                                    url
                                  }
                                }
                            }
                            ... on Issue {
                                number
                                url
                                title
                                createdAt
                                updatedAt
                                state
                                author {
                                    avatarUrl
                                    login
                                    url
                                }
                                repository {
                                    nameWithOwner
                                }
                                comments(last: 1) {
                                  nodes {
                                    url
                                  }
                                }
                            }
                        }
                    }
                }
            }
        `,
        {
            QUERY: query,
            TYPE: type,
            SIZE: size,
            headers: {
                authorization: `token ${GITHUB_TOKEN}`
            }
        }
    ).then((result) => {
        return (result.search.edges?.flatMap((edge) => {
            return edge?.node ? [edge.node] : [];
        }) ?? []) as SearchResultItem[];
    }).catch((error) => {
        if (error instanceof GraphqlResponseError) {
            // 50x error will be retry
            const statusCode = Number(error.headers.status ?? 0);
            if (statusCode >= 500 && statusCode < 600) {
                throw new RetryAbleError("Retryable error on GitHub Search", {
                    cause: error,
                });
            }
        }
        throw error;
    });
};

type RelativeDateUnit = "day" | "month" | "year";
/**
 * return relative date
 * @param value - or + value
 * @param unit
 */
const relativeDate = (value: number, unit: RelativeDateUnit): Date => {
    const now = new Date();
    // year
    if (unit === "year") {
        return new Date(now.getFullYear() + value, now.getMonth(), now.getDate());
    } else if (unit === "month") {
        return new Date(now.getFullYear(), now.getMonth() + value, now.getDate());
    } else if (unit === "day") {
        return new Date(now.getFullYear(), now.getMonth(), now.getDate() + value);
    }
    throw new Error("invalid unit");
}
const formatYYYYMMDD = (date: Date): string => {
    // 2021-01-01
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
/**
 * Parse search query and resolve to date
 * @example
 * `test created:>{{+1day}}` -> `test created:>2021-01-02`
 * `test created:{{today}}` -> `test created:2021-01-01`
 * @param searchQuery
 */
export const parserFunction = (searchQuery: string) => {
    const relativeFunctionRegExp = /{{(?<operator>\+|-)?(?<value>\d+)(?<unit>day|month|year)}}/g;
    const relativeFunctionMatch = searchQuery.matchAll(relativeFunctionRegExp);
    // reverse to prevent index change
    for (const match of [...relativeFunctionMatch].reverse()) {
        const { operator, value, unit } = match.groups!;
        const relativeDateValue = relativeDate(Number(`${operator}${value}`), unit as RelativeDateUnit);
        // replace matched range to result
        searchQuery = searchQuery.substring(0, match.index)
            + formatYYYYMMDD(relativeDateValue)
            + searchQuery.substring(match.index! + match[0].length);
    }
    // {{today}} -> 2021-01-01
    const todayRegExp = /{{today}}/g;
    const todayMatch = searchQuery.matchAll(todayRegExp);
    for (const match of [...todayMatch].reverse()) {
        searchQuery = searchQuery.substring(0, match.index)
            + formatYYYYMMDD(new Date())
            + searchQuery.substring(match.index! + match[0].length);
    }
    return searchQuery;
}
export const collectUntil = (searchResults: SearchResultItem[], lastServiceItem: ServiceItem): SearchResultItem[] => {
    const filteredResults: SearchResultItem[] = [];
    try {
        for (const result of searchResults) {
            const updatedAtTime = new Date(result.updatedAt).getTime();
            if (lastServiceItem.unixTimeMs < updatedAtTime) {
                filteredResults.push(result);
            } else {
                return filteredResults;
            }
        }
    } catch (error) {
        logger.error(new Error("collect error", {
            cause: error,
        }));
        throw new Error("collect error at bluesky");
    }
    return filteredResults;
};
const getStateEmoji = (state: "OPEN" | "CLOSED" | "MERGED"): string => {
    switch (state) {
        case "OPEN":
            return "🟢";
        case "CLOSED":
            return "🔴";
        case "MERGED":
            return "🟣";
    }
}
const convertSearchResultToServiceItem = (result: SearchResultItem): ServiceItem => {
    switch (result.__typename) {
        case "Repository":
            return {
                type: "GitHub Repository",
                title: result.nameWithOwner,
                url: result.url,
                unixTimeMs: new Date(result.updatedAt).getTime(),
            }
        case "PullRequest":
        case "Issue":
            return {
                type: "GitHub Issue",
                // <repo>#<issue number> <title> <status>
                title: [
                    {
                        type: "text",
                        text: {
                            content: `${getStateEmoji(result.state)} ${result.repository.nameWithOwner}#${result.number} ${result.title} ${getStateEmoji(result.state)} ${result.state}`,
                            link: {
                                url: result.url
                            }
                        }
                    }
                ],
                // if comment exists, use comment url
                url: result.comments.nodes.length > 0 ? result.comments.nodes[0].url : result.url,
                unixTimeMs: new Date(result.updatedAt).getTime(),
            }
    }
    throw new Error("unknown type: " + (result as { __typename: never }).__typename)
}
const IGNORE_AUTHOR = ["dependabot-preview[bot]", "renovate", "dependabot[bot]"];
export const fetchGitHubSearch = async (env: GitHubSearchEnv, lastServiceItem: ServiceItem | null): Promise<ServiceItem[]> => {
    // fetch
    const searchResults = await searchGithub({
        query: parserFunction(env.github_search_query),
        type: env.github_search_type,
        GITHUB_TOKEN: env.github_token,
        size: 20
    });
    logger.info("searchResults count", searchResults.length);
    const searchResultsWithoutIgnoredAuthor = searchResults.filter((result) => {
        if (result.__typename === "Issue" || result.__typename === "PullRequest") {
            return !IGNORE_AUTHOR.includes(result.author.login);
        }
        return true;
    })
    // filter
    const filteredResults = lastServiceItem
        ? collectUntil(searchResultsWithoutIgnoredAuthor, lastServiceItem)
        : searchResultsWithoutIgnoredAuthor;
    logger.info("filtered results count", filteredResults.length)
    // convert
    return filteredResults.map(convertSearchResultToServiceItem);
}
