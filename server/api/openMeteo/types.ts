/** One hit from the Open-Meteo geocoding index, trimmed to what a picker needs. */
export type GeocodedPlace = {
  name: string;
  /** Region within the country ("Skåne County"), when the index has one. */
  region: string | null;
  country: string;
  countryCode: string;
  latitude: number;
  longitude: number;
  population: number | null;
};

export type OpenMeteoGeocodingResult = {
  name?: string;
  latitude?: number;
  longitude?: number;
  country?: string;
  country_code?: string;
  admin1?: string;
  population?: number;
};

export type OpenMeteoGeocodingResponse = {
  results?: OpenMeteoGeocodingResult[];
};
