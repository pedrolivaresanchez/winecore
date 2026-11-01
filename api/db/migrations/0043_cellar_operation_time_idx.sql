-- WineCore · 0043_cellar_operation_time_idx · dialecto DuckDB (ADR 002).
-- DuckDB ejecuta un UPDATE de una columna indexada como borrado + inserción y comprueba en ese
-- momento las claves foráneas, aunque las filas que la referencian se hayan borrado antes en la
-- misma transacción. Con este índice, cambiar la fecha de un borrador de operación con líneas (o
-- de una entrada de uva) fallaba. Las consultas por fecha no lo necesitan: DuckDB filtra por zonas.

DROP INDEX cellar.operation_time_idx;
