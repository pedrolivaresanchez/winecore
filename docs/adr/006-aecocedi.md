# ADR 006 · Integración con AecocEDI (El Corte Inglés)

- **Estado**: propuesto · 31-10-2026 · Hito M3
- **Fuentes**: `04-regulatorio/aecoc-edi.md` (todas consultadas el 31-10-2026).

## Contexto
- AecocEDI es solo web (GLN + contraseña + CAPTCHA ocasional); sin API ni formato de carga publicados; condiciones de uso sin cláusula sobre automatización; volumen bajo (2–4 pedidos/mes).
- §12.1 del plan: *computer use* primero, conector intercambiable; APIs más adelante si compensan.
- La factura electrónica B2B (RD 238/2026) obligará desde el 06-10-2028 a emitir por plataforma privada conforme o por la solución pública de la AEAT; no consta que AecocEDI vaya a ser plataforma conforme.

## Opciones
| Opción | Qué es | Pros | Contras | Coste |
|---|---|---|---|---|
| **A. Computer use asistido** | El ejecutor local lee documentos y prepara facturas en el portal; una persona aprueba antes de "Enviar" | Funciona ya; sin contratos; reproduce el proceso actual; aprobación humana natural | Frágil ante cambios; CAPTCHA; sin acuse técnico; permiso de AECOC sin confirmar | 0–192 €/año + equipo del ejecutor |
| B. Carga de fichero en AecocEDI | WineCore genera el fichero y se sube | Determinista | Formato no publicado | Igual que A |
| C. Proveedor EDI con API/VAN | Sustituir AecocEDI | Automatización completa; suele ser plataforma de factura electrónica conforme | Coste y alta nueva con ECI; desproporcionado hoy | Ofertas |
| D. 2028: factura legal por la solución pública + pedidos en AecocEDI | UBL gratuito en la AEAT | Cumple 2028 aunque AecocEDI no se adapte | Doble canal; depende de ECI | 0 € |

## Decisión
1. **A ahora** (M3), con la **ficha para teclear** como respaldo permanente y la regla de que la factura **nace en WineCore** (Verifactu) y lo tecleado debe coincidir campo a campo (comparación automática antes de aprobar).
2. Pedir a AECOC (Pedro) el formato de carga (B) y la confirmación escrita sobre automatización; adoptar B si existe.
3. Antes del **2T-2028**, decidir entre C y D según las respuestas de AECOC (plataforma art. 13) y ECI (punto de entrada, DESADV/SSCC).

## Consecuencias
- Procedimientos `aecocedi-*` en `runner/procedures/` con `assert_text` y capturas.
- Credenciales de AecocEDI y del portal de ECI solo en el llavero del ejecutor.
- Si AECOC prohíbe la automatización, se usa solo la ficha para teclear (una persona teclea) y se acelera la decisión C/D.
