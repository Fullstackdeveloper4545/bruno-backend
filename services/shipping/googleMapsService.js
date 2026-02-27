const geocodeCache = new Map();

function getApiKey() {
  const raw = process.env.GOOGLE_MAPS_API_KEY;
  return typeof raw === 'string' && raw.trim() ? raw.trim() : '';
}

function hasApiKey() {
  return Boolean(getApiKey());
}

function toText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isValidCoordinate(latitude, longitude) {
  return (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180
  );
}

function normalizeLatLng(point) {
  if (!point || typeof point !== 'object') return null;
  const latitude = toNumber(point.lat ?? point.latitude);
  const longitude = toNumber(point.lng ?? point.longitude);
  if (!isValidCoordinate(latitude, longitude)) return null;
  return { lat: latitude, lng: longitude };
}

function buildExternalRouteUrl(originAddress, destinationAddress) {
  const origin = toText(originAddress);
  const destination = toText(destinationAddress);
  if (!origin || !destination) return null;

  const query = new URLSearchParams({
    api: '1',
    travelmode: 'driving',
    origin,
    destination,
  });
  return `https://www.google.com/maps/dir/?${query.toString()}`;
}

async function geocodeAddress(address) {
  const normalizedAddress = toText(address);
  if (!normalizedAddress || !hasApiKey()) return null;

  if (geocodeCache.has(normalizedAddress)) {
    return geocodeCache.get(normalizedAddress);
  }

  const query = new URLSearchParams({
    address: normalizedAddress,
    key: getApiKey(),
  });

  const response = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?${query.toString()}`);
  if (!response.ok) {
    geocodeCache.set(normalizedAddress, null);
    return null;
  }

  const data = await response.json();
  if (data?.status !== 'OK' || !Array.isArray(data?.results) || !data.results[0]) {
    geocodeCache.set(normalizedAddress, null);
    return null;
  }

  const first = data.results[0];
  const location = normalizeLatLng(first?.geometry?.location);
  if (!location) {
    geocodeCache.set(normalizedAddress, null);
    return null;
  }

  const result = {
    ...location,
    formatted_address: first?.formatted_address || normalizedAddress,
  };
  geocodeCache.set(normalizedAddress, result);
  return result;
}

async function getDirections(origin, destination) {
  if (!hasApiKey() || !origin || !destination) return null;

  const query = new URLSearchParams({
    origin: `${origin.lat},${origin.lng}`,
    destination: `${destination.lat},${destination.lng}`,
    mode: 'driving',
    key: getApiKey(),
  });

  const response = await fetch(`https://maps.googleapis.com/maps/api/directions/json?${query.toString()}`);
  if (!response.ok) return null;

  const data = await response.json();
  if (data?.status !== 'OK' || !Array.isArray(data?.routes) || !data.routes[0]) {
    return null;
  }

  const route = data.routes[0];
  const leg = Array.isArray(route.legs) && route.legs[0] ? route.legs[0] : null;
  return {
    polyline: route?.overview_polyline?.points || null,
    distance_text: leg?.distance?.text || null,
    duration_text: leg?.duration?.text || null,
  };
}

async function resolveCurrentPoint(events = [], order = {}) {
  if (!Array.isArray(events) || events.length === 0) return null;

  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    const coords = normalizeLatLng(event);
    if (coords) {
      return {
        ...coords,
        label: toText(event.location) || 'Current shipment location',
      };
    }
  }

  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    const location = toText(event?.location);
    if (!location) continue;
    const candidate = await geocodeAddress(location);
    if (candidate) {
      return {
        lat: candidate.lat,
        lng: candidate.lng,
        label: candidate.formatted_address || location,
      };
    }
  }

  const region = toText(order?.shipping_region);
  if (region) {
    const candidate = await geocodeAddress(region);
    if (candidate) {
      return {
        lat: candidate.lat,
        lng: candidate.lng,
        label: candidate.formatted_address || region,
      };
    }
  }

  return null;
}

async function buildShipmentMap({ order = {}, events = [] } = {}) {
  const originAddress = toText(order.store_address || order.store_name);
  const destinationAddress = toText(order.shipping_address);
  const externalUrl = buildExternalRouteUrl(originAddress, destinationAddress);

  const base = {
    enabled: hasApiKey(),
    external_url: externalUrl,
    origin: null,
    destination: null,
    current: null,
    polyline: null,
    distance_text: null,
    duration_text: null,
  };

  if (!hasApiKey()) {
    return base;
  }

  const [originPoint, destinationPoint] = await Promise.all([
    geocodeAddress(originAddress),
    geocodeAddress(destinationAddress),
  ]);

  const currentPoint = await resolveCurrentPoint(events, order);
  const directions =
    originPoint && destinationPoint ? await getDirections(originPoint, destinationPoint) : null;

  return {
    ...base,
    origin: originPoint
      ? {
          address: originAddress,
          lat: originPoint.lat,
          lng: originPoint.lng,
          formatted_address: originPoint.formatted_address || originAddress,
        }
      : null,
    destination: destinationPoint
      ? {
          address: destinationAddress,
          lat: destinationPoint.lat,
          lng: destinationPoint.lng,
          formatted_address: destinationPoint.formatted_address || destinationAddress,
        }
      : null,
    current: currentPoint || null,
    polyline: directions?.polyline || null,
    distance_text: directions?.distance_text || null,
    duration_text: directions?.duration_text || null,
  };
}

module.exports = {
  buildShipmentMap,
};
