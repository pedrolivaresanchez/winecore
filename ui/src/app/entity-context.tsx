/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { entityStorageKey, readStorage, writeStorage } from "@/lib/storage";
import type { EntityChoice, EntityCode, Me } from "@/lib/types";

type EntityContextValue = {
  filter: EntityChoice;
  setFilter: (value: EntityChoice) => void;
  entityCode: EntityCode | null;
  entities: Me["entities"];
};

const EntityContext = createContext<EntityContextValue | undefined>(undefined);

function readChoice(email: string, entities: Me["entities"]): EntityChoice {
  const stored = readStorage(entityStorageKey(email));
  if ((stored === "PO" || stored === "CVPO") && entities.some((entity) => entity.code === stored)) {
    return stored;
  }
  return "all";
}

export function EntityProvider({ me, children }: { me: Me; children: ReactNode }) {
  const [stored, setStored] = useState<EntityChoice>(() => readChoice(me.email, me.entities));
  const filter: EntityChoice =
    stored === "all" || me.entities.some((entity) => entity.code === stored) ? stored : "all";

  const setFilter = useCallback(
    (value: EntityChoice) => {
      setStored(value);
      writeStorage(entityStorageKey(me.email), value);
    },
    [me.email],
  );

  const value = useMemo<EntityContextValue>(
    () => ({
      filter,
      setFilter,
      entityCode: filter === "all" ? null : filter,
      entities: me.entities,
    }),
    [filter, me.entities, setFilter],
  );

  return <EntityContext.Provider value={value}>{children}</EntityContext.Provider>;
}

export function useEntity() {
  const context = useContext(EntityContext);
  if (!context) throw new Error("useEntity debe usarse dentro de EntityProvider");
  return context;
}
