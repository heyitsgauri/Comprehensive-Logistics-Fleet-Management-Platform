import json
import urllib.parse
import urllib.request

OSRM_URL = "https://router.project-osrm.org/route/v1/driving"
NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
HEADERS = {"User-Agent": "logistics-platform-dev"}


class RouteError(Exception):
    pass


def get_route(from_lat, from_lng, to_lat, to_lng):
    """Return a road route; this is calculated routing, not live tracking."""
    url = (
        f"{OSRM_URL}/{from_lng},{from_lat};{to_lng},{to_lat}"
        "?overview=full&geometries=geojson"
    )
    request = urllib.request.Request(url, headers=HEADERS)
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            data = json.load(response)
    except (OSError, TimeoutError, json.JSONDecodeError) as exc:
        raise RouteError(f"Routing service unavailable: {exc}") from exc
    if data.get("code") != "Ok" or not data.get("routes"):
        raise RouteError("No road route found between these points.")
    route = data["routes"][0]
    return {
        "distance_km": round(route["distance"] / 1000, 1),
        "duration_min": round(route["duration"] / 60),
        "geometry": route["geometry"]["coordinates"],
    }


def geocode(query):
    params = urllib.parse.urlencode(
        {"q": query, "format": "json", "limit": 5}
    )
    url = f"{NOMINATIM_URL}?{params}"
    request = urllib.request.Request(url, headers=HEADERS)
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            results = json.load(response)
    except (OSError, TimeoutError, json.JSONDecodeError) as exc:
        raise RouteError(f"Geocoding service unavailable: {exc}") from exc
    return [
        {
            "label": result["display_name"],
            "lat": float(result["lat"]),
            "lng": float(result["lon"]),
        }
        for result in results
    ]
