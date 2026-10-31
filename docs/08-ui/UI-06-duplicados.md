# UI-06 · Duplicados de contactos

| | |
|---|---|
| Ruta | `/contactos/duplicados` |
| Objetivo | Revisar los posibles duplicados (mismo NIF, nombre parecido, mismo correo o teléfono) y fusionarlos sin perder documentos |
| Historias | US-CONT-02, US-MIG-01 |
| Módulo y permiso | contacts · `contacts.write` |
| Patrón | Bandeja |

## Componentes
`DataTable` de parejas candidatas (puntuación, motivo), `DiffView` lado a lado, `RadioGroup` por campo para elegir el valor que se conserva.

## Datos (API)
- `GET /api/v1/contacts/duplicates?min_score=` → parejas con motivo (`same_tax_id`, `similar_name`, `same_email`, `same_phone`) y puntuación.
- `POST /api/v1/contacts/{keep_id}/merge` con `{merge_id, field_choices}` → crea `party.contact_merge`, mueve documentos y deja el fusionado en solo lectura.
- `POST /api/v1/contacts/duplicates/{pair}/dismiss` (no son duplicados).

## Acciones
| Acción | Permiso | Efecto | Confirmación |
|---|---|---|---|
| Fusionar | `contacts.write` | Conserva uno; el otro queda "fusionado en"; los documentos emitidos **no** cambian sus datos congelados | `Dialog`: "Se moverán N documentos. Las facturas emitidas mantienen sus datos." |
| No son duplicados | `contacts.write` | La pareja no vuelve a proponerse | — |

## Estados
Vacío: "No hay duplicados sospechosos". Pareja con NIF distinto válido: aviso "NIF diferentes: revisa antes de fusionar".

## Móvil
Solo lectura de la lista; la fusión se hace en escritorio (aviso "Usa un ordenador para fusionar").

## Wireframe
```
Duplicados                                    (Puntuación ≥ 0,8)
┌ Bodegas Ejemplo SL  ⇄  BODEGAS EJEMPLO, S.L.   0,94 · mismo NIF ┐
│ Nombre   (•) Bodegas Ejemplo SL   ( ) BODEGAS EJEMPLO, S.L.    │
│ Correo   (•) pedidos@example.com  ( ) —                         │
│                              [No son duplicados] [Fusionar]     │
└─────────────────────────────────────────────────────────────────┘
```
