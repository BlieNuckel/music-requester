import { describe, it, expect } from "vitest";
import {
  COUNTRY_CODES,
  countryCodeError,
  countryName,
  listCountries,
  parseCountryCodes,
  searchCountries,
} from "@shared/countries";

describe("COUNTRY_CODES", () => {
  it("holds the 249 officially assigned alpha-2 codes", () => {
    expect(COUNTRY_CODES).toHaveLength(249);
    expect(new Set(COUNTRY_CODES).size).toBe(249);
  });

  it("excludes the codes ICU knows but the events API does not", () => {
    for (const code of ["UK", "EU", "ZZ", "XA", "AN", "SU"]) {
      expect(COUNTRY_CODES).not.toContain(code);
    }
  });
});

describe("countryName", () => {
  it("names a code", () => {
    expect(countryName("SE")).toBe("Sweden");
  });

  it("falls back to the code it cannot name", () => {
    expect(countryName("QQ")).toBe("QQ");
  });
});

describe("parseCountryCodes", () => {
  it("splits on commas, semicolons and whitespace alike", () => {
    expect(parseCountryCodes("SE, DK; DE NO").codes).toEqual([
      "SE",
      "DK",
      "DE",
      "NO",
    ]);
  });

  it("uppercases and drops repeats", () => {
    expect(parseCountryCodes("se SE dk").codes).toEqual(["SE", "DK"]);
  });

  it("resolves an alias and reports it as accepted, not rejected", () => {
    const parsed = parseCountryCodes("UK");

    expect(parsed.codes).toEqual(["GB"]);
    expect(parsed.unknown).toEqual([]);
    expect(parsed.aliased).toEqual([{ from: "UK", to: "GB" }]);
  });

  it("keeps the valid codes out of a list that also has junk", () => {
    const parsed = parseCountryCodes("SE, SWE, XX");

    expect(parsed.codes).toEqual(["SE"]);
    expect(parsed.unknown).toEqual(["SWE", "XX"]);
  });
});

describe("countryCodeError", () => {
  it("accepts an assigned code", () => {
    expect(countryCodeError("GB")).toBeNull();
  });

  it("points UK at GB rather than just refusing it", () => {
    expect(countryCodeError("UK")).toContain("GB rather than UK");
  });

  it("rejects a code that is only shaped right", () => {
    expect(countryCodeError("QQ")).toContain("alpha-2");
  });

  it("rejects lowercase, which the events API does not match", () => {
    expect(countryCodeError("se")).toContain("must be uppercase");
  });
});

describe("searchCountries", () => {
  it("matches on name", () => {
    expect(searchCountries("swed")[0]).toEqual({ code: "SE", name: "Sweden" });
  });

  it("matches on code once there is more than one letter", () => {
    expect(searchCountries("DK")[0].code).toBe("DK");
  });

  it("does not let a one-letter code prefix outrank a name", () => {
    expect(searchCountries("d")[0].name).toBe("Denmark");
  });

  it("hides countries already chosen", () => {
    const codes = searchCountries("den", ["DK"]).map((c) => c.code);
    expect(codes).not.toContain("DK");
  });

  it("lists everything still available for an empty query", () => {
    expect(searchCountries("", ["SE"])).toHaveLength(248);
  });

  it("returns nothing for a query that matches no country", () => {
    expect(searchCountries("zzzzz")).toEqual([]);
  });
});

describe("listCountries", () => {
  it("sorts by name", () => {
    const names = listCountries().map((c) => c.name);
    expect(names[0]).toBe("Afghanistan");
    expect([...names].sort((a, b) => a.localeCompare(b))).toEqual(names);
  });
});
