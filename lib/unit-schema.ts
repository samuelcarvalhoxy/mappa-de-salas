// One transaction, one migration marker and an owner-only snapshot before changing existing data.
export const UNIT_SCHEMA_VERSION = "units_v1_20261027";
export const URUGUAI_ID = "10000000-0000-4000-8000-000000000001";
export const CABULA_ID = "10000000-0000-4000-8000-000000000002";
export const SAO_BENTO_ID = "10000000-0000-4000-8000-000000000003";
export const UNIT_TABLES = ["roles", "rooms", "reservations", "booking_requests", "shifts", "audit_log", "room_issues", "feedback_reports", "notifications", "notification_templates", "notification_broadcasts", "retention_rollups", "request_decision_totals", "request_expiry_alerts", "room_review_responsibilities"] as const;

export const UNIT_MIGRATION_SQL = `DO $migration$
DECLARE t text; backup_schema text := current_schema() || '_units_backup_20261027';
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(current_schema() || ':mappa:units:v1'));
  IF EXISTS (SELECT 1 FROM app_settings WHERE key='${UNIT_SCHEMA_VERSION}') THEN RETURN; END IF;
  EXECUTE format('CREATE SCHEMA IF NOT EXISTS %I', backup_schema);
  EXECUTE format('REVOKE ALL ON SCHEMA %I FROM PUBLIC', backup_schema);
  FOREACH t IN ARRAY ARRAY['users',${UNIT_TABLES.map(t => `'${t}'`).join(",")}] LOOP
    EXECUTE format('CREATE TABLE IF NOT EXISTS %I.%I AS TABLE %I.%I', backup_schema,t,current_schema(),t);
  END LOOP;
  CREATE TABLE units(id uuid PRIMARY KEY,code text UNIQUE NOT NULL,name text NOT NULL,active boolean NOT NULL DEFAULT true,display_order int NOT NULL);
  INSERT INTO units VALUES ('${CABULA_ID}','cabula','CABULA',true,1),('${SAO_BENTO_ID}','sao-bento','SÃO BENTO',true,2),('${URUGUAI_ID}','uruguai','URUGUAI',true,3);
  CREATE OR REPLACE FUNCTION mappa_assert(ok boolean,message text) RETURNS boolean LANGUAGE plpgsql AS $fn$ BEGIN IF ok IS NOT TRUE THEN RAISE EXCEPTION '%',message; END IF; RETURN true; END $fn$;
  CREATE OR REPLACE FUNCTION mappa_current_unit() RETURNS uuid LANGUAGE sql STABLE AS $fn$
    SELECT NULLIF(current_setting('mappa.unit_id',true),'')::uuid
  $fn$;
  ALTER TABLE users ADD COLUMN primary_unit_id uuid NOT NULL DEFAULT '${URUGUAI_ID}' REFERENCES units(id);
  FOREACH t IN ARRAY ARRAY[${UNIT_TABLES.map(t => `'${t}'`).join(",")}] LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN unit_id uuid DEFAULT COALESCE(mappa_current_unit(),%L::uuid) REFERENCES units(id)',t,'${URUGUAI_ID}');
    EXECUTE format('UPDATE %I SET unit_id=%L WHERE unit_id IS NULL',t,'${URUGUAI_ID}');
    IF t NOT IN ('audit_log','feedback_reports') THEN EXECUTE format('ALTER TABLE %I ALTER COLUMN unit_id SET NOT NULL',t); END IF;
    EXECUTE format('CREATE INDEX %I ON %I(unit_id)',t || '_unit_idx',t);
  END LOOP;
  ALTER TABLE roles DROP CONSTRAINT roles_name_key;
  ALTER TABLE roles ADD CONSTRAINT roles_unit_name_key UNIQUE(unit_id,name);
  ALTER TABLE shifts DROP CONSTRAINT shifts_name_key;
  ALTER TABLE shifts ADD CONSTRAINT shifts_unit_name_key UNIQUE(unit_id,name);
  INSERT INTO roles(name,color,permissions,system,unit_id)
    SELECT r.name,r.color,r.permissions,r.system,u.id FROM roles r CROSS JOIN units u
    WHERE r.unit_id='${URUGUAI_ID}' AND r.name IN ('God','Gestão','ADM','Usuário') AND u.id<>'${URUGUAI_ID}';
  INSERT INTO shifts(name,start_time,end_time,unit_id)
    SELECT s.name,s.start_time,s.end_time,u.id FROM shifts s CROSS JOIN units u WHERE s.unit_id='${URUGUAI_ID}' AND u.id<>'${URUGUAI_ID}';
  CREATE TABLE unit_memberships(user_id uuid NOT NULL REFERENCES users(id),unit_id uuid NOT NULL REFERENCES units(id),role_id uuid NOT NULL REFERENCES roles(id),active boolean NOT NULL DEFAULT true,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(user_id,unit_id));
  INSERT INTO unit_memberships(user_id,unit_id,role_id) SELECT id,primary_unit_id,role_id FROM users WHERE NOT is_god AND deleted_at IS NULL;
  CREATE TABLE unit_handovers(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),unit_id uuid NOT NULL DEFAULT mappa_current_unit() REFERENCES units(id),user_id uuid NOT NULL REFERENCES users(id),destination_unit_id uuid REFERENCES units(id),created_by uuid NOT NULL REFERENCES users(id),summary text NOT NULL,reviewed_by uuid REFERENCES users(id),reviewed_at timestamptz,created_at timestamptz NOT NULL DEFAULT now());
  ALTER TABLE roles ADD CONSTRAINT roles_id_unit_key UNIQUE(id,unit_id);
  ALTER TABLE unit_memberships ADD CONSTRAINT membership_role_unit_fk FOREIGN KEY(role_id,unit_id) REFERENCES roles(id,unit_id);
  ALTER TABLE rooms ADD CONSTRAINT rooms_id_unit_key UNIQUE(id,unit_id);
  ALTER TABLE reservations ADD CONSTRAINT reservations_id_unit_key UNIQUE(id,unit_id);
  ALTER TABLE reservations ADD CONSTRAINT reservation_room_unit_fk FOREIGN KEY(room_id,unit_id) REFERENCES rooms(id,unit_id);
  ALTER TABLE booking_requests ADD CONSTRAINT request_room_unit_fk FOREIGN KEY(room_id,unit_id) REFERENCES rooms(id,unit_id);
  ALTER TABLE booking_requests ADD CONSTRAINT request_reservation_unit_fk FOREIGN KEY(approved_reservation_id,unit_id) REFERENCES reservations(id,unit_id);
  ALTER TABLE room_issues ADD CONSTRAINT issue_room_unit_fk FOREIGN KEY(room_id,unit_id) REFERENCES rooms(id,unit_id);
  ALTER TABLE room_review_responsibilities ADD CONSTRAINT responsibility_room_unit_fk FOREIGN KEY(room_id,unit_id) REFERENCES rooms(id,unit_id);
  ALTER TABLE request_decision_totals DROP CONSTRAINT request_decision_totals_pkey;
  ALTER TABLE request_decision_totals ADD PRIMARY KEY(unit_id,decided_on,requester_key,room_key,outcome);
  ALTER TABLE retention_rollups DROP CONSTRAINT retention_rollups_pkey;
  ALTER TABLE retention_rollups ADD PRIMARY KEY(unit_id,month,actor_key,action);
  CREATE OR REPLACE FUNCTION mappa_unit_allowed() RETURNS boolean LANGUAGE sql STABLE AS $fn$
    SELECT EXISTS(SELECT 1 FROM users u WHERE u.id=NULLIF(current_setting('mappa.actor_id',true),'')::uuid
      AND u.active AND u.deleted_at IS NULL AND (u.is_god OR EXISTS(SELECT 1 FROM unit_memberships m WHERE m.user_id=u.id AND m.unit_id=mappa_current_unit() AND m.active)))
  $fn$;
  CREATE OR REPLACE FUNCTION mappa_user_in_unit(target uuid,include_inactive boolean DEFAULT false) RETURNS boolean LANGUAGE sql STABLE AS $fn$
    SELECT EXISTS(SELECT 1 FROM users u WHERE u.id=target AND u.deleted_at IS NULL AND (include_inactive OR u.active)
      AND (u.is_god OR EXISTS(SELECT 1 FROM unit_memberships m WHERE m.user_id=u.id AND m.unit_id=mappa_current_unit() AND (include_inactive OR m.active))))
  $fn$;
  CREATE OR REPLACE FUNCTION mappa_effective_role(target uuid,fallback uuid) RETURNS uuid LANGUAGE sql STABLE AS $fn$
    SELECT COALESCE((SELECT m.role_id FROM unit_memberships m WHERE m.user_id=target AND m.unit_id=mappa_current_unit()),
      (SELECT r.id FROM roles r WHERE r.unit_id=mappa_current_unit() AND r.name='God' AND EXISTS(SELECT 1 FROM users u WHERE u.id=target AND u.is_god)),fallback)
  $fn$;
  CREATE OR REPLACE FUNCTION count_booking_request_decision() RETURNS trigger LANGUAGE plpgsql AS $fn$
  BEGIN
    IF NEW.status IN ('approved','rejected') AND NOT NEW.decision_counted THEN
      NEW.decision_kind := CASE WHEN NEW.status='approved' THEN 'approved' WHEN NEW.decision_kind='automatic_rejected' THEN 'automatic_rejected' ELSE 'manual_rejected' END;
      INSERT INTO request_decision_totals(unit_id,decided_on,requester_key,room_key,outcome,decision_count)
        VALUES(NEW.unit_id,(COALESCE(NEW.reviewed_at,now()) AT TIME ZONE 'America/Bahia')::date,NEW.requester_id::text,COALESCE(NEW.room_id::text,'any'),NEW.decision_kind,1)
        ON CONFLICT(unit_id,decided_on,requester_key,room_key,outcome) DO UPDATE SET decision_count=request_decision_totals.decision_count+1;
      NEW.decision_counted := true;
    END IF; RETURN NEW;
  END $fn$;
  CREATE OR REPLACE FUNCTION mappa_validate_unit_user() RETURNS trigger LANGUAGE plpgsql AS $fn$
  BEGIN
    IF TG_TABLE_NAME='reservations' THEN
      IF TG_OP='INSERT' OR NEW.user_id IS DISTINCT FROM OLD.user_id THEN
        IF NOT mappa_user_in_unit(NEW.user_id) THEN RAISE EXCEPTION 'USER_OUTSIDE_UNIT'; END IF;
      END IF;
    ELSIF TG_TABLE_NAME='room_review_responsibilities' THEN
      IF NOT mappa_user_in_unit(NEW.user_id) THEN RAISE EXCEPTION 'USER_OUTSIDE_UNIT'; END IF;
    END IF; RETURN NEW;
  END $fn$;
  CREATE TRIGGER reservation_unit_user BEFORE INSERT OR UPDATE ON reservations FOR EACH ROW EXECUTE FUNCTION mappa_validate_unit_user();
  CREATE TRIGGER responsibility_unit_user BEFORE INSERT OR UPDATE ON room_review_responsibilities FOR EACH ROW EXECUTE FUNCTION mappa_validate_unit_user();
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='mappa_runtime') THEN CREATE ROLE mappa_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS; END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='mappa_runtime' AND (rolsuper OR rolbypassrls)) THEN RAISE EXCEPTION 'Unsafe mappa_runtime role'; END IF;
  EXECUTE format('GRANT mappa_runtime TO %I',current_user);
  EXECUTE format('GRANT USAGE ON SCHEMA %I TO mappa_runtime',current_schema());
  EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA %I TO mappa_runtime',current_schema());
  FOREACH t IN ARRAY ARRAY[${UNIT_TABLES.map(t => `'${t}'`).join(",")},'unit_handovers'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('CREATE POLICY unit_isolation ON %I FOR ALL TO mappa_runtime USING(unit_id=(SELECT mappa_current_unit()) AND (SELECT mappa_unit_allowed())) WITH CHECK(unit_id=(SELECT mappa_current_unit()) AND (SELECT mappa_unit_allowed()))',t);
  END LOOP;
  CREATE POLICY global_feedback_god ON feedback_reports FOR ALL TO mappa_runtime USING(unit_id IS NULL AND EXISTS(SELECT 1 FROM users WHERE id=NULLIF(current_setting('mappa.actor_id',true),'')::uuid AND active AND is_god AND deleted_at IS NULL)) WITH CHECK(unit_id IS NULL AND EXISTS(SELECT 1 FROM users WHERE id=NULLIF(current_setting('mappa.actor_id',true),'')::uuid AND active AND is_god AND deleted_at IS NULL));
  CREATE OR REPLACE FUNCTION mappa_label_notification() RETURNS trigger LANGUAGE plpgsql AS $fn$
  DECLARE unit_name text; unit_code text;
  BEGIN
    SELECT name,code INTO unit_name,unit_code FROM units WHERE id=NEW.unit_id;
    IF left(NEW.title,1)<>'[' THEN NEW.title:='['||unit_name||'] '||NEW.title; END IF;
    IF position('unit=' IN NEW.url)=0 THEN NEW.url:=NEW.url || CASE WHEN position('?' IN NEW.url)>0 THEN '&' ELSE '?' END || 'unit=' || unit_code; END IF;
    RETURN NEW;
  END $fn$;
  CREATE TRIGGER label_unit_notification BEFORE INSERT ON notifications FOR EACH ROW EXECUTE FUNCTION mappa_label_notification();
  CREATE POLICY public_feedback_insert ON feedback_reports FOR INSERT TO mappa_runtime WITH CHECK(unit_id IS NULL);
  FOREACH t IN ARRAY ARRAY['users','rooms','reservations','booking_requests'] LOOP
    EXECUTE format('SELECT mappa_assert((SELECT count(*) FROM %I.%I)=(SELECT count(*) FROM %I),%L)',backup_schema,t,t,'Migration row count mismatch: '||t);
  END LOOP;
  INSERT INTO app_settings(key,value) VALUES('${UNIT_SCHEMA_VERSION}',now()::text);
END $migration$`;
