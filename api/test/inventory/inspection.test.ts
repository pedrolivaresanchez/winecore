import { describe, expect, it } from "bun:test";
import { inspectionReport } from "../../src/core/inventory/inspection";
import { BOD, CVPO, LOT1, LOT2, PO, PROD, V1, V2, VLC, id, stockMove } from "./fixtures";

const AT = "2027-06-15T18:00:00+02:00";

function sample() {
  return [
    stockMove({
      occurred_at: "2027-06-01T10:00:00Z",
      move_type: "opening",
      location_id: BOD,
      vessel_id: V1,
      lot_id: LOT1,
      owner_entity_id: PO,
      product_state: "wine",
      volume_ml: 4_800_000,
    }),
    stockMove({
      occurred_at: "2027-06-01T10:00:00Z",
      move_type: "opening",
      location_id: BOD,
      vessel_id: V2,
      lot_id: LOT2,
      owner_entity_id: PO,
      product_state: "wine",
      volume_ml: 225_000,
      source_id: id(0xa1),
    }),
    stockMove({
      occurred_at: "2027-06-02T10:00:00Z",
      move_type: "opening",
      location_id: VLC,
      vessel_id: null,
      lot_id: LOT1,
      product_id: PROD,
      owner_entity_id: CVPO,
      product_state: "packaged_labeled",
      qty_units: 3_600,
      volume_ml: 2_700_000,
      source_id: id(0xa2),
    }),
    stockMove({
      occurred_at: "2027-07-01T10:00:00Z",
      move_type: "cellar_in",
      location_id: BOD,
      vessel_id: V1,
      lot_id: LOT1,
      volume_ml: 1_000,
      source_id: id(0xa3),
    }),
  ];
}

describe("inspectionReport", () => {
  it("agrupa por ubicación y lote, con litros de presentación y totales", () => {
    const report = inspectionReport(sample(), AT);
    expect(report.business_date).toBe("2027-06-15");
    expect(report.rows.map((row) => [row.location_id, row.lot_id, row.vessel_id])).toEqual([
      [BOD, LOT1, V1],
      [BOD, LOT2, V2],
      [VLC, LOT1, null],
    ]);
    expect(report.rows[0]?.litres).toBe("4800.000");
    expect(report.rows[1]?.litres).toBe("225.000");
    expect(report.rows[2]?.qty_units).toBe(3_600);
    expect(report.by_location).toHaveLength(2);
    const bodega = report.by_location[0];
    expect(bodega?.location_id).toBe(BOD);
    expect(bodega?.volume_ml).toBe(5_025_000);
    expect(bodega?.litres).toBe("5025.000");
    expect(bodega?.lots.map((lot) => lot.lot_id)).toEqual([LOT1, LOT2]);
    expect(bodega?.lots[0]?.lines).toHaveLength(1);
    expect(report.totals.bulk_volume_ml).toBe(5_025_000);
    expect(report.totals.bulk_litres).toBe("5025.000");
    expect(report.totals.packaged_units).toBe(3_600);
    expect(report.totals.packaged_volume_ml).toBe(2_700_000);
    expect(report.totals.packaged_by_product).toEqual([{ product_id: PROD, qty_units: 3_600, volume_ml: 2_700_000 }]);
    expect(report.totals.volume_ml).toBe(5_025_000 + 2_700_000);
  });

  it("filtra por ubicación, propietario, lote, producto y estado, y respeta el instante", () => {
    const moves = sample();
    expect(inspectionReport(moves, AT, { location_id: BOD }).rows).toHaveLength(2);
    expect(inspectionReport(moves, AT, { owner_entity_id: CVPO }).rows[0]?.qty_units).toBe(3_600);
    expect(inspectionReport(moves, AT, { lot_id: LOT2 }).rows[0]?.volume_ml).toBe(225_000);
    expect(inspectionReport(moves, AT, { product_id: PROD }).totals.packaged_units).toBe(3_600);
    expect(inspectionReport(moves, AT, { product_state: "wine" }).totals.packaged_units).toBe(0);
    const later = inspectionReport(moves, "2027-07-01T12:00:00Z");
    expect(later.rows.find((row) => row.vessel_id === V1)?.volume_ml).toBe(4_801_000);
    expect(inspectionReport(moves, "2027-05-01T00:00:00Z").rows).toHaveLength(0);
    expect(inspectionReport([], AT).totals.bulk_litres).toBe("0.000");
  });

  it("presenta el mililitro suelto con tres decimales", () => {
    const report = inspectionReport(
      [stockMove({ occurred_at: "2027-06-01T00:00:00Z", volume_ml: 1 })],
      "2027-06-01",
    );
    expect(report.rows[0]?.litres).toBe("0.001");
    expect(report.business_date).toBe("2027-06-01");
  });
});
