export const healthOk = {
  status: "ok",
  sha: "abc1234def56789",
  schema_version: "0004",
  db: "local",
  writer: "leader",
} as const;

export const meOk = {
  email: "ana@winecore.test",
  display_name: "Ana Rivas",
  roles: [
    { role: "owner", legal_entity_code: "PO" },
    { role: "admin", legal_entity_code: "PO" },
    { role: "approver", legal_entity_code: "CVPO" },
    { role: "advisor", legal_entity_code: null },
  ],
  entities: [
    { id: "po", code: "PO", legal_name: "Entidad de prueba P.O" },
    { id: "cvpo", code: "CVPO", legal_name: "Entidad de prueba CVPO" },
  ],
  permissions: ["contacts.read"],
} as const;

export const meForbidden = {
  code: "WC_NO_ACCESS",
  message: "No tienes acceso a WineCore",
} as const;

export const healthError = {
  code: "WC_UNAVAILABLE",
  message: "No se ha podido consultar el estado del sistema.",
} as const;
