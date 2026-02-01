import { NotionEnv } from "../notion/Notion.js";
import { ServiceItem } from "../common/ServiceItem.js";
import { createCache } from "../common/cache.js";
import { createLogger } from "../common/logger.js";

const logger = createLogger("Location");

export type LocationEnv = {
    location_api_url: string;
    location_api_token: string;
    location_device_id?: string;
} & NotionEnv;

export const LocationType = "Location" as const;

export const isLocationEnv = (env: unknown): env is LocationEnv => {
    if (typeof env !== "object" || env === null) {
        return false;
    }
    const e = env as Record<string, unknown>;
    return typeof e.location_api_url === "string" && typeof e.location_api_token === "string";
};

type GeoJSONFeature = {
    type: "Feature";
    geometry: {
        type: "Point";
        coordinates: [number, number]; // [longitude, latitude]
    };
    properties: {
        timestamp: string;
        device_id?: string;
        speed?: number;
        altitude?: number;
        horizontal_accuracy?: number;
        vertical_accuracy?: number;
        address?: string;
        poi?: string;
    };
};

type GeoJSONResponse = {
    type: "FeatureCollection";
    features: GeoJSONFeature[];
};

type CacheItem = {
    id: string;
    unixTimeMs: number;
};

const formatCoordinate = (lat: number, lon: number): string => {
    return `lat:${lat}, lon:${lon}`;
};

const formatSpeed = (speedMps: number | undefined): string => {
    if (speedMps === undefined || speedMps < 0) {
        return "";
    }
    const speedKmh = speedMps * 3.6;
    return ` (${speedKmh.toFixed(1)}km/h)`;
};

const createLocationId = (feature: GeoJSONFeature): string => {
    const timestamp = feature.properties.timestamp;
    const [lon, lat] = feature.geometry.coordinates;
    return `${timestamp}-${lat}-${lon}`;
};

const createGoogleMapsUrl = (lat: number, lon: number): string => {
    return `https://www.google.com/maps?q=${lat},${lon}`;
};

const updateCacheItems = ({
    oldItems,
    newItems,
    today = new Date(),
}: {
    oldItems: CacheItem[];
    newItems: CacheItem[];
    today?: Date;
}): CacheItem[] => {
    const combined = [...oldItems, ...newItems];
    // remove entries older than 1 day
    const oneDayAgo = new Date(today.getTime() - 24 * 60 * 60 * 1000);
    return combined.filter((item) => item.unixTimeMs >= oneDayAgo.getTime());
};

const convertFeatureToServiceItem = (feature: GeoJSONFeature): ServiceItem => {
    const [lon, lat] = feature.geometry.coordinates;
    const coords = formatCoordinate(lat, lon);
    const speed = formatSpeed(feature.properties.speed);
    const poi = feature.properties.poi;
    // POIがある場合は「POI名: 座標」、ない場合は「Location: 座標」
    const title = poi ? `${poi}: ${coords}${speed}` : `Location: ${coords}${speed}`;
    const url = createGoogleMapsUrl(lat, lon);
    const unixTimeMs = new Date(feature.properties.timestamp).getTime();

    return {
        type: LocationType,
        title,
        url,
        unixTimeMs,
    };
};

export const fetchLocation = async (
    env: LocationEnv,
    lastServiceItem: ServiceItem | null
): Promise<ServiceItem[]> => {
    const url = new URL(env.location_api_url);
    if (env.location_device_id) {
        url.searchParams.set("device_id", env.location_device_id);
    }
    url.searchParams.set("format", "geojson");

    // Use from/to parameters to filter by time range (ISO 8601 format)
    const now = new Date();
    const fromDate = lastServiceItem
        ? new Date(lastServiceItem.unixTimeMs)
        : new Date(now.getTime() - 24 * 60 * 60 * 1000); // Default: 24 hours ago
    url.searchParams.set("from", fromDate.toISOString());
    url.searchParams.set("to", now.toISOString());

    const response = await fetch(url.toString(), {
        headers: {
            Authorization: `Bearer ${env.location_api_token}`,
        },
    });

    if (!response.ok) {
        throw new Error(`Failed to fetch location: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as GeoJSONResponse;
    logger.info("Location features count", data.features.length);

    const cache = createCache<CacheItem>("location.json");
    const oldItems = await cache.read();
    const oldItemIds = new Set(oldItems.map((item) => item.id));

    // Filter out already cached items (API already filters by time via from parameter)
    const newFeatures = data.features.filter((feature) => {
        const id = createLocationId(feature);
        if (oldItemIds.has(id)) {
            return false;
        }
        // Double-check time filter in case API returns boundary items
        if (lastServiceItem) {
            const featureTime = new Date(feature.properties.timestamp).getTime();
            if (featureTime <= lastServiceItem.unixTimeMs) {
                return false;
            }
        }
        return true;
    });

    logger.info("New location features count", newFeatures.length);

    // Create cache entries for new items
    const newCacheItems: CacheItem[] = newFeatures.map((feature) => ({
        id: createLocationId(feature),
        unixTimeMs: new Date(feature.properties.timestamp).getTime(),
    }));

    // Update cache with cleanup of old entries
    const updatedCache = updateCacheItems({
        oldItems,
        newItems: newCacheItems,
    });
    await cache.write(updatedCache);

    // Convert to ServiceItems
    return newFeatures.map(convertFeatureToServiceItem);
};
