-- =====================================================================
-- WineCore · Pruebas de invariantes de base de datos (datos 100 % sintéticos)
-- Ejecutar sobre una BD vacía tras aplicar 0001..0015:
--   psql -v ON_ERROR_STOP=1 -f docs/02-ddl/tests/invariants_test.sql
-- Cada bloque DO comprueba que una operación prohibida falla con su código WCnnn
-- y que una operación válida funciona. Si algo no se comporta así, RAISE y el script falla.
-- En Fase 2 este fichero lo ejecuta el job de CI "db-invariants" (docs/11-tests.md §4).
-- =====================================================================
\set ON_ERROR_STOP 1
SET client_min_messages = warning;

CREATE OR REPLACE FUNCTION pg_temp.expect_error(p_sql text, p_code text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    IF position(p_code IN SQLERRM) = 0 THEN
      RAISE EXCEPTION 'Se esperaba % pero falló con: %', p_code, SQLERRM;
    END IF;
    RETURN;
  END;
  RAISE EXCEPTION 'Se esperaba el error % y la sentencia funcionó: %', p_code, p_sql;
END $$;

BEGIN;
SELECT core.set_actor('migration', 'test-seed', NULL, 'test', NULL);

-- Entidades sintéticas (NIF ficticios con formato válido)
INSERT INTO core.legal_entity(id, code, legal_name, tax_id, person_type, income_tax, address_line, postal_code, city, province)
VALUES ('00000000-0000-0000-0000-0000000000a1','PO','Productor Sintético','00000000T','natural','IRPF','C/ Prueba 1','23000','Jaén','Jaén'),
       ('00000000-0000-0000-0000-0000000000a2','CVPO','Comercializadora Sintética S.L.','B00000000','legal','IS','C/ Prueba 2','46000','Valencia','Valencia');

INSERT INTO core.app_user(id, email, display_name, status) VALUES
 ('00000000-0000-0000-0000-0000000001e1','aprobador@winecore.test','Aprobador Test','active');

-- 1) Numeración sin huecos y con formato
INSERT INTO core.number_series(id, legal_entity_id, doc_type, code, year, prefix, padding, is_default, verifactu)
VALUES ('00000000-0000-0000-0000-0000000002e1','00000000-0000-0000-0000-0000000000a2','invoice','CF',2027,'CF27-',4,true,true);
DO $$ BEGIN
  IF core.take_number('00000000-0000-0000-0000-0000000002e1') <> 'CF27-0001' THEN RAISE EXCEPTION 'numeración 1'; END IF;
  IF core.take_number('00000000-0000-0000-0000-0000000002e1') <> 'CF27-0002' THEN RAISE EXCEPTION 'numeración 2'; END IF;
END $$;
SELECT pg_temp.expect_error($q$ DELETE FROM core.number_series $q$, 'WC001');
COMMIT;

-- Un número tomado en una transacción deshecha se reutiliza (no hay huecos)
BEGIN;
SELECT core.set_actor('migration', 'test', NULL, 'test', NULL);
SELECT core.take_number('00000000-0000-0000-0000-0000000002e1');
ROLLBACK;
BEGIN;
SELECT core.set_actor('migration', 'test', NULL, 'test', NULL);
DO $$ BEGIN
  IF core.take_number('00000000-0000-0000-0000-0000000002e1') <> 'CF27-0003' THEN RAISE EXCEPTION 'hueco tras rollback'; END IF;
END $$;
COMMIT;

-- 2) Contexto de actor obligatorio para tablas auditadas
BEGIN;
SELECT pg_temp.expect_error($q$ INSERT INTO party.contact(kind, legal_name, created_by) VALUES ('company','Sin Actor','x') $q$, 'WC002');
ROLLBACK;

-- 3) Auditoría inmutable y cadena verificable
BEGIN;
SELECT core.set_actor('user', 'tester', NULL, 'test', NULL);
SELECT pg_temp.expect_error($q$ UPDATE audit.audit_log SET actor_id = 'x' $q$, 'WC003');
SELECT pg_temp.expect_error($q$ DELETE FROM audit.audit_log $q$, 'WC003');
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM audit.verify_chain()) THEN RAISE EXCEPTION 'cadena de auditoría rota'; END IF;
END $$;
COMMIT;

-- Datos maestros para el resto de pruebas
BEGIN;
SELECT core.set_actor('migration', 'test-seed', NULL, 'test', NULL);
INSERT INTO party.contact(id, kind, legal_name, tax_id, tax_id_type, is_customer, created_by)
VALUES ('00000000-0000-0000-0000-0000000003c1','company','Cliente Sintético S.L.','B11111111','nif',true,'test');
INSERT INTO catalog.wine(id, code, name, color) VALUES ('00000000-0000-0000-0000-0000000004d1','TESTBLANCO','Blanco de prueba','white');
INSERT INTO catalog.format(id, code, name, container, nominal_volume_ml) VALUES ('00000000-0000-0000-0000-0000000005f1','B075','Botella 0,75 L','bottle',750);
INSERT INTO catalog.product(id, sku, name, kind, wine_id, vintage, format_id, requires_lot, default_tax_code)
VALUES ('00000000-0000-0000-0000-0000000006a1','TB-2026-075','Blanco de prueba 2026 0,75','wine',
        '00000000-0000-0000-0000-0000000004d1',2026,'00000000-0000-0000-0000-0000000005f1',true,'IVA21');
INSERT INTO inventory.tax_warehouse(id, legal_entity_id, cae, activity_code, name, is_test)
VALUES ('00000000-0000-0000-0000-0000000007a1','00000000-0000-0000-0000-0000000000a1','ES00000V0000T','V1','Fábrica sintética',true);
INSERT INTO inventory.location(id, code, name, kind, tax_warehouse_id, controlling_entity_id)
VALUES ('00000000-0000-0000-0000-0000000008a1','BOD','Bodega sintética','cellar','00000000-0000-0000-0000-0000000007a1','00000000-0000-0000-0000-0000000000a1');
INSERT INTO cellar.vessel(id, code, name, kind, capacity_ml, has_cooling_jacket, material, location_id)
VALUES ('00000000-0000-0000-0000-0000000009b1','INOX-01','Depósito 1','tank_storage',5000000,false,'stainless_steel','00000000-0000-0000-0000-0000000008a1'),
       ('00000000-0000-0000-0000-0000000009b2','INOX-02','Depósito 2','tank_storage',5000000,false,'stainless_steel','00000000-0000-0000-0000-0000000008a1'),
       ('00000000-0000-0000-0000-0000000009b3','INOX-03','Depósito 3','tank_storage',1000000,false,'stainless_steel','00000000-0000-0000-0000-0000000008a1');
INSERT INTO inventory.lot(id, producer_entity_id, code, kind, wine_id, vintage, origin)
VALUES ('00000000-0000-0000-0000-0000000010a1','00000000-0000-0000-0000-0000000000a1','L26001','wine','00000000-0000-0000-0000-0000000004d1',2026,'opening_count'),
       ('00000000-0000-0000-0000-0000000010a2','00000000-0000-0000-0000-0000000000a1','L26002','wine','00000000-0000-0000-0000-0000000004d1',2026,'opening_count');
INSERT INTO core.number_series(id, legal_entity_id, doc_type, code, year, prefix, is_default)
VALUES ('00000000-0000-0000-0000-0000000002e2','00000000-0000-0000-0000-0000000000a1','cellar_operation','OB',2027,'OB27-',true);
-- Aforo inicial: 3.000 L de L26001 en INOX-01 y 2.000 L de L26002 en INOX-02
INSERT INTO inventory.stock_move(occurred_at, move_type, location_id, vessel_id, owner_entity_id, lot_id, product_state, volume_ml, source_table, source_id, created_by)
VALUES ('2027-01-01 00:00+01','opening','00000000-0000-0000-0000-0000000008a1','00000000-0000-0000-0000-0000000009b1','00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000010a1','wine',3000000,'inventory.inventory_count',gen_random_uuid(),'test'),
       ('2027-01-01 00:00+01','opening','00000000-0000-0000-0000-0000000008a1','00000000-0000-0000-0000-0000000009b2','00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000010a2','wine',2000000,'inventory.inventory_count',gen_random_uuid(),'test');
COMMIT;

-- 4) Saldo negativo prohibido (al confirmar la transacción)
DO $$ BEGIN
  BEGIN
    PERFORM core.set_actor('user','tester',NULL,'t',NULL);
    INSERT INTO inventory.stock_move(occurred_at, move_type, location_id, vessel_id, owner_entity_id, lot_id, product_state, volume_ml, source_table, source_id, created_by)
    VALUES (now(),'cellar_out','00000000-0000-0000-0000-0000000008a1','00000000-0000-0000-0000-0000000009b1','00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000010a1','wine',-3500000,'cellar.operation',gen_random_uuid(),'test');
    SET CONSTRAINTS ALL IMMEDIATE;
    RAISE EXCEPTION 'debió fallar WC024';
  EXCEPTION WHEN OTHERS THEN
    IF position('WC024' IN SQLERRM) = 0 THEN RAISE; END IF;
  END;
END $$;

-- 5) Capacidad y un solo lote por recipiente
DO $$ BEGIN
  BEGIN
    PERFORM core.set_actor('user','tester',NULL,'t',NULL);
    INSERT INTO inventory.stock_move(occurred_at, move_type, location_id, vessel_id, owner_entity_id, lot_id, product_state, volume_ml, source_table, source_id, created_by)
    VALUES (now(),'cellar_in','00000000-0000-0000-0000-0000000008a1','00000000-0000-0000-0000-0000000009b3','00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000010a1','wine',1500000,'cellar.operation',gen_random_uuid(),'test');
    SET CONSTRAINTS ALL IMMEDIATE;
    RAISE EXCEPTION 'debió fallar WC025';
  EXCEPTION WHEN OTHERS THEN
    IF position('WC025' IN SQLERRM) = 0 AND position('WC024' IN SQLERRM) = 0 THEN RAISE; END IF;
  END;
END $$;
DO $$ BEGIN
  BEGIN
    PERFORM core.set_actor('user','tester',NULL,'t',NULL);
    INSERT INTO inventory.stock_move(occurred_at, move_type, location_id, vessel_id, owner_entity_id, lot_id, product_state, volume_ml, source_table, source_id, created_by)
    VALUES (now(),'cellar_in','00000000-0000-0000-0000-0000000008a1','00000000-0000-0000-0000-0000000009b1','00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000010a2','wine',100000,'cellar.operation',gen_random_uuid(),'test');
    SET CONSTRAINTS ALL IMMEDIATE;
    RAISE EXCEPTION 'debió fallar WC026';
  EXCEPTION WHEN OTHERS THEN
    IF position('WC026' IN SQLERRM) = 0 THEN RAISE; END IF;
  END;
END $$;

-- 6) Conservación de volumen en una operación de bodega (trasiego con merma)
BEGIN;
SELECT core.set_actor('user', 'tester', NULL, 'test', NULL);
INSERT INTO cellar.operation(id, legal_entity_id, op_type, occurred_at, performed_by, created_by)
VALUES ('00000000-0000-0000-0000-0000000011c1','00000000-0000-0000-0000-0000000000a1','racking','2027-01-10 10:00+01','Operario','test');
INSERT INTO cellar.operation_line(operation_id, role, lot_id, vessel_id, product_state, volume_ml)
VALUES ('00000000-0000-0000-0000-0000000011c1','input','00000000-0000-0000-0000-0000000010a1','00000000-0000-0000-0000-0000000009b1','wine',1000000),
       ('00000000-0000-0000-0000-0000000011c1','output','00000000-0000-0000-0000-0000000010a1','00000000-0000-0000-0000-0000000009b3','wine',980000);
INSERT INTO cellar.operation_line(operation_id, role, lot_id, vessel_id, product_state, volume_ml, loss_kind)
VALUES ('00000000-0000-0000-0000-0000000011c1','loss','00000000-0000-0000-0000-0000000010a1','00000000-0000-0000-0000-0000000009b1','wine',20000,'authorized');
UPDATE cellar.operation SET status='confirmed', number=core.take_number('00000000-0000-0000-0000-0000000002e2'), confirmed_at=now()
 WHERE id='00000000-0000-0000-0000-0000000011c1';
COMMIT;   -- 1000 = 980 + 20 → cumple

DO $$ BEGIN
  BEGIN
    PERFORM core.set_actor('user','tester',NULL,'t',NULL);
    INSERT INTO cellar.operation(id, legal_entity_id, op_type, occurred_at, performed_by, created_by)
    VALUES ('00000000-0000-0000-0000-0000000011c2','00000000-0000-0000-0000-0000000000a1','racking','2027-01-11 10:00+01','Operario','test');
    INSERT INTO cellar.operation_line(operation_id, role, lot_id, vessel_id, product_state, volume_ml)
    VALUES ('00000000-0000-0000-0000-0000000011c2','input','00000000-0000-0000-0000-0000000010a1','00000000-0000-0000-0000-0000000009b1','wine',500000),
           ('00000000-0000-0000-0000-0000000011c2','output','00000000-0000-0000-0000-0000000010a1','00000000-0000-0000-0000-0000000009b3','wine',499000);
    UPDATE cellar.operation SET status='confirmed', number='OB27-9999', confirmed_at=now() WHERE id='00000000-0000-0000-0000-0000000011c2';
    SET CONSTRAINTS ALL IMMEDIATE;
    RAISE EXCEPTION 'debió fallar WC020';
  EXCEPTION WHEN OTHERS THEN
    IF position('WC020' IN SQLERRM) = 0 THEN RAISE; END IF;
  END;
END $$;

-- Operación confirmada: sus líneas no se tocan y solo puede marcarse como rectificada
BEGIN;
SELECT core.set_actor('user', 'tester', NULL, 'test', NULL);
SELECT pg_temp.expect_error($q$ DELETE FROM cellar.operation_line WHERE operation_id='00000000-0000-0000-0000-0000000011c1' $q$, 'WC031');
SELECT pg_temp.expect_error($q$ UPDATE cellar.operation SET occurred_at = now() WHERE id='00000000-0000-0000-0000-0000000011c1' $q$, 'WC032');
SELECT pg_temp.expect_error($q$ DELETE FROM cellar.operation WHERE id='00000000-0000-0000-0000-0000000011c1' $q$, 'WC001');
ROLLBACK;

-- 7) Genealogía sin ciclos
BEGIN;
SELECT core.set_actor('user', 'tester', NULL, 'test', NULL);
INSERT INTO inventory.lot(id, producer_entity_id, code, kind, origin)
VALUES ('00000000-0000-0000-0000-0000000010a3','00000000-0000-0000-0000-0000000000a1','L26003','wine','operation');
INSERT INTO inventory.lot_edge(child_lot_id, parent_lot_id, operation_id, volume_ml)
VALUES ('00000000-0000-0000-0000-0000000010a3','00000000-0000-0000-0000-0000000010a1','00000000-0000-0000-0000-0000000011c1',1),
       ('00000000-0000-0000-0000-0000000010a3','00000000-0000-0000-0000-0000000010a2','00000000-0000-0000-0000-0000000011c1',1);
SELECT pg_temp.expect_error($q$ INSERT INTO inventory.lot_edge(child_lot_id, parent_lot_id, operation_id, volume_ml)
  VALUES ('00000000-0000-0000-0000-0000000010a1','00000000-0000-0000-0000-0000000010a3','00000000-0000-0000-0000-0000000011c1',1) $q$, 'WC030');
DO $$ BEGIN
  IF (SELECT count(*) FROM inventory.lot_ancestors('00000000-0000-0000-0000-0000000010a3')) <> 2 THEN RAISE EXCEPTION 'ancestros'; END IF;
END $$;
ROLLBACK;

-- 8) Libro de movimientos: solo inserción; periodos cerrados
BEGIN;
SELECT core.set_actor('user', 'tester', NULL, 'test', NULL);
SELECT pg_temp.expect_error($q$ UPDATE inventory.stock_move SET volume_ml = 1 $q$, 'WC022');
SELECT pg_temp.expect_error($q$ DELETE FROM inventory.stock_move $q$, 'WC001');
INSERT INTO inventory.period_lock(ledger, locked_until, locked_by, reason) VALUES ('physical','2027-01-31','tester','cierre enero');
SELECT pg_temp.expect_error($q$ INSERT INTO inventory.stock_move(occurred_at, move_type, location_id, vessel_id, owner_entity_id, lot_id, product_state, volume_ml, source_table, source_id, created_by)
  VALUES ('2027-01-15 10:00+01','cellar_in','00000000-0000-0000-0000-0000000008a1','00000000-0000-0000-0000-0000000009b2','00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000010a2','wine',1,'cellar.operation',gen_random_uuid(),'t') $q$, 'WC021');
ROLLBACK;

-- 9) Factura: emitida ⇒ inmutable; borrar prohibido
BEGIN;
SELECT core.set_actor('user', 'tester', NULL, 'test', NULL);
INSERT INTO billing.invoice(id, legal_entity_id, series_id, invoice_type, customer_id, created_by)
VALUES ('00000000-0000-0000-0000-0000000012d1','00000000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-0000000002e1','F1','00000000-0000-0000-0000-0000000003c1','test');
INSERT INTO billing.invoice_line(invoice_id, line_no, product_id, description, lot_code, quantity, unit_price, line_base, tax_code)
VALUES ('00000000-0000-0000-0000-0000000012d1',1,'00000000-0000-0000-0000-0000000006a1','Blanco de prueba 2026','L26001',12,8.5,102.00,'IVA21');
UPDATE billing.invoice SET status='issued', number=core.take_number('00000000-0000-0000-0000-0000000002e1'),
       issue_date='2027-01-15', issued_at=now(), subtotal=102.00, tax_total=21.42, surcharge_total=0, withholding_total=0, total=123.42,
       customer_snapshot='{"name":"Cliente Sintético S.L.","tax_id":"B11111111"}'
 WHERE id='00000000-0000-0000-0000-0000000012d1';
COMMIT;

BEGIN;
SELECT core.set_actor('user', 'tester', NULL, 'test', NULL);
SELECT pg_temp.expect_error($q$ UPDATE billing.invoice SET total = 1 WHERE id='00000000-0000-0000-0000-0000000012d1' $q$, 'WC080');
SELECT pg_temp.expect_error($q$ UPDATE billing.invoice_line SET unit_price = 1 WHERE invoice_id='00000000-0000-0000-0000-0000000012d1' $q$, 'WC080');
SELECT pg_temp.expect_error($q$ DELETE FROM billing.invoice WHERE id='00000000-0000-0000-0000-0000000012d1' $q$, 'WC001');
UPDATE billing.invoice SET sent_at = now(), sent_channel = 'download' WHERE id='00000000-0000-0000-0000-0000000012d1';  -- permitido
COMMIT;

-- 10) Cobro parcial y exceso de cobro
BEGIN;
SELECT core.set_actor('user', 'tester', NULL, 'test', NULL);
INSERT INTO finance.payment(id, legal_entity_id, direction, method, amount, value_date, counterparty_id, source, created_by)
VALUES ('00000000-0000-0000-0000-0000000013e1','00000000-0000-0000-0000-0000000000a2','in','transfer',100.00,'2027-01-20','00000000-0000-0000-0000-0000000003c1','manual','test');
INSERT INTO finance.payment_allocation(payment_id, target_table, target_id, amount, allocated_by)
VALUES ('00000000-0000-0000-0000-0000000013e1','billing.invoice','00000000-0000-0000-0000-0000000012d1',100.00,'test');
DO $$ BEGIN
  IF (SELECT payment_status FROM billing.invoice WHERE id='00000000-0000-0000-0000-0000000012d1') <> 'partially_paid' THEN RAISE EXCEPTION 'estado de cobro'; END IF;
END $$;
INSERT INTO finance.payment(id, legal_entity_id, direction, method, amount, value_date, counterparty_id, source, created_by)
VALUES ('00000000-0000-0000-0000-0000000013e2','00000000-0000-0000-0000-0000000000a2','in','transfer',50.00,'2027-01-21','00000000-0000-0000-0000-0000000003c1','manual','test');
SELECT pg_temp.expect_error($q$ INSERT INTO finance.payment_allocation(payment_id, target_table, target_id, amount, allocated_by)
  VALUES ('00000000-0000-0000-0000-0000000013e2','billing.invoice','00000000-0000-0000-0000-0000000012d1',50.00,'test') $q$, 'WC100');
COMMIT;

-- 11) Aprobación ligada al hash del contenido
BEGIN;
SELECT core.set_actor('user', 'tester', NULL, 'test', NULL);
INSERT INTO ops.approval_request(id, kind, legal_entity_id, subject_table, subject_id, payload_sha256, summary, requested_by, expires_at)
VALUES ('00000000-0000-0000-0000-0000000014f1','regulatory_submission','00000000-0000-0000-0000-0000000000a1','regulatory.submission',gen_random_uuid(),
        repeat('a',64),'Envío SILICIE de prueba','tester', now() + interval '1 day');
SELECT pg_temp.expect_error($q$ INSERT INTO ops.approval_decision(request_id, decided_by, decision, payload_sha256)
  VALUES ('00000000-0000-0000-0000-0000000014f1','00000000-0000-0000-0000-0000000001e1','approve', repeat('b',64)) $q$, 'WC040');
INSERT INTO ops.approval_decision(request_id, decided_by, decision, payload_sha256, step_up_method, step_up_at)
VALUES ('00000000-0000-0000-0000-0000000014f1','00000000-0000-0000-0000-0000000001e1','approve', repeat('a',64),'passkey',now());
SELECT pg_temp.expect_error($q$ UPDATE ops.approval_decision SET note = 'x' $q$, 'WC041');
COMMIT;

-- 12) Cadena Verifactu: solo crece por el final y no se modifica
BEGIN;
SELECT core.set_actor('system', 'verifactu', NULL, 'test', NULL);
INSERT INTO regulatory.verifactu_installation(id, legal_entity_id, environment, mode, system_version, installation_number, producer_name, producer_tax_id, starts_on)
VALUES ('00000000-0000-0000-0000-0000000015a1','00000000-0000-0000-0000-0000000000a2','test','verifactu','0.1.0','1','Productor Sintético','00000000T','2027-01-01');
INSERT INTO regulatory.verifactu_record(id, installation_id, legal_entity_id, chain_seq, record_type, invoice_id, issuer_tax_id, invoice_number, invoice_issue_date,
       invoice_type, total_tax, total_amount, generated_at, hash, record_xml)
VALUES ('00000000-0000-0000-0000-0000000016b1','00000000-0000-0000-0000-0000000015a1','00000000-0000-0000-0000-0000000000a2',1,'alta','00000000-0000-0000-0000-0000000012d1',
        'B00000000','CF27-0003','2027-01-15','F1',21.42,123.42,now(), repeat('A',64),'<RegistroAlta/>');
SELECT pg_temp.expect_error($q$ INSERT INTO regulatory.verifactu_record(installation_id, legal_entity_id, chain_seq, record_type, invoice_id, issuer_tax_id, invoice_number, invoice_issue_date,
       invoice_type, total_tax, total_amount, previous_record_id, previous_hash, generated_at, hash, record_xml)
  VALUES ('00000000-0000-0000-0000-0000000015a1','00000000-0000-0000-0000-0000000000a2',3,'alta','00000000-0000-0000-0000-0000000012d1','B00000000','CF27-0004','2027-01-16',
          'F1',0,0,'00000000-0000-0000-0000-0000000016b1',repeat('A',64),now(),repeat('B',64),'<RegistroAlta/>') $q$, 'WC130');
SELECT pg_temp.expect_error($q$ UPDATE regulatory.verifactu_record SET total_amount = 1 $q$, 'WC130');
UPDATE regulatory.verifactu_record SET send_status = 'accepted', aeat_csv = 'CSVTEST' WHERE id = '00000000-0000-0000-0000-0000000016b1';  -- permitido
COMMIT;

-- 13) Envío regulatorio: un único intento de envío en curso
BEGIN;
SELECT core.set_actor('system', 'regulatorio', NULL, 'test', NULL);
INSERT INTO regulatory.submission(id, flow, legal_entity_id, kind, payload, payload_sha256, created_by)
VALUES ('00000000-0000-0000-0000-0000000017c1','silicie','00000000-0000-0000-0000-0000000000a1','silicie.asientos','{}', repeat('c',64),'test');
INSERT INTO regulatory.connector_run(submission_id, attempt, action) VALUES ('00000000-0000-0000-0000-0000000017c1',1,'submit');
SELECT pg_temp.expect_error($q$ INSERT INTO regulatory.connector_run(submission_id, attempt, action) VALUES ('00000000-0000-0000-0000-0000000017c1',2,'submit') $q$, 'connector_run_single_submit_uq');
ROLLBACK;

-- 14) Reglas de entidad facturadora: cliente > canal > defecto
BEGIN;
SELECT core.set_actor('user', 'tester', NULL, 'test', NULL);
INSERT INTO billing.billing_rule_set(id, version, created_by) VALUES ('00000000-0000-0000-0000-0000000018d1',1,'test');
INSERT INTO billing.billing_rule(rule_set_id, scope, issuing_entity_id) VALUES ('00000000-0000-0000-0000-0000000018d1','default','00000000-0000-0000-0000-0000000000a2');
INSERT INTO billing.billing_rule(rule_set_id, scope, channel, issuing_entity_id) VALUES ('00000000-0000-0000-0000-0000000018d1','channel','export','00000000-0000-0000-0000-0000000000a1');
INSERT INTO billing.billing_rule(rule_set_id, scope, customer_id, issuing_entity_id) VALUES ('00000000-0000-0000-0000-0000000018d1','customer','00000000-0000-0000-0000-0000000003c1','00000000-0000-0000-0000-0000000000a1');
UPDATE billing.billing_rule_set SET status='active', activated_at=now() WHERE id='00000000-0000-0000-0000-0000000018d1';
DO $$ BEGIN
  IF (SELECT matched_scope FROM billing.resolve_issuing_entity('00000000-0000-0000-0000-0000000003c1','direct')) <> 'customer' THEN RAISE EXCEPTION 'regla cliente'; END IF;
  IF (SELECT matched_scope FROM billing.resolve_issuing_entity(gen_random_uuid(),'export')) <> 'channel' THEN RAISE EXCEPTION 'regla canal'; END IF;
  IF (SELECT matched_scope FROM billing.resolve_issuing_entity(gen_random_uuid(),'horeca')) <> 'default' THEN RAISE EXCEPTION 'regla defecto'; END IF;
END $$;
SELECT pg_temp.expect_error($q$ INSERT INTO billing.billing_rule(rule_set_id, scope, channel, issuing_entity_id)
  VALUES ('00000000-0000-0000-0000-0000000018d1','channel','web','00000000-0000-0000-0000-0000000000a2') $q$, 'WC070');
ROLLBACK;

-- 15) La cadena de auditoría sigue íntegra tras todo lo anterior
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM audit.verify_chain()) THEN RAISE EXCEPTION 'cadena de auditoría rota al final'; END IF;
END $$;

SELECT 'OK: todas las pruebas de invariantes han pasado' AS resultado;
