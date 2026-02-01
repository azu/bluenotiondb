import { expect, test, describe, mock, beforeEach, afterEach } from "bun:test";
import { fetchLocation, isLocationEnv, LocationType } from "./location.js";

describe("isLocationEnv", () => {
    test("returns true for valid LocationEnv", () => {
        const env = {
            location_api_url: "https://example.com/api/locations",
            location_api_token: "test-token",
            notion_api_key: "secret_xxx",
            notion_database_id: "xxx",
        };
        expect(isLocationEnv(env)).toBe(true);
    });

    test("returns true with optional device_id", () => {
        const env = {
            location_api_url: "https://example.com/api/locations",
            location_api_token: "test-token",
            location_device_id: "device-1",
            notion_api_key: "secret_xxx",
            notion_database_id: "xxx",
        };
        expect(isLocationEnv(env)).toBe(true);
    });

    test("returns false when location_api_url is missing", () => {
        const env = {
            location_api_token: "test-token",
            notion_api_key: "secret_xxx",
            notion_database_id: "xxx",
        };
        expect(isLocationEnv(env)).toBe(false);
    });

    test("returns false when location_api_token is missing", () => {
        const env = {
            location_api_url: "https://example.com/api/locations",
            notion_api_key: "secret_xxx",
            notion_database_id: "xxx",
        };
        expect(isLocationEnv(env)).toBe(false);
    });

    test("returns false for null", () => {
        expect(isLocationEnv(null)).toBe(false);
    });

    test("returns false for non-object", () => {
        expect(isLocationEnv("string")).toBe(false);
    });
});

describe("fetchLocation", () => {
    const mockGeoJSONResponse = {
        type: "FeatureCollection",
        features: [
            {
                type: "Feature",
                geometry: {
                    type: "Point",
                    coordinates: [139.7671, 35.6812], // [lon, lat]
                },
                properties: {
                    timestamp: "2024-01-15T10:30:00Z",
                    device_id: "device-1",
                    speed: 1.44, // m/s (~5.2 km/h)
                },
            },
            {
                type: "Feature",
                geometry: {
                    type: "Point",
                    coordinates: [-122.4194, 37.7749], // San Francisco
                },
                properties: {
                    timestamp: "2024-01-15T11:00:00Z",
                    device_id: "device-1",
                },
            },
        ],
    };

    const mockEnv = {
        location_api_url: "https://example.com/api/locations",
        location_api_token: "test-token",
        notion_api_key: "secret_xxx",
        notion_database_id: "xxx",
    };

    beforeEach(() => {
        process.env.BLUE_NOTION_DRY_RUN = "true";
    });

    afterEach(() => {
        delete process.env.BLUE_NOTION_DRY_RUN;
        mock.restore();
    });

    test("fetches and converts location data to ServiceItems", async () => {
        const mockFetch = mock(() =>
            Promise.resolve({
                ok: true,
                json: () => Promise.resolve(mockGeoJSONResponse),
            } as Response)
        );
        globalThis.fetch = mockFetch;

        const result = await fetchLocation(mockEnv, null);

        expect(mockFetch).toHaveBeenCalledTimes(1);
        const callArgs = mockFetch.mock.calls[0];
        expect(callArgs[0]).toContain("https://example.com/api/locations");
        expect(callArgs[0]).toContain("format=geojson");
        expect(callArgs[1]).toEqual({
            headers: {
                Authorization: "Bearer test-token",
            },
        });

        expect(result.length).toBe(2);

        // First item - Tokyo with speed
        expect(result[0].type).toBe(LocationType);
        expect(result[0].title).toBe("Location: 35.68N, 139.77E (5.2km/h)");
        expect(result[0].url).toBe("https://www.google.com/maps?q=35.6812,139.7671");
        expect(result[0].unixTimeMs).toBe(new Date("2024-01-15T10:30:00Z").getTime());

        // Second item - San Francisco without speed
        expect(result[1].type).toBe(LocationType);
        expect(result[1].title).toBe("Location: 37.77N, 122.42W");
        expect(result[1].url).toBe("https://www.google.com/maps?q=37.7749,-122.4194");
    });

    test("adds device_id to query when provided", async () => {
        const mockFetch = mock(() =>
            Promise.resolve({
                ok: true,
                json: () => Promise.resolve({ type: "FeatureCollection", features: [] }),
            } as Response)
        );
        globalThis.fetch = mockFetch;

        const envWithDevice = {
            ...mockEnv,
            location_device_id: "my-device",
        };

        await fetchLocation(envWithDevice, null);

        const callUrl = mockFetch.mock.calls[0][0] as string;
        expect(callUrl).toContain("device_id=my-device");
    });

    test("adds from parameter with ISO 8601 format when lastServiceItem exists", async () => {
        const mockFetch = mock(() =>
            Promise.resolve({
                ok: true,
                json: () => Promise.resolve(mockGeoJSONResponse),
            } as Response)
        );
        globalThis.fetch = mockFetch;

        const lastItem = {
            type: LocationType,
            title: "Previous location",
            unixTimeMs: new Date("2024-01-15T10:45:00Z").getTime(),
        };

        const result = await fetchLocation(mockEnv, lastItem);

        // Check that from parameter is set with ISO 8601 format
        const callUrl = mockFetch.mock.calls[0][0] as string;
        expect(callUrl).toContain("from=2024-01-15T10%3A45%3A00.000Z");

        // Only the second item (11:00) should be returned
        expect(result.length).toBe(1);
        expect(result[0].title).toBe("Location: 37.77N, 122.42W");
    });

    test("uses 24 hours ago as default from when lastServiceItem is null", async () => {
        const mockFetch = mock(() =>
            Promise.resolve({
                ok: true,
                json: () => Promise.resolve(mockGeoJSONResponse),
            } as Response)
        );
        globalThis.fetch = mockFetch;

        await fetchLocation(mockEnv, null);

        const callUrl = mockFetch.mock.calls[0][0] as string;
        // Should have both from and to parameters
        expect(callUrl).toContain("from=");
        expect(callUrl).toContain("to=");
    });

    test("always includes from and to parameters", async () => {
        const mockFetch = mock(() =>
            Promise.resolve({
                ok: true,
                json: () => Promise.resolve(mockGeoJSONResponse),
            } as Response)
        );
        globalThis.fetch = mockFetch;

        const lastItem = {
            type: LocationType,
            title: "Previous location",
            unixTimeMs: new Date("2024-01-15T10:45:00Z").getTime(),
        };

        await fetchLocation(mockEnv, lastItem);

        const callUrl = mockFetch.mock.calls[0][0] as string;
        expect(callUrl).toContain("from=2024-01-15T10%3A45%3A00.000Z");
        expect(callUrl).toContain("to=");
    });

    test("throws error on API failure", async () => {
        const mockFetch = mock(() =>
            Promise.resolve({
                ok: false,
                status: 401,
                statusText: "Unauthorized",
            } as Response)
        );
        globalThis.fetch = mockFetch;

        await expect(fetchLocation(mockEnv, null)).rejects.toThrow(
            "Failed to fetch location: 401 Unauthorized"
        );
    });

    test("handles negative speed values", async () => {
        const response = {
            type: "FeatureCollection",
            features: [
                {
                    type: "Feature",
                    geometry: {
                        type: "Point",
                        coordinates: [0, 0],
                    },
                    properties: {
                        timestamp: "2024-01-15T10:30:00Z",
                        speed: -1, // Invalid speed
                    },
                },
            ],
        };

        const mockFetch = mock(() =>
            Promise.resolve({
                ok: true,
                json: () => Promise.resolve(response),
            } as Response)
        );
        globalThis.fetch = mockFetch;

        const result = await fetchLocation(mockEnv, null);

        expect(result[0].title).toBe("Location: 0.00N, 0.00E");
    });
});
