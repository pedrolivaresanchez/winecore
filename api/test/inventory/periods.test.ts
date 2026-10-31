import { describe, expect, it } from "bun:test";
import { assertPeriodOpen, businessDate, madridDateTime, periodOf } from "../../src/core/inventory/periods";
import { catchDomain, lock } from "./fixtures";

describe("businessDate / madridDateTime / periodOf", () => {
  const samples: Array<{ instant: string; date: string; hour: number; minute: number; period: string }> = [
    { instant: "2027-01-31T22:30:00Z", date: "2027-01-31", hour: 23, minute: 30, period: "2027-01" },
    { instant: "2027-01-31T23:00:00Z", date: "2027-02-01", hour: 0, minute: 0, period: "2027-02" },
    { instant: "2027-02-28T23:00:00Z", date: "2027-03-01", hour: 0, minute: 0, period: "2027-03" },
    { instant: "2027-03-28T00:30:00Z", date: "2027-03-28", hour: 1, minute: 30, period: "2027-03" },
    { instant: "2027-03-28T01:00:00Z", date: "2027-03-28", hour: 3, minute: 0, period: "2027-03" },
    { instant: "2027-03-28T01:30:00Z", date: "2027-03-28", hour: 3, minute: 30, period: "2027-03" },
    { instant: "2027-03-31T21:30:00Z", date: "2027-03-31", hour: 23, minute: 30, period: "2027-03" },
    { instant: "2027-03-31T22:00:00Z", date: "2027-04-01", hour: 0, minute: 0, period: "2027-04" },
    { instant: "2027-03-31T22:30:00Z", date: "2027-04-01", hour: 0, minute: 30, period: "2027-04" },
    { instant: "2027-10-31T00:30:00Z", date: "2027-10-31", hour: 2, minute: 30, period: "2027-10" },
    { instant: "2027-10-31T01:00:00Z", date: "2027-10-31", hour: 2, minute: 0, period: "2027-10" },
    { instant: "2027-10-31T01:30:00Z", date: "2027-10-31", hour: 2, minute: 30, period: "2027-10" },
    { instant: "2027-10-31T22:30:00Z", date: "2027-10-31", hour: 23, minute: 30, period: "2027-10" },
    { instant: "2027-10-31T23:00:00Z", date: "2027-11-01", hour: 0, minute: 0, period: "2027-11" },
    { instant: "2027-10-31T23:30:00Z", date: "2027-11-01", hour: 0, minute: 30, period: "2027-11" },
  ];

  it("convierte los cambios de hora y los cambios de mes en Europe/Madrid", () => {
    for (const sample of samples) {
      const clock = madridDateTime(sample.instant);
      expect(clock.date).toBe(sample.date);
      expect(clock.hour).toBe(sample.hour);
      expect(clock.minute).toBe(sample.minute);
      expect(businessDate(sample.instant)).toBe(sample.date);
      const period = periodOf(sample.instant);
      expect(period.key).toBe(sample.period);
      expect(period.start <= sample.date && sample.date <= period.end).toBe(true);
    }
  });

  it("un día suelto ya es fecha de negocio y febrero respeta el bisiesto", () => {
    expect(periodOf("2027-03-28")).toEqual({
      year: 2027,
      month: 3,
      key: "2027-03",
      start: "2027-03-01",
      end: "2027-03-31",
    });
    expect(periodOf("2027-02-15").end).toBe("2027-02-28");
    expect(periodOf("2027-10-31").end).toBe("2027-10-31");
    expect(periodOf("2028-02-29").end).toBe("2028-02-29");
    expect(periodOf("2028-02-29").key).toBe("2028-02");
  });

  it("rechaza un instante sin zona", () => {
    const error = catchDomain(() => businessDate("2027-03-28T02:30:00"));
    expect(error.code).toBe("WC_VALIDATION");
  });
});

describe("assertPeriodOpen", () => {
  it("cierra el día locked_until inclusive y abre el día siguiente", () => {
    const locks = [lock("2027-01-31")];
    const closed = catchDomain(() => assertPeriodOpen("2027-01-31", locks));
    expect(closed.code).toBe("WC021");
    expect(closed.httpStatus).toBe(409);
    expect(closed.message).toBe("WC021: el periodo está cerrado hasta 2027-01-31 (movimiento con fecha 2027-01-31)");
    expect(() => assertPeriodOpen("2027-02-01", locks)).not.toThrow();
    expect(() => assertPeriodOpen("2027-03-01", [])).not.toThrow();
  });

  it("juzga el instante por el día de Madrid, también en los cambios de mes y de hora", () => {
    const january = [lock("2027-01-31", "physical")];
    expect(() => assertPeriodOpen("2027-01-31T22:30:00Z", january)).toThrow();
    expect(() => assertPeriodOpen("2027-01-31T23:00:00Z", january)).not.toThrow();

    const march = [lock("2027-03-31", "physical")];
    const stillMarch = catchDomain(() => assertPeriodOpen("2027-03-31T21:30:00Z", march));
    expect(stillMarch.message).toContain("2027-03-31");
    expect(() => assertPeriodOpen("2027-03-28T00:30:00Z", march)).toThrow();
    expect(() => assertPeriodOpen("2027-03-28T01:30:00Z", march)).toThrow();
    expect(() => assertPeriodOpen("2027-03-31T22:30:00Z", march)).not.toThrow();

    const october = [lock("2027-10-31", "fiscal")];
    expect(() => assertPeriodOpen("2027-10-31T00:30:00Z", october)).toThrow();
    expect(() => assertPeriodOpen("2027-10-31T01:30:00Z", october)).toThrow();
    expect(() => assertPeriodOpen("2027-10-31T22:30:00Z", october)).toThrow();
    expect(() => assertPeriodOpen("2027-10-31T23:30:00Z", october)).not.toThrow();
    expect(periodOf("2027-10-31T01:30:00Z").key).toBe("2027-10");
    expect(periodOf("2027-10-31T23:30:00Z").key).toBe("2027-11");
  });

  it("si llegan varios cierres, manda el que llega más lejos", () => {
    const error = catchDomain(() =>
      assertPeriodOpen("2027-01-20", [lock("2027-01-15", "fiscal"), lock("2027-01-31", "physical")]),
    );
    expect(error.code).toBe("WC021");
    expect(error.message).toContain("2027-01-31");
    expect(error.fields).toMatchObject({ date: "2027-01-20", locked_until: "2027-01-31" });
  });
});
