import { describe, expect, it } from "bun:test";
import { fiscalBalanceAt, stockAt } from "../../src/core/inventory/balances";
import { planCountAdjustments, planOpeningCount } from "../../src/core/inventory/count";
import { FISCAL_LEDGER_KEYS, STOCK_GROUP_KEYS, isFiscalMove, isStockMove } from "../../src/core/inventory/types";
import {
  BOD,
  COUNT_ID,
  CVPO,
  LOT1,
  LOT2,
  PO,
  PROD,
  V1,
  V2,
  V3,
  VLC,
  WH,
  catchDomain,
  countLine,
  fiscalCtx,
  fiscalDrafts,
  fiscalMove,
  id,
  openingCtx,
  physicalCtx,
  stockDrafts,
  stockMove,
} from "./fixtures";

const FULL = STOCK_GROUP_KEYS;

describe("planCountAdjustments", () => {
  it("un granel contado de menos genera count_adjust_out y exige aprobación", () => {
    const book = [stockMove({ occurred_at: "2027-06-01T08:00:00Z", move_type: "opening", volume_ml: 4_800_000 })];
    const counted = [
      countLine({
        id: id(0x81),
        counted_qty_units: 0,
        counted_volume_ml: 4_790_000,
        difference_reason: "Merma de medición",
      }),
    ];
    const ctx = physicalCtx();
    const drafts = planCountAdjustments(book, counted, ctx);
    expect(drafts).toHaveLength(1);
    const draft = drafts[0];
    expect(draft?.approval_required).toBe(true);
    expect(draft?.approval_kind).toBe("inventory_adjustment");
    expect(draft?.reason).toBe("Merma de medición");
    if (!draft || !isStockMove(draft.move)) throw new Error("físico");
    expect(draft.move.move_type).toBe("count_adjust_out");
    expect(draft.move.volume_ml).toBe(-10_000);
    expect(draft.move.qty_units).toBe(0);
    expect(draft.move.mass_g).toBe(0);
    expect(draft.move.occurred_at).toBe(ctx.counted_at);
    expect(draft.move.source_table).toBe("inventory.inventory_count");
    expect(draft.move.source_id).toBe(COUNT_ID);
    expect(draft.move.source_line_id).toBe(id(0x81));
    expect(draft.move.loss_kind).toBeNull();
    expect(draft.move.reverses_move_id).toBeNull();
    const after = stockAt([...book, ...stockDrafts(drafts)], ctx.counted_at, FULL);
    expect(after[0]?.volume_ml).toBe(4_790_000);
  });

  it("si el libro ya coincide no hay ajuste ni hace falta motivo", () => {
    const book = [stockMove({ occurred_at: "2027-06-01T08:00:00Z", move_type: "opening", volume_ml: 4_800_000 })];
    const drafts = planCountAdjustments(
      book,
      [countLine({ counted_qty_units: 0, counted_volume_ml: 4_800_000, difference_reason: null })],
      physicalCtx(),
    );
    expect(drafts).toEqual([]);
  });

  it("una diferencia sin motivo se rechaza y una línea a medio contar no se toca", () => {
    const book = [stockMove({ occurred_at: "2027-06-01T08:00:00Z", move_type: "opening", volume_ml: 1_000 })];
    const missing = catchDomain(() =>
      planCountAdjustments(
        book,
        [countLine({ counted_qty_units: 0, counted_volume_ml: 900, difference_reason: "  " })],
        physicalCtx(),
      ),
    );
    expect(missing.code).toBe("WC_VALIDATION");
    expect(missing.message).toContain("motivo");

    const partial = planCountAdjustments(
      book,
      [countLine({ counted_qty_units: null, counted_volume_ml: 1, difference_reason: null })],
      physicalCtx(),
    );
    expect(partial).toEqual([]);
  });

  it("el signo se parte cuando volumen y masa no van en la misma dirección", () => {
    const book = [stockMove({ occurred_at: "2027-06-01T08:00:00Z", move_type: "opening", volume_ml: 1_000, mass_g: 0 })];
    const drafts = planCountAdjustments(
      book,
      [
        countLine({
          counted_qty_units: 0,
          counted_volume_ml: 900,
          counted_mass_g: 50,
          difference_reason: "Calibración",
        }),
      ],
      physicalCtx(),
    );
    expect(drafts.map((draft) => (isStockMove(draft.move) ? draft.move.move_type : ""))).toEqual([
      "count_adjust_in",
      "count_adjust_out",
    ]);
    const applied = stockAt([...book, ...stockDrafts(drafts)], physicalCtx().counted_at, FULL);
    expect(applied[0]?.volume_ml).toBe(900);
    expect(applied[0]?.mass_g).toBe(50);
  });

  it("un envasado coherente con el nominal ajusta unidades y volumen; si no cuadra, WC023", () => {
    const book = [
      stockMove({
        occurred_at: "2027-06-01T08:00:00Z",
        move_type: "opening",
        vessel_id: null,
        product_id: PROD,
        product_state: "packaged_labeled",
        qty_units: 10,
        volume_ml: 7_500,
      }),
    ];
    const ok = planCountAdjustments(
      book,
      [
        countLine({
          vessel_id: null,
          product_id: PROD,
          product_state: "packaged_labeled",
          counted_qty_units: 8,
          counted_volume_ml: 6_000,
          nominal_volume_ml: 750,
          difference_reason: "Rotura",
          method: "unit_count",
        }),
      ],
      physicalCtx(),
    );
    expect(ok).toHaveLength(1);
    if (!ok[0] || !isStockMove(ok[0].move)) throw new Error("físico");
    expect(ok[0].move.move_type).toBe("count_adjust_out");
    expect(ok[0].move.qty_units).toBe(-2);
    expect(ok[0].move.volume_ml).toBe(-1_500);
    const after = stockAt([...book, ...stockDrafts(ok)], physicalCtx().counted_at, FULL);
    expect(after[0]?.qty_units).toBe(8);
    expect(after[0]?.volume_ml).toBe(6_000);

    const bad = catchDomain(() =>
      planCountAdjustments(
        book,
        [
          countLine({
            vessel_id: null,
            product_id: PROD,
            product_state: "packaged_labeled",
            counted_qty_units: 8,
            counted_volume_ml: 6_100,
            nominal_volume_ml: 750,
            difference_reason: "Rotura",
          }),
        ],
        physicalCtx(),
      ),
    );
    expect(bad.code).toBe("WC023");
    expect(bad.httpStatus).toBe(422);
  });

  it("no pone a cero una clave que el recuento no incluye y sí da de alta lo contado de más", () => {
    const book = [
      stockMove({ occurred_at: "2027-06-01T08:00:00Z", move_type: "opening", volume_ml: 1_000, vessel_id: V1 }),
      stockMove({
        occurred_at: "2027-06-01T08:00:00Z",
        move_type: "opening",
        volume_ml: 400,
        vessel_id: V2,
        source_id: id(0x82),
      }),
    ];
    const drafts = planCountAdjustments(
      book,
      [countLine({ vessel_id: V1, counted_qty_units: 0, counted_volume_ml: 1_200, difference_reason: "Hallazgo" })],
      physicalCtx(),
    );
    const after = stockAt([...book, ...stockDrafts(drafts)], physicalCtx().counted_at, FULL);
    expect(after.find((row) => row.vessel_id === V1)?.volume_ml).toBe(1_200);
    expect(after.find((row) => row.vessel_id === V2)?.volume_ml).toBe(400);
    expect(drafts[0] && isStockMove(drafts[0].move) && drafts[0].move.move_type).toBe("count_adjust_in");
  });

  it("la regularización fiscal es el neto del mayor y deja el libro igual al contado", () => {
    const book = [
      fiscalMove({ fiscal_date: "2027-06-01", volume_ml: 10_000, excise_product_key: "GRANEL-TINTO" }),
      fiscalMove({ fiscal_date: "2027-06-01", volume_ml: 5_000, excise_product_key: "GRANEL-BLANCO" }),
    ];
    const counted = [
      countLine({
        id: id(0x83),
        vessel_id: V1,
        counted_qty_units: 0,
        counted_volume_ml: 4_000,
        tax_warehouse_id: WH,
        product_class: "bulk",
        excise_product_key: "GRANEL-TINTO",
        difference_reason: "Falta en depósito 1",
      }),
      countLine({
        id: id(0x84),
        vessel_id: V2,
        lot_id: LOT2,
        counted_qty_units: 0,
        counted_volume_ml: 5_000,
        tax_warehouse_id: WH,
        product_class: "bulk",
        excise_product_key: "GRANEL-TINTO",
        difference_reason: "Falta en depósito 2",
      }),
    ];
    const drafts = planCountAdjustments(book, counted, fiscalCtx());
    expect(drafts).toHaveLength(1);
    const draft = drafts[0];
    expect(draft?.approval_required).toBe(true);
    expect(draft?.reason).toBe("Falta en depósito 1; Falta en depósito 2");
    if (!draft || !isFiscalMove(draft.move)) throw new Error("fiscal");
    expect(draft.move.move_type).toBe("regularization_out");
    expect(draft.move.volume_ml).toBe(-1_000);
    expect(draft.move.units).toBe(0);
    expect(draft.move.reason).toBe(draft.reason);
    expect(draft.move.justification_type).toBe("count_record");
    expect(draft.move.justification_ref).toBe("AF-2027-01");
    expect(draft.move.fiscal_trigger).toBe("count");
    expect(draft.move.fiscal_date).toBe("2027-06-20");
    expect(draft.move.source_line_id).toBeNull();
    expect(draft.move.lot_id).toBeNull();
    const after = fiscalBalanceAt([...book, ...fiscalDrafts(drafts)], "2027-06-20", FISCAL_LEDGER_KEYS);
    expect(after.find((row) => row.excise_product_key === "GRANEL-TINTO")?.volume_ml).toBe(9_000);
    expect(after.find((row) => row.excise_product_key === "GRANEL-BLANCO")?.volume_ml).toBe(5_000);
  });

  it("lo que está fuera del perímetro no genera regularización fiscal", () => {
    const drafts = planCountAdjustments(
      [fiscalMove({ volume_ml: 1_000 })],
      [
        countLine({
          location_id: VLC,
          counted_qty_units: 0,
          counted_volume_ml: 100,
          difference_reason: "Operador",
        }),
      ],
      fiscalCtx(),
    );
    expect(drafts).toEqual([]);
  });

  it("un envasado fiscal mueve unidades y volumen del mismo signo", () => {
    const book = [
      fiscalMove({
        product_class: "packaged",
        product_id: PROD,
        excise_product_key: "B075-TINTO",
        volume_ml: 7_500,
        units: 10,
        lot_id: LOT1,
      }),
    ];
    const drafts = planCountAdjustments(
      book,
      [
        countLine({
          vessel_id: null,
          product_id: PROD,
          lot_id: LOT1,
          product_state: "packaged_labeled",
          counted_qty_units: 12,
          counted_volume_ml: 9_000,
          tax_warehouse_id: WH,
          product_class: "packaged",
          excise_product_key: "B075-TINTO",
          difference_reason: "Recontado",
        }),
      ],
      fiscalCtx(),
    );
    expect(drafts).toHaveLength(1);
    if (!drafts[0] || !isFiscalMove(drafts[0].move)) throw new Error("fiscal");
    expect(drafts[0].move.move_type).toBe("regularization_in");
    expect(drafts[0].move.volume_ml).toBe(1_500);
    expect(drafts[0].move.units).toBe(2);
    expect(drafts[0].move.product_id).toBe(PROD);
    const blocked = catchDomain(() =>
      planCountAdjustments(
        book,
        [
          countLine({
            vessel_id: null,
            product_id: PROD,
            product_state: "packaged_labeled",
            counted_qty_units: 8,
            counted_volume_ml: 7_500,
            tax_warehouse_id: WH,
            product_class: "packaged",
            excise_product_key: "B075-TINTO",
            difference_reason: "Recontado",
          }),
        ],
        fiscalCtx(),
      ),
    );
    expect(blocked.code).toBe("WC_VALIDATION");
    expect(blocked.message).toContain("volumen");
  });
});

describe("planOpeningCount", () => {
  it("abre el físico por propietario y el fiscal solo en el perímetro, agregado por mayor", () => {
    const lines = [
      countLine({
        id: id(0x85),
        owner_entity_id: PO,
        vessel_id: V1,
        lot_id: LOT1,
        counted_qty_units: 0,
        counted_volume_ml: 3_000_000,
        tax_warehouse_id: WH,
        product_class: "bulk",
        excise_product_key: "GRANEL-TINTO",
        abv_pct: "13.5",
        nc_code: "22042100",
      }),
      countLine({
        id: id(0x86),
        owner_entity_id: CVPO,
        vessel_id: V2,
        lot_id: LOT2,
        counted_qty_units: 0,
        counted_volume_ml: 2_000_000,
        tax_warehouse_id: WH,
        product_class: "bulk",
        excise_product_key: "GRANEL-TINTO",
        abv_pct: "13.5",
        nc_code: "22042100",
      }),
      countLine({
        id: id(0x87),
        location_id: VLC,
        owner_entity_id: CVPO,
        vessel_id: V3,
        lot_id: LOT1,
        counted_qty_units: 0,
        counted_volume_ml: 500_000,
      }),
    ];
    const plan = planOpeningCount(lines, openingCtx());
    expect(plan.approval_required).toBe(true);
    expect(plan.approval_kind).toBe("inventory_adjustment");
    expect(plan.physical).toHaveLength(3);
    expect(plan.physical.every((move) => move.move_type === "opening" && move.volume_ml > 0)).toBe(true);
    expect(plan.physical.map((move) => move.owner_entity_id).sort()).toEqual([CVPO, CVPO, PO].sort());
    const po = plan.physical.find((move) => move.owner_entity_id === PO && move.location_id === BOD);
    const external = plan.physical.find((move) => move.location_id === VLC);
    expect(po?.volume_ml).toBe(3_000_000);
    expect(po?.source_line_id).toBe(id(0x85));
    expect(po?.occurred_at).toBe("2027-01-01T00:00:00+01:00");
    expect(external?.volume_ml).toBe(500_000);
    expect(external?.owner_entity_id).toBe(CVPO);

    expect(plan.fiscal).toHaveLength(1);
    const fiscal = plan.fiscal[0];
    expect(fiscal?.move_type).toBe("opening");
    expect(fiscal?.volume_ml).toBe(5_000_000);
    expect(fiscal?.units).toBe(0);
    expect(fiscal?.tax_warehouse_id).toBe(WH);
    expect(fiscal?.product_class).toBe("bulk");
    expect(fiscal?.excise_product_key).toBe("GRANEL-TINTO");
    expect(fiscal?.lot_id).toBeNull();
    expect(fiscal?.fiscal_date).toBe("2027-01-01");
    expect(fiscal?.physical_date).toBe("2026-12-31");
    expect(fiscal?.justification_type).toBe("count_record");
    expect(fiscal?.justification_ref).toBe("AF-2026-12");
    expect(fiscal?.fiscal_trigger).toBe("count");
    expect(fiscal?.reason).toBeNull();
    expect(fiscal?.abv_pct).toBe("13.5");
    expect(fiscal?.nc_code).toBe("22042100");
    expect(fiscal?.source_line_id).toBeNull();

    const physicalBalance = stockAt(plan.physical, "2027-01-01T00:00:00+01:00", FULL);
    expect(physicalBalance.reduce((sum, row) => sum + row.volume_ml, 0)).toBe(5_500_000);
    const fiscalBalance = fiscalBalanceAt(plan.fiscal, "2027-01-01", FISCAL_LEDGER_KEYS);
    expect(fiscalBalance[0]?.volume_ml).toBe(5_000_000);
  });

  it("un solo lote del perímetro se conserva y una línea a cero no abre movimiento", () => {
    const plan = planOpeningCount(
      [
        countLine({
          counted_qty_units: 0,
          counted_volume_ml: 225_000,
          tax_warehouse_id: WH,
          product_class: "bulk_wood",
          excise_product_key: "CRIANZA-TINTO",
          lot_id: LOT2,
          vessel_id: V2,
        }),
        countLine({
          id: id(0x88),
          vessel_id: V3,
          counted_qty_units: 0,
          counted_volume_ml: 0,
        }),
      ],
      openingCtx(),
    );
    expect(plan.physical).toHaveLength(1);
    expect(plan.physical[0]?.volume_ml).toBe(225_000);
    expect(plan.fiscal).toHaveLength(1);
    expect(plan.fiscal[0]?.lot_id).toBe(LOT2);
    expect(plan.fiscal[0]?.product_class).toBe("bulk_wood");
    expect(plan.fiscal[0]?.volume_ml).toBe(225_000);
  });

  it("el perímetro sin clase fiscal no se contabiliza a ciegas", () => {
    const error = catchDomain(() =>
      planOpeningCount(
        [
          countLine({
            counted_qty_units: 0,
            counted_volume_ml: 1_000,
            tax_warehouse_id: WH,
          }),
        ],
        openingCtx(),
      ),
    );
    expect(error.code).toBe("WC_VALIDATION");
    expect(error.message).toContain("clase de producto fiscal");
  });
});
