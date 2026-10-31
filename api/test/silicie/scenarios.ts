import type { EntriesContext, FiscalMoveInput } from "../../src/core/regulatory/silicie/types";
import { bottles, ctx, move, opening, PARTY_ID } from "./support";

export interface Scenario {
  moves: FiscalMoveInput[];
  context: EntriesContext;
}

/** §12 apertura: uva, granel, crianza y envasado. El mosto no tiene NC cerrado (§6). */
export function apertura(): Scenario {
  return {
    moves: [
      opening("m-granel", "bulk", "GRANEL-TINTO", 2_500_000, "AF-02-GRANEL"),
      opening("m-crianza", "bulk_wood", "CRIANZA-TINTO", 750_000, "AF-03-CRIANZA"),
      opening("m-env", "packaged", "B075-SINTE", 90_000, "AF-04-ENV", bottles(120)),
    ],
    context: ctx({
      hints: { "m-granel": { densityE6: 995_000 } },
      facts: [
        {
          kind: "opening",
          id: "f-uva",
          date: "2027-01-01",
          ledgerReference: "UVA",
          justificationRef: "AF-01-UVA",
          massG: 500_000,
        },
      ],
    }),
  };
}

/** §12 elaboración mensual agregada: A14 + A15 + A32. */
export function elaboracionMensual(): Scenario {
  return {
    moves: [
      move({
        id: "p-a",
        moveType: "production",
        productClass: "bulk",
        exciseProductKey: "GRANEL-TINTO",
        fiscalDate: "2027-09-02",
        volumeMl: 800_000,
        justificationRef: "PARTE-A",
        sourceId: "op-a",
      }),
      move({
        id: "p-b",
        moveType: "production",
        productClass: "bulk",
        exciseProductKey: "GRANEL-TINTO",
        fiscalDate: "2027-09-18",
        volumeMl: 400_000,
        justificationRef: "PARTE-B",
        sourceId: "op-b",
      }),
    ],
    context: ctx({
      aggregation: "monthly",
      hints: {
        "p-a": { operationNumber: "OB-A" },
        "p-b": { operationNumber: "OB-B" },
      },
      facts: [
        {
          kind: "crushing",
          id: "c-a",
          date: "2027-09-02",
          massG: 1_000_000,
          justificationRef: "PARTE-A",
          operationNumber: "OB-A",
          sourceId: "op-a",
        },
        {
          kind: "crushing",
          id: "c-b",
          date: "2027-09-18",
          massG: 500_000,
          justificationRef: "PARTE-B",
          operationNumber: "OB-B",
          sourceId: "op-b",
        },
        {
          kind: "elaboration_loss",
          id: "l-a",
          date: "2027-09-02",
          volumeMl: 20_000,
          ledgerReference: "GRANEL-TINTO",
          justificationRef: "PARTE-A",
          operationNumber: "OB-A",
          sourceId: "op-a",
          abvCenti: 1250,
        },
        {
          kind: "elaboration_loss",
          id: "l-b",
          date: "2027-09-18",
          volumeMl: 10_000,
          ledgerReference: "GRANEL-TINTO",
          justificationRef: "PARTE-B",
          operationNumber: "OB-B",
          sourceId: "op-b",
          abvCenti: 1250,
        },
      ],
    }),
  };
}

/** §12 trasiego depósito → barrica con merma. */
export function trasiegoBarrica(): Scenario {
  return {
    moves: [
      move({
        id: "out",
        moveType: "ledger_change_out",
        productClass: "bulk",
        exciseProductKey: "GRANEL-TINTO",
        fiscalDate: "2027-02-10",
        volumeMl: -200_000,
        justificationRef: "TR-2027-01",
        sourceId: "tr-1",
      }),
      move({
        id: "inn",
        moveType: "ledger_change_in",
        productClass: "bulk_wood",
        exciseProductKey: "CRIANZA-TINTO",
        fiscalDate: "2027-02-10",
        volumeMl: 200_000,
        justificationRef: "TR-2027-01",
        sourceId: "tr-1",
      }),
      move({
        id: "loss",
        moveType: "loss",
        productClass: "bulk",
        exciseProductKey: "GRANEL-TINTO",
        fiscalDate: "2027-02-10",
        volumeMl: -2_000,
        justificationRef: "TR-2027-01",
        sourceId: "tr-1",
      }),
    ],
    context: ctx({ aggregation: "monthly" }),
  };
}

/** §12 envasado de 600 botellas con merma. */
export function envasado600(): Scenario {
  const bottled = bottles(600);
  return {
    moves: [
      move({
        id: "bulk-out",
        moveType: "packaging_out_bulk",
        productClass: "bulk",
        exciseProductKey: "GRANEL-TINTO",
        fiscalDate: "2027-03-15",
        volumeMl: -(bottled.volumeMl + 5_000),
        justificationRef: "ENV-2027-01",
        sourceId: "env-1",
        abvCenti: 1300,
      }),
      move({
        id: "pack-in",
        moveType: "packaging_in_packaged",
        productClass: "packaged",
        exciseProductKey: "B075-SINTE",
        fiscalDate: "2027-03-15",
        volumeMl: bottled.volumeMl,
        units: bottled.units,
        justificationRef: "ENV-2027-01",
        sourceId: "env-1",
        abvCenti: 1300,
      }),
    ],
    context: ctx({
      aggregation: "monthly",
      hints: {
        "bulk-out": { operationNumber: "ENV-2027-01" },
        "pack-in": { operationNumber: "ENV-2027-01" },
      },
    }),
  };
}

/** §12 venta nacional con la regla factura (J11, régimen 4 de la tabla). */
export function ventaNacional(): Scenario {
  const sold = bottles(24, -1);
  return {
    moves: [
      move({
        id: "sale",
        moveType: "exit_domestic",
        productClass: "packaged",
        exciseProductKey: "B075-SINTE",
        fiscalDate: "2027-04-02",
        volumeMl: sold.volumeMl,
        units: sold.units,
        abvCenti: 1300,
        justificationType: "invoice",
        justificationRef: "FAC-2027-014",
        counterpartyContactId: PARTY_ID,
        fiscalTrigger: "invoice",
        sourceTable: "billing.invoice",
        sourceId: "fac-14",
      }),
    ],
    context: ctx(),
  };
}

/** §12 exportación con ARC. */
export function exportacion(): Scenario {
  return {
    moves: [
      move({
        id: "exp",
        moveType: "exit_export",
        productClass: "bulk",
        exciseProductKey: "GRANEL-TINTO",
        fiscalDate: "2027-05-06",
        volumeMl: -100_000,
        justificationType: "e_ad",
        justificationRef: "ARC-SINT-2027-001",
        counterpartyContactId: PARTY_ID,
        sourceId: "exp-1",
      }),
    ],
    context: ctx(),
  };
}

/** §12 venta al por menor mensual (A08 J13). */
export function ventaMenor(): Scenario {
  const first = bottles(10, -1);
  const second = bottles(6, -1);
  return {
    moves: [
      move({
        id: "shop-a",
        moveType: "exit_domestic",
        productClass: "packaged",
        exciseProductKey: "B075-SINTE",
        fiscalDate: "2027-08-03",
        volumeMl: first.volumeMl,
        units: first.units,
        abvCenti: 1300,
        justificationType: "invoice",
        justificationRef: "TICKET-03",
        fiscalTrigger: "invoice",
        sourceTable: "billing.invoice",
        sourceId: "shop-a",
      }),
      move({
        id: "shop-b",
        moveType: "exit_domestic",
        productClass: "packaged",
        exciseProductKey: "B075-SINTE",
        fiscalDate: "2027-08-19",
        volumeMl: second.volumeMl,
        units: second.units,
        abvCenti: 1300,
        justificationType: "invoice",
        justificationRef: "TICKET-19",
        fiscalTrigger: "invoice",
        sourceTable: "billing.invoice",
        sourceId: "shop-b",
      }),
    ],
    context: ctx({
      aggregation: "monthly",
      hints: { "shop-a": { retail: true }, "shop-b": { retail: true } },
      retailJustificationByMonth: { "2027-08": "VM-2027-08" },
    }),
  };
}

/** §12 destrucción. El hecho sintético trae autorización, así que el justificante es J07. */
export function destruccion(): Scenario {
  return {
    moves: [
      move({
        id: "dest",
        moveType: "destruction",
        productClass: "bulk",
        exciseProductKey: "GRANEL-TINTO",
        fiscalDate: "2027-06-20",
        volumeMl: -25_000,
        justificationRef: "AUT-SINT-01",
        reason: "Partida no apta",
        sourceId: "dest-1",
      }),
    ],
    context: ctx({ hints: { dest: { destructionDocument: "authorization" } } }),
  };
}

/** §12 realta: alta nueva con el número de asiento previo. IESX4 no tiene columnas en la spec. */
export function realta(): Scenario {
  const sold = bottles(12, -1);
  return {
    moves: [
      move({
        id: "realta",
        moveType: "exit_domestic",
        productClass: "packaged",
        exciseProductKey: "B075-SINTE",
        fiscalDate: "2027-04-20",
        volumeMl: sold.volumeMl,
        units: sold.units,
        abvCenti: 1300,
        justificationType: "invoice",
        justificationRef: "FAC-2027-099",
        counterpartyContactId: PARTY_ID,
        fiscalTrigger: "invoice",
        sourceTable: "billing.invoice",
        sourceId: "fac-99",
      }),
    ],
    context: ctx({
      hints: {
        realta: { previousAeatEntryNumber: "AS-PREVIO-SINT-001", annulsEntryId: "asiento-previo-1" },
      },
    }),
  };
}
