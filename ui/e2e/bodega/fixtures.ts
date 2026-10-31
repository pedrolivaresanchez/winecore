import { meOk } from "../fixtures";

export const meCellar = {
  ...meOk,
  permissions: ["contacts.read", "contacts.write", "cellar.read", "cellar.operate", "cellar.manage"],
};

const locationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";

export const lotTinto = {
  id: "22222222-2222-4222-8222-222222222201",
  code: "L25-T01",
  kind: "wine" as const,
  wine_name: "Tinto del Ensayo",
  vintage: 2025,
  is_organic: true,
  status: "active" as const,
  origin: "reception",
  notes: null,
  volume_ml: 4_800_000,
  vessels: [{ vessel_code: "D-01", volume_ml: 4_800_000 }],
};

export const traceTinto = {
  nodes: [
    { code: "P-07", kind: "grape", wine_name: null, volume_ml: 0, mass_g: 3_100_000 },
    { code: "MOSTO-25-03", kind: "must", wine_name: "Tinto del Ensayo", volume_ml: 2_200_000, mass_g: 0 },
    { code: "L25-T01", kind: "wine", wine_name: "Tinto del Ensayo", volume_ml: 4_800_000, mass_g: 0 },
    { code: "L25-T01-B", kind: "bottled", wine_name: "Tinto del Ensayo", volume_ml: 504_000, mass_g: 0 },
  ],
  edges: [
    { parent_code: "P-07", child_code: "MOSTO-25-03", volume_ml: 0, mass_g: 3_100_000 },
    { parent_code: "MOSTO-25-03", child_code: "L25-T01", volume_ml: 2_200_000, mass_g: 0 },
    { parent_code: "L25-T01", child_code: "L25-T01-B", volume_ml: 504_000, mass_g: 0 },
  ],
  mermaid: "graph LR",
};

type Content = {
  lot_id: string;
  lot_code: string;
  wine_name: string;
  vintage: number | null;
  volume_ml: number;
  content_state: "fermenting" | "aging" | "holding";
};

function vessel(partial: {
  id: string;
  code: string;
  name: string;
  kind: string;
  capacity_ml: number;
  material: string;
  zone: string;
  has_cooling_jacket?: boolean;
  status?: string;
  content?: Content | null;
  hygiene?: "clean" | "dirty" | null;
  alert?: string | null;
  sisv_code?: string | null;
}) {
  return {
    has_cooling_jacket: false,
    status: "in_service",
    content: null,
    hygiene: partial.content ? null : "clean",
    alert: null,
    sisv_code: null,
    location_id: locationId,
    qr_token: `qr-${partial.code}-token-0001`.replace(/[^A-Za-z0-9_-]/g, "").padEnd(16, "0"),
    notes: null,
    ...partial,
  };
}

export const vessels = [
  vessel({
    id: "11111111-1111-4111-8111-111111111101",
    code: "D-01",
    name: "Inox 10.000 L",
    kind: "tank_storage",
    capacity_ml: 10_000_000,
    material: "stainless_steel",
    zone: "Nave 1",
    sisv_code: "D1",
    content: {
      lot_id: lotTinto.id,
      lot_code: "L25-T01",
      wine_name: "Tinto del Ensayo",
      vintage: 2025,
      volume_ml: 4_800_000,
      content_state: "holding",
    },
  }),
  vessel({
    id: "11111111-1111-4111-8111-111111111102",
    code: "D-02",
    name: "Fermentador 5.000 L",
    kind: "tank_fermenter",
    capacity_ml: 5_000_000,
    material: "stainless_steel",
    zone: "Nave 1",
    has_cooling_jacket: true,
    sisv_code: "D2",
    alert: "Densidad sin bajar en 48 h",
    content: {
      lot_id: "22222222-2222-4222-8222-222222222202",
      lot_code: "L25-R02",
      wine_name: "Rosado de Muestra",
      vintage: 2025,
      volume_ml: 3_200_000,
      content_state: "fermenting",
    },
  }),
  vessel({
    id: "11111111-1111-4111-8111-111111111104",
    code: "D-04",
    name: "Inox 8.000 L",
    kind: "tank_storage",
    capacity_ml: 8_000_000,
    material: "stainless_steel",
    zone: "Nave 1",
    sisv_code: "D4",
  }),
  vessel({
    id: "11111111-1111-4111-8111-111111111112",
    code: "B-12",
    name: "Barrica roble 225 L",
    kind: "barrel",
    capacity_ml: 225_000,
    material: "oak",
    zone: "Crianza",
    sisv_code: "B12",
    content: {
      lot_id: "22222222-2222-4222-8222-222222222212",
      lot_code: "L24-C02",
      wine_name: "Crianza del Ensayo",
      vintage: 2024,
      volume_ml: 225_000,
      content_state: "aging",
    },
  }),
  vessel({
    id: "11111111-1111-4111-8111-111111111113",
    code: "B-13",
    name: "Barrica roble 225 L",
    kind: "barrel",
    capacity_ml: 225_000,
    material: "oak",
    zone: "Crianza",
  }),
  vessel({
    id: "11111111-1111-4111-8111-111111111103",
    code: "G-03",
    name: "Damajuana 54 L",
    kind: "demijohn",
    capacity_ml: 54_000,
    material: "glass",
    zone: "Botellero",
  }),
  vessel({
    id: "11111111-1111-4111-8111-111111111109",
    code: "D-09",
    name: "Inox en reparación",
    kind: "tank_storage",
    capacity_ml: 2_000_000,
    material: "stainless_steel",
    zone: "Nave 2",
    status: "out_of_service",
  }),
];

export function vesselDetail(code: string) {
  const found = vessels.find((item) => item.code === code);
  if (!found) return null;
  const operations =
    code === "D-01"
      ? [
          {
            id: "op-hist-1",
            number: null,
            op_type: "destruction",
            occurred_at: "2026-10-30T09:15:00.000Z",
            status: "draft",
            reason: "Botellas rotas en el muelle",
            performed_by: "Ana Rivas",
            approval_request_id: "apr-bodega-1",
          },
          {
            id: "op-hist-2",
            number: "BO-2026-0142",
            op_type: "racking",
            occurred_at: "2026-10-28T16:10:00.000Z",
            status: "confirmed",
            reason: null,
            performed_by: "Ana Rivas",
            approval_request_id: null,
          },
        ]
      : [];
  const cleanings =
    code === "D-01"
      ? [
          {
            id: "cl-1",
            operation_id: "op-hist-2",
            vessel_id: found.id,
            active_substance: "Ácido peracético",
            quantity: 200,
            quantity_unit: "ml",
            efficacy_check: "Aclarado y tira de pH",
            created_at: "2026-10-20T08:00:00.000Z",
          },
        ]
      : [];
  return { ...found, operations, cleanings };
}

export function vesselQr(code: string) {
  const found = vessels.find((item) => item.code === code);
  if (!found) return null;
  return {
    code: found.code,
    qr_token: found.qr_token,
    url: `https://winecore.test/bodega/${found.code}`,
  };
}
