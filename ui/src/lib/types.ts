export type EntityCode = "PO" | "CVPO";

export type EntityChoice = "all" | EntityCode;

export type MeRole = {
  role: string;
  legal_entity_code: EntityCode | null;
};

export type MeEntity = {
  id: string;
  code: EntityCode;
  legal_name: string;
};

export type Me = {
  email: string;
  display_name: string;
  roles: MeRole[];
  entities: MeEntity[];
  permissions: string[];
};

export type Health = {
  status: string;
  sha: string;
  schema_version: string;
  db: "local" | "timbal" | string;
  writer: "leader" | "standby" | string;
};
