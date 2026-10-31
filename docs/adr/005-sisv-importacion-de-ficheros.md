# ADR 005 · SISV: importación de ficheros por *computer use*

- **Estado**: propuesto (depende de Q-012 y Q-020) · 31-10-2026
- **Relacionado**: `04-regulatorio/sisv.md`, ADR 009 (conector y ejecutor local), `04-regulatorio/silicie.md` §10 (cuadre).

## Contexto

- **HECHO**: SISV es una aplicación web de la Junta de Andalucía con acceso por certificado digital. Permite **importar los libros** desde ficheros de texto de ancho fijo (modelo de intercambio v02) en dos pasos: "Cargar fichero" y "Importar fichero".
- **HECHO**: la presentación de los registros vence el **día 10** de cada mes por el mes anterior (Orden de 14-11-2012, art. 26.4).
- **HECHO**: no hemos encontrado un servicio web público para SISV. La Junta sí tiene API REST para el DAT (transporte de productos agrarios), con alta como integrador.
- Hoy los ficheros los genera Bacosoft y una persona los importa.
- La §12.1 del plan pide empezar por *computer use* sobre portales.

## Decisión

1. WineCore **genera los ficheros oficiales** (un fichero por libro más la cabecera `LIBRO`) a partir de `regulatory.sisv_entry`, con *golden files* y validación contra ficheros reales de Bacosoft del mismo mes antes de M3.
2. El **ejecutor local** (ADR 009) entra en SISV con el certificado del equipo, carga e importa cada fichero, descarga el resultado y lo sube como evidencia. Solo tras la aprobación mensual.
3. Si la Junta publica (o nos da) un servicio de importación, se añade un conector `api` sin cambiar el contenido canónico.
4. **Respaldo** si el portal cambia o el ejecutor falla: WineCore entrega los ficheros y una persona los importa a mano (como hoy).

## Alternativas

| Opción | Por qué no (por ahora) |
|---|---|
| Teclear anotación a anotación con *computer use* | Lento, frágil y con más riesgo de errores que importar el fichero oficial |
| Seguir con Bacosoft para SISV | Mantiene la doble fuente de verdad que se quiere eliminar; Bacosoft se da de baja |
| Pedir acceso de integrador a la Junta | Sin servicio SISV documentado; se pregunta igualmente (Q-012) |

## Consecuencias

- Hay que mantener la especificación v02 (tablas C0–C8) versionada en `api/src/core/regulatory/sisv/spec/` y vigilar cambios.
- La certificación del enólogo para las manipulaciones se genera en PDF y la firma una persona (no el sistema).
