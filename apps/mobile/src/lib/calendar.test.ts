import {
  birthYears, compareYmd, daysInMonth, firstWeekdayMondayFirst, formatLongDate, isFutureDate, isLeapYear,
  monthGrid, parseIsoDate, shiftMonth, toIsoDate, todayYmd,
} from "./calendar";

describe("calendar", () => {
  it("knows leap years, including the century rules", () => {
    expect([2000, 2024, 1996].every(isLeapYear)).toBe(true);
    expect([1900, 2100, 2023].some(isLeapYear)).toBe(false);
  });

  it("knows month lengths", () => {
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2023, 2)).toBe(28);
    expect(daysInMonth(2023, 4)).toBe(30);
    expect(daysInMonth(2023, 12)).toBe(31);
  });

  it("round-trips ISO dates and zero-pads", () => {
    expect(toIsoDate({ year: 1984, month: 3, day: 7 })).toBe("1984-03-07");
    expect(parseIsoDate("1984-03-07")).toEqual({ year: 1984, month: 3, day: 7 });
  });

  it.each(["", "1984-3-7", "1981-02-29", "1984-13-01", "1984-00-10", "1984-04-31", "abc", "07/03/1984"])(
    "rejects %p as not a real date", (value) => expect(parseIsoDate(value)).toBeNull()
  );

  it("accepts 29 February only in a leap year", () => {
    expect(parseIsoDate("1980-02-29")).not.toBeNull();
    expect(parseIsoDate("1981-02-29")).toBeNull();
  });

  it("finds the weekday of the 1st, Monday first", () => {
    expect(firstWeekdayMondayFirst(2026, 11)).toBe(6); // 1 Nov 2026 is a Sunday
    expect(firstWeekdayMondayFirst(2024, 1)).toBe(0); // 1 Jan 2024 is a Monday
  });

  it("builds a month grid padded to whole weeks, each day exactly once", () => {
    const weeks = monthGrid(2026, 11);
    expect(weeks.every((w) => w.length === 7)).toBe(true);
    expect(weeks[0]).toEqual([null, null, null, null, null, null, 1]);
    const days = weeks.flat().filter((d): d is number => d !== null);
    expect(days).toEqual(Array.from({ length: 30 }, (_, i) => i + 1));
  });

  it("has a 5- or 6-row grid, and February 2021 fits exactly 4 rows", () => {
    expect(monthGrid(2021, 2)).toHaveLength(4); // starts Monday, 28 days
    expect(monthGrid(2026, 3).length).toBeGreaterThanOrEqual(5);
  });

  it("steps months across year boundaries in both directions", () => {
    expect(shiftMonth(2026, 12, 1)).toEqual({ year: 2027, month: 1 });
    expect(shiftMonth(2026, 1, -1)).toEqual({ year: 2025, month: 12 });
    expect(shiftMonth(2026, 6, 0)).toEqual({ year: 2026, month: 6 });
    expect(shiftMonth(2026, 3, -15)).toEqual({ year: 2024, month: 12 });
  });

  it("compares dates and refuses the future", () => {
    expect(compareYmd({ year: 2000, month: 1, day: 2 }, { year: 2000, month: 1, day: 1 })).toBeGreaterThan(0);
    const now = new Date(2026, 10, 23);
    expect(todayYmd(now)).toEqual({ year: 2026, month: 11, day: 23 });
    expect(isFutureDate({ year: 2026, month: 11, day: 24 }, now)).toBe(true);
    expect(isFutureDate({ year: 2026, month: 11, day: 23 }, now)).toBe(false);
    expect(isFutureDate({ year: 1990, month: 1, day: 1 }, now)).toBe(false);
  });

  it("lists birth years newest first", () => {
    const years = birthYears(new Date(2026, 0, 1), 110);
    expect(years[0]).toBe(2026);
    expect(years.at(-1)).toBe(1916);
    expect(years).toHaveLength(111);
  });

  it("formats a long date for display and leaves bad input alone", () => {
    expect(formatLongDate("1984-03-07")).toBe("7 March 1984");
    expect(formatLongDate("nonsense")).toBe("nonsense");
  });
});
