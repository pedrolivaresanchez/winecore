// Ejemplo sintético de mayores (§6). No se siembra en producción.
import { ledgerFromSituation } from "../../src/core/regulatory/silicie/ledgers";
import type { SilicieLedger } from "../../src/core/regulatory/silicie/types";

const WAREHOUSE = "00000000-0000-4000-8000-0000000000a1";
const AT = "2027-01-01T00:00:00.000Z";

/** Propuesta de silicie.md §6 con NC de encabezado, pendiente de los 8 dígitos del asesor. */
export function exampleSilicieLedgers(): SilicieLedger[] {
  return [
    ledgerFromSituation({
      id: "00000000-0000-4000-8000-0000000000b1",
      taxWarehouseId: WAREHOUSE,
      createdAt: AT,
      situation: { productClass: "raw_grape" },
    }),
    ledgerFromSituation({
      id: "00000000-0000-4000-8000-0000000000b2",
      taxWarehouseId: WAREHOUSE,
      createdAt: AT,
      ncCode: "220429",
      situation: { productClass: "bulk", color: "tinto" },
    }),
    ledgerFromSituation({
      id: "00000000-0000-4000-8000-0000000000b3",
      taxWarehouseId: WAREHOUSE,
      createdAt: AT,
      ncCode: "220429",
      situation: { productClass: "bulk", color: "blanco" },
    }),
    ledgerFromSituation({
      id: "00000000-0000-4000-8000-0000000000b4",
      taxWarehouseId: WAREHOUSE,
      createdAt: AT,
      ncCode: "220429",
      situation: { productClass: "bulk_wood", color: "tinto" },
    }),
    ledgerFromSituation({
      id: "00000000-0000-4000-8000-0000000000b5",
      taxWarehouseId: WAREHOUSE,
      createdAt: AT,
      ncCode: "220421",
      situation: {
        productClass: "packaged",
        color: "tinto",
        wineCode: "SINTE",
        brand: "SINTE",
        containerKind: "bottle",
        containerCapacityMl: 750,
      },
    }),
  ];
}
