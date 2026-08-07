import { describe, expect, it } from "vitest";
import {
  boundingBox,
  formatDistanceLabel,
  haversineKm,
  parseGeoSearchParams,
  SEARCH_RADIUS_KM,
} from "../src/geo.js";
import { mapNominatimHit, stripAdminPrefix } from "../src/geocoding.js";

describe("geo helpers", () => {
  it("accepts only allowlisted radius values", () => {
    expect(SEARCH_RADIUS_KM).toContain(15);
    const url = new URL("https://api.lokalnie.app/providers?latitude=52.2&longitude=21.0&radiusKm=15");
    expect(parseGeoSearchParams(url).value).toEqual({
      latitude: 52.2,
      longitude: 21.0,
      radiusKm: 15,
    });
    const bad = new URL("https://api.lokalnie.app/providers?latitude=52.2&longitude=21.0&radiusKm=7");
    expect(parseGeoSearchParams(bad).error).toBe("invalid_radius");
  });

  it("rejects incomplete or out-of-range coordinates", () => {
    expect(
      parseGeoSearchParams(new URL("https://api.lokalnie.app/providers?latitude=52.2")).error
    ).toBe("incomplete_coordinates");
    expect(
      parseGeoSearchParams(
        new URL("https://api.lokalnie.app/providers?latitude=91&longitude=21&radiusKm=15")
      ).error
    ).toBe("invalid_coordinate");
    expect(parseGeoSearchParams(new URL("https://api.lokalnie.app/providers")).value).toBe(null);
  });

  it("computes haversine distance and inclusive boundary checks", () => {
    const d = haversineKm(52.2297, 21.0122, 52.2319, 21.0194);
    expect(d).toBeGreaterThan(0.4);
    expect(d).toBeLessThan(0.8);
    expect(haversineKm(52.2, 21.0, 52.2, 21.0)).toBeCloseTo(0, 5);
  });

  it("builds a bounding box around the search point", () => {
    const box = boundingBox(52.2297, 21.0122, 5);
    expect(box.minLat).toBeLessThan(52.2297);
    expect(box.maxLat).toBeGreaterThan(52.2297);
    expect(box.minLng).toBeLessThan(21.0122);
    expect(box.maxLng).toBeGreaterThan(21.0122);
  });

  it("formats Polish distance labels", () => {
    expect(formatDistanceLabel(1.2)).toBe("1,2 km");
    expect(formatDistanceLabel(null)).toBe(null);
  });
});

describe("place suggestions formatting", () => {
  it("strips powiat/województwo prefixes like marketplace autocomplete", () => {
    expect(stripAdminPrefix("powiat krośnieński")).toBe("Krośnieński");
    expect(stripAdminPrefix("województwo lubuskie")).toBe("Lubuskie");
    expect(stripAdminPrefix("Wielkopolskie")).toBe("Wielkopolskie");
  });

  it("maps Nominatim hits to name + county/state subtitle", () => {
    const mapped = mapNominatimHit({
      lat: "52.8",
      lon: "15.1",
      name: "Sarbia",
      type: "village",
      display_name: "Sarbia, gmina Krosno Odrzańskie, powiat krośnieński, województwo lubuskie, Polska",
      address: {
        village: "Sarbia",
        county: "powiat krośnieński",
        state: "województwo lubuskie",
        country_code: "pl",
      },
    });
    expect(mapped).toMatchObject({
      name: "Sarbia",
      county: "Krośnieński",
      state: "Lubuskie",
      subtitle: "Krośnieński, Lubuskie",
      label: "Sarbia, Krośnieński, Lubuskie",
      latitude: 52.8,
      longitude: 15.1,
    });
  });

  it("uses town/city when village is absent", () => {
    const mapped = mapNominatimHit({
      lat: "52.23",
      lon: "21.01",
      name: "Warszawa",
      type: "city",
      address: {
        city: "Warszawa",
        state: "województwo mazowieckie",
      },
    });
    expect(mapped.name).toBe("Warszawa");
    expect(mapped.subtitle).toBe("Mazowieckie");
  });
});
