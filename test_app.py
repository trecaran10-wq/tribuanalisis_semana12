import json
import sqlite3
import tempfile
import unittest
import zipfile
from contextlib import closing
from io import BytesIO
from pathlib import Path

from app import create_app
from openpyxl import load_workbook


class AccountHistoryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.app = create_app({
            "TESTING": True,
            "SECRET_KEY": "test-key",
            "DATABASE": str(Path(self.temp.name) / "test.db"),
        })
        self.client = self.app.test_client()
        self.case = {
            "category": "Mermas",
            "description": "Pérdida de insumos",
            "support": "Informe técnico revisado",
            "expense": 100050,
            "deductible": 40025,
        }

    def csrf(self, client):
        with client.session_transaction() as state:
            return state["csrf"]

    def register(self, client, email):
        client.get("/auth")
        return client.post("/auth", data={
            "csrf": self.csrf(client), "action": "register", "email": email,
            "password": "password123", "confirm_password": "password123",
        })

    def headers(self, client):
        client.get("/")
        return {"X-CSRF-Token": self.csrf(client)}

    def test_accounts_history_and_isolation(self):
        self.assertEqual(self.client.get("/api/state").status_code, 401)
        self.assertEqual(self.register(self.client, "one@example.com").status_code, 302)
        headers = self.headers(self.client)
        self.assertEqual(self.client.post("/api/cases", json=self.case, headers=headers).status_code, 201)
        self.assertEqual(self.client.put("/api/profile", json={"company": "Empresa", "period": "2026"}, headers=headers).status_code, 200)
        state = self.client.get("/api/state").get_json()
        self.assertEqual((state["company"], state["period"]), ("Empresa", "2026"))
        self.assertEqual(state["cases"][0]["expense"] - state["cases"][0]["deductible"], 60025)
        case_id = state["cases"][0]["id"]
        second = self.app.test_client()
        self.register(second, "two@example.com")
        second_headers = self.headers(second)
        self.assertEqual(second.get("/api/state").get_json()["cases"], [])
        self.assertEqual(second.delete(f"/api/cases/{case_id}", headers=second_headers).status_code, 404)
        self.assertEqual(self.client.get("/api/state").get_json()["cases"][0]["id"], case_id)
        self.client.post("/logout", data={"csrf": headers["X-CSRF-Token"]})
        self.client.get("/auth")
        response = self.client.post("/auth", data={"csrf": self.csrf(self.client), "action": "login", "email": "one@example.com", "password": "password123"})
        self.assertEqual(response.status_code, 302)
        self.assertEqual(len(self.client.get("/api/state").get_json()["cases"]), 1)

    def test_validation_csrf_and_import_once(self):
        self.register(self.client, "one@example.com")
        headers = self.headers(self.client)
        self.assertEqual(self.client.post("/api/cases", json=self.case).status_code, 403)
        invalid = dict(self.case, deductible=100051)
        self.assertEqual(self.client.post("/api/cases", json=invalid, headers=headers).status_code, 400)
        self.assertEqual(self.client.post("/api/import", json={"cases": [invalid]}, headers=headers).status_code, 400)
        self.assertEqual(self.client.post("/api/import", json={"cases": [self.case]}, headers=headers).status_code, 200)
        self.assertEqual(self.client.post("/api/import", json={"cases": [self.case]}, headers=headers).status_code, 409)
        self.assertEqual(len(self.client.get("/api/state").get_json()["cases"]), 1)
        self.assertEqual(self.client.put("/api/profile", json={"company": "Empresa", "period": "1800"}, headers=headers).status_code, 400)

    def test_duplicate_account_and_wrong_password(self):
        self.register(self.client, "one@example.com")
        self.client.post("/logout", data={"csrf": self.headers(self.client)["X-CSRF-Token"]})
        duplicate = self.register(self.client, "ONE@example.com")
        self.assertIn("Ya existe", duplicate.get_data(as_text=True))
        bad_login = self.client.post("/auth", data={"csrf": self.csrf(self.client), "action": "login", "email": "one@example.com", "password": "wrongpass"})
        self.assertIn("incorrectos", bad_login.get_data(as_text=True))
        self.assertEqual(self.client.get("/api/state").status_code, 401)

    def test_dashboard_assets_and_excel_template(self):
        self.assertEqual(self.client.get("/assets/welcome.png").status_code, 302)
        self.register(self.client, "one@example.com")
        for name in ("welcome.png", "checklist.png", "mermas.png", "desmedros.png", "depreciacion.png", "cobranza.png", "informe.png", "historial.png", "guia.png", "perfil.png", "docente.png", "equipo-1.png", "equipo-2.png", "equipo-3.png", "equipo-4.png", "equipo-5.png"):
            response = self.client.get(f"/assets/{name}")
            self.assertEqual(response.mimetype, "image/png")
            response.close()
        workbook = self.client.get("/assets/plantilla-casos.xlsx")
        self.assertEqual(workbook.status_code, 200)
        self.assertIn("attachment", workbook.headers["Content-Disposition"])
        self.assertTrue(zipfile.is_zipfile(BytesIO(workbook.data)))
        workbook.close()
        self.assertEqual(self.client.get("/assets/unknown.png").status_code, 404)

    def test_auth_background_is_available_without_login(self):
        response = self.client.get("/auth-background.png")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.mimetype, "image/png")
        response.close()
        stylesheet = self.client.get("/style.css")
        self.assertIn(b'url("/auth-background.png")', stylesheet.get_data())
        stylesheet.close()

    def test_account_name_is_private_and_validated(self):
        self.register(self.client, "one@example.com")
        headers = self.headers(self.client)
        state = self.client.get("/api/state").get_json()
        self.assertTrue(state["registered_at"])
        self.assertTrue(state["last_login"])
        self.assertEqual(self.client.put("/api/account-name", json={"name": "Ana"}).status_code, 403)
        self.assertEqual(self.client.put("/api/account-name", json={"name": " "}, headers=headers).status_code, 400)
        self.assertEqual(self.client.put("/api/account-name", json={"name": "x" * 101}, headers=headers).status_code, 400)
        self.assertEqual(self.client.put("/api/account-name", json={"name": " Ana Pérez "}, headers=headers).get_json()["name"], "Ana Pérez")
        self.assertEqual(self.client.get("/api/state").get_json()["display_name"], "Ana Pérez")
        second = self.app.test_client()
        self.register(second, "two@example.com")
        self.assertIsNone(second.get("/api/state").get_json()["display_name"])
        self.client.post("/logout", data={"csrf": headers["X-CSRF-Token"]})
        self.client.get("/auth")
        self.client.post("/auth", data={"csrf": self.csrf(self.client), "action": "login", "email": "one@example.com", "password": "password123"})
        self.assertEqual(self.client.get("/api/state").get_json()["display_name"], "Ana Pérez")

    def test_existing_users_migrate_without_inventing_dates(self):
        path = str(Path(self.temp.name) / "old.db")
        with closing(sqlite3.connect(path)) as connection:
            with connection:
                connection.execute("CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, company TEXT NOT NULL DEFAULT '', period TEXT NOT NULL DEFAULT '', imported INTEGER NOT NULL DEFAULT 0)")
                connection.execute("INSERT INTO users (email, password_hash) VALUES ('old@example.com', 'old-hash')")
        create_app({"TESTING": True, "SECRET_KEY": "test-key", "DATABASE": path})
        with closing(sqlite3.connect(path)) as connection:
            user = connection.execute("SELECT email, display_name, registered_at, last_login FROM users").fetchone()
        self.assertEqual(user, ("old@example.com", None, None, None))

    def test_project_code_download_excludes_private_data(self):
        self.assertEqual(self.client.get("/api/project-code").status_code, 401)
        self.register(self.client, "one@example.com")
        response = self.client.get("/api/project-code")
        with zipfile.ZipFile(BytesIO(response.data)) as archive:
            names = archive.namelist()
            self.assertIn("app.py", names)
            self.assertIn("index.html", names)
            self.assertIn("assets/perfil.png", names)
            self.assertIn("assets/docente.png", names)
            self.assertFalse(any("instance" in name or name.endswith(".db") or "key" in name for name in names))

    def test_history_export_selection_and_text_safety(self):
        self.register(self.client, "one@example.com")
        headers = self.headers(self.client)
        first = dict(self.case, description="=1+1")
        self.client.post("/api/cases", json=first, headers=headers)
        first_id = self.client.get("/api/state").get_json()["cases"][0]["id"]
        self.client.post("/api/cases", json=self.case, headers=headers)
        state = self.client.get("/api/state").get_json()
        self.assertIsNotNone(state["cases"][0]["updated_at"])
        self.assertEqual(self.client.post("/api/cases/export", json={"case_ids": [first_id]}).status_code, 403)
        self.assertEqual(self.client.post("/api/cases/export", json={"case_ids": []}, headers=headers).status_code, 400)
        self.assertEqual(self.client.post("/api/cases/export", json={"case_ids": [first_id, first_id]}, headers=headers).status_code, 400)
        response = self.client.post("/api/cases/export", json={"case_ids": [first_id]}, headers=headers)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.mimetype, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
        workbook = load_workbook(BytesIO(response.data))
        sheet = workbook.active
        self.assertEqual(sheet.max_row, 2)
        self.assertEqual((sheet["C2"].value, sheet["C2"].data_type), ("=1+1", "s"))
        self.assertEqual((sheet["E2"].value, sheet["F2"].value, sheet["G2"].value), (1000.5, 400.25, 600.25))
        workbook.close()
        response.close()
        second = self.app.test_client()
        self.register(second, "two@example.com")
        self.assertEqual(second.post("/api/cases/export", json={"case_ids": [first_id]}, headers=self.headers(second)).status_code, 400)

    def test_history_migration_preserves_old_cases(self):
        path = str(Path(self.temp.name) / "old.db")
        connection = sqlite3.connect(path)
        connection.executescript("""
            CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, company TEXT NOT NULL DEFAULT '', period TEXT NOT NULL DEFAULT '', imported INTEGER NOT NULL DEFAULT 0);
            CREATE TABLE cases (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), category TEXT NOT NULL, description TEXT NOT NULL, support TEXT NOT NULL, expense INTEGER NOT NULL, deductible INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
            INSERT INTO users (id, email, password_hash) VALUES (1, 'old@example.com', 'old');
            INSERT INTO cases (user_id, category, description, support, expense, deductible) VALUES (1, 'Mermas', 'Caso anterior', 'Sustento', 100, 50);
        """)
        connection.commit()
        connection.close()
        create_app({"TESTING": True, "SECRET_KEY": "test-key", "DATABASE": path})
        connection = sqlite3.connect(path)
        row = connection.execute("SELECT description, expense, deductible, updated_at FROM cases").fetchone()
        connection.close()
        self.assertEqual(row, ("Caso anterior", 100, 50, None))

    def test_report_settings_are_validated_and_isolated(self):
        self.register(self.client, "one@example.com")
        headers = self.headers(self.client)
        self.client.post("/api/cases", json=self.case, headers=headers)
        case_id = self.client.get("/api/state").get_json()["cases"][0]["id"]
        settings = {
            "type": "technical",
            "sections": {"charts": True, "analysis": True, "law": False, "conclusions": True, "evidence": True},
            "case_ids": [case_id],
        }
        self.assertEqual(self.client.put("/api/report-settings", json=settings).status_code, 403)
        self.assertEqual(self.client.put("/api/report-settings", json=settings, headers=headers).status_code, 200)
        self.assertEqual(self.client.get("/api/state").get_json()["report_settings"], settings)
        self.assertEqual(self.client.put("/api/report-settings", json=dict(settings, case_ids=[case_id, case_id]), headers=headers).status_code, 400)
        self.assertEqual(self.client.put("/api/report-settings", json=dict(settings, sections={"charts": True}), headers=headers).status_code, 400)
        second = self.app.test_client()
        self.register(second, "two@example.com")
        second_headers = self.headers(second)
        self.assertIsNone(second.get("/api/state").get_json()["report_settings"])
        self.assertEqual(second.put("/api/report-settings", json=settings, headers=second_headers).status_code, 400)
        self.assertEqual(self.client.get("/api/state").get_json()["report_settings"], settings)
        self.assertEqual(self.client.delete(f"/api/cases/{case_id}", headers=headers).status_code, 200)
        self.assertEqual(self.client.get("/api/state").get_json()["report_settings"]["case_ids"], [])
        self.client.post("/api/cases", json=self.case, headers=headers)
        self.assertEqual(self.client.get("/api/state").get_json()["report_settings"]["case_ids"], [])

    def test_draft_files_update_and_account_isolation(self):
        self.register(self.client, "one@example.com")
        headers = self.headers(self.client)
        payload = {"category": "Mermas", "fields": {"company": "Empresa", "subject": "Insumos"}, "kept_files": []}
        response = self.client.post("/api/drafts", data={"payload": json.dumps(payload), "files": (BytesIO(b"documento"), "evidencia.pdf")}, headers=headers)
        self.assertEqual(response.status_code, 200)
        saved = response.get_json()
        draft_id = saved["id"]
        file_id = saved["files"][0]["id"]
        self.assertEqual(self.client.get("/api/drafts").get_json()["drafts"][0]["fields"]["subject"], "Insumos")
        self.assertEqual(self.client.get(f"/api/drafts/{draft_id}/files/{file_id}").data, b"documento")
        self.assertEqual(self.client.get("/api/state").get_json()["cases"], [])

        second = self.app.test_client()
        self.register(second, "two@example.com")
        other_headers = self.headers(second)
        self.assertEqual(second.get("/api/drafts").get_json()["drafts"], [])
        self.assertEqual(second.get(f"/api/drafts/{draft_id}").status_code, 404)
        self.assertEqual(second.get(f"/api/drafts/{draft_id}/files/{file_id}").status_code, 404)
        self.assertEqual(second.delete(f"/api/drafts/{draft_id}", headers=other_headers).status_code, 404)
        payload.update(id=draft_id, kept_files=[file_id])
        self.assertEqual(second.post("/api/drafts", data={"payload": json.dumps(payload)}, headers=other_headers).status_code, 404)

        payload["fields"]["subject"] = "Insumos actualizados"
        response = self.client.post("/api/drafts", data={"payload": json.dumps(payload)}, headers=headers)
        self.assertEqual(response.get_json()["files"][0]["id"], file_id)
        self.assertEqual(self.client.get(f"/api/drafts/{draft_id}").get_json()["fields"]["subject"], "Insumos actualizados")
        payload["kept_files"] = []
        self.assertEqual(self.client.post("/api/drafts", data={"payload": json.dumps(payload)}, headers=headers).get_json()["files"], [])
        self.assertEqual(self.client.get(f"/api/drafts/{draft_id}/files/{file_id}").status_code, 404)
        self.assertEqual(self.client.delete(f"/api/drafts/{draft_id}", headers=headers).status_code, 200)
        self.assertEqual(self.client.get("/api/drafts").get_json()["drafts"], [])

    def test_draft_validation_and_limits(self):
        self.register(self.client, "one@example.com")
        headers = self.headers(self.client)
        payload = {"category": "Desmedros", "fields": {}, "kept_files": []}
        def post(data, request_headers=headers):
            return self.client.post("/api/drafts", data=data, headers=request_headers)
        self.assertEqual(post({"payload": json.dumps(payload)}, {}).status_code, 403)
        self.assertEqual(post({"payload": "{"}).status_code, 400)
        self.assertEqual(post({"payload": json.dumps(dict(payload, category=[]))}).status_code, 400)
        self.assertEqual(post({"payload": json.dumps(dict(payload, fields={"unknown": "x"}))}).status_code, 400)
        self.assertEqual(post({"payload": json.dumps(payload), "files": (BytesIO(b"bad"), "malware.exe")}).status_code, 400)
        self.assertEqual(post({"payload": json.dumps(payload), "files": (BytesIO(b""), "empty.pdf")}).status_code, 400)
        self.assertEqual(post({"payload": json.dumps(payload), "files": (BytesIO(b"x" * (10 * 1024 * 1024 + 1)), "large.pdf")}).status_code, 400)
        self.assertEqual(post({"payload": json.dumps(payload), "files": [(BytesIO(b"x"), f"{i}.pdf") for i in range(6)]}).status_code, 400)
        response = post({"payload": json.dumps(payload), "files": (BytesIO(b"x" * (10 * 1024 * 1024)), "limit.pdf")})
        self.assertEqual(response.status_code, 200)
        draft_id = response.get_json()["id"]
        file_id = response.get_json()["files"][0]["id"]
        self.assertEqual(response.get_json()["files"][0]["size"], 10 * 1024 * 1024)
        payload.update(id=draft_id, kept_files=[file_id + 100])
        self.assertEqual(post({"payload": json.dumps(payload)}).status_code, 400)
        self.assertEqual(len(self.client.get(f"/api/drafts/{draft_id}").get_json()["files"]), 1)

    def test_review_persistence_and_file_associations(self):
        self.register(self.client, "one@example.com")
        headers = self.headers(self.client)
        payload = {"category": "Mermas", "fields": {"subject": "Insumos"}, "kept_files": []}
        created = self.client.post("/api/drafts", data={"payload": json.dumps(payload), "files": (BytesIO(b"evidencia"), "evidencia.pdf")}, headers=headers).get_json()
        draft_id = created["id"]
        file_id = created["files"][0]["id"]
        review = {"step": 2, "items": {"report": {"status": "met", "file_ids": [file_id]}, "method": {"status": "not_met", "file_ids": []}}}
        payload.update(id=draft_id, kept_files=[file_id], review=review)
        saved = self.client.post("/api/drafts", data={"payload": json.dumps(payload)}, headers=headers)
        self.assertEqual(saved.status_code, 200)
        self.assertEqual(self.client.get(f"/api/drafts/{draft_id}").get_json()["review"], review)
        self.assertEqual(self.client.get("/api/drafts").get_json()["drafts"][0]["step"], 2)

        invalid = dict(payload, review={"step": 2, "items": {"report": {"status": "met", "file_ids": [file_id + 1]}}})
        self.assertEqual(self.client.post("/api/drafts", data={"payload": json.dumps(invalid)}, headers=headers).status_code, 400)
        invalid["review"]["items"] = {"unknown": {"status": "met", "file_ids": []}}
        self.assertEqual(self.client.post("/api/drafts", data={"payload": json.dumps(invalid)}, headers=headers).status_code, 400)
        invalid["review"]["items"] = {"report": {"status": "approved", "file_ids": []}}
        self.assertEqual(self.client.post("/api/drafts", data={"payload": json.dumps(invalid)}, headers=headers).status_code, 400)
        self.assertEqual(self.client.get(f"/api/drafts/{draft_id}").get_json()["review"], review)

        second = self.app.test_client()
        self.register(second, "two@example.com")
        other_headers = self.headers(second)
        self.assertEqual(second.post("/api/drafts", data={"payload": json.dumps(payload)}, headers=other_headers).status_code, 404)
        del payload["review"]
        payload["kept_files"] = []
        self.assertEqual(self.client.post("/api/drafts", data={"payload": json.dumps(payload)}, headers=headers).status_code, 200)
        updated = self.client.get(f"/api/drafts/{draft_id}").get_json()
        self.assertEqual(updated["review"]["items"]["report"], {"status": "met", "file_ids": []})
        self.assertEqual(updated["review"]["items"]["method"]["status"], "not_met")
        self.assertEqual(updated["files"], [])

    def test_calculation_draft_and_validation(self):
        self.register(self.client, "one@example.com")
        headers = self.headers(self.client)
        review = {"step": 3, "items": {}, "calculation": {"non_admitted": "125,50", "tax_rate": "29.5"}}
        payload = {"category": "Mermas", "fields": {"subject": "Insumos"}, "kept_files": [], "review": review}
        response = self.client.post("/api/drafts", data={"payload": json.dumps(payload)}, headers=headers)
        self.assertEqual(response.status_code, 200)
        draft_id = response.get_json()["id"]
        self.assertEqual(self.client.get(f"/api/drafts/{draft_id}").get_json()["review"], review)
        self.assertEqual(self.client.get("/api/drafts").get_json()["drafts"][0]["step"], 3)
        payload["id"] = draft_id
        review["calculation"]["tax_rate"] = "100.01"
        self.assertEqual(self.client.post("/api/drafts", data={"payload": json.dumps(payload)}, headers=headers).status_code, 400)
        review["calculation"]["tax_rate"] = ""
        review["calculation"]["non_admitted"] = "-1"
        self.assertEqual(self.client.post("/api/drafts", data={"payload": json.dumps(payload)}, headers=headers).status_code, 400)
        review["calculation"]["non_admitted"] = "1.001"
        self.assertEqual(self.client.post("/api/drafts", data={"payload": json.dumps(payload)}, headers=headers).status_code, 400)
        self.assertEqual(self.client.get(f"/api/drafts/{draft_id}").get_json()["review"]["calculation"], {"non_admitted": "125,50", "tax_rate": "29.5"})
        second = self.app.test_client()
        self.register(second, "two@example.com")
        self.assertEqual(second.get(f"/api/drafts/{draft_id}").status_code, 404)

    def test_finalize_reviewed_case_idempotently_and_isolate(self):
        self.register(self.client, "one@example.com")
        headers = self.headers(self.client)
        payload = {
            "category": "Mermas",
            "fields": {"company": "Empresa", "date": "2026-01-01", "subject": "Insumos", "cause": "Sustento", "quantity": "250", "unit_cost": "12"},
            "kept_files": [],
            "review": {"step": 4, "items": {}, "calculation": {"non_admitted": "500", "tax_rate": "29.5"}},
        }
        created = self.client.post("/api/drafts", data={"payload": json.dumps(payload)}, headers=headers).get_json()
        draft_id = created["id"]
        second = self.app.test_client()
        self.register(second, "two@example.com")
        self.assertEqual(second.post(f"/api/drafts/{draft_id}/finalize", headers=self.headers(second)).status_code, 404)
        self.assertEqual(self.client.post(f"/api/drafts/{draft_id}/finalize").status_code, 403)
        response = self.client.post(f"/api/drafts/{draft_id}/finalize", headers=headers)
        self.assertEqual(response.status_code, 200)
        case_id = response.get_json()["id"]
        self.assertEqual(self.client.post(f"/api/drafts/{draft_id}/finalize", headers=headers).get_json()["id"], case_id)
        state = self.client.get("/api/state").get_json()
        self.assertEqual(len(state["cases"]), 1)
        self.assertEqual((state["cases"][0]["expense"], state["cases"][0]["deductible"], state["cases"][0]["draft_id"]), (300000, 250000, draft_id))
        payload["id"] = draft_id
        payload["review"]["calculation"]["non_admitted"] = "3000.01"
        self.client.post("/api/drafts", data={"payload": json.dumps(payload)}, headers=headers)
        self.assertEqual(self.client.post(f"/api/drafts/{draft_id}/finalize", headers=headers).status_code, 400)
        self.assertEqual(self.client.get("/api/state").get_json()["cases"][0]["deductible"], 250000)
        payload["review"]["calculation"]["non_admitted"] = "1000"
        self.client.post("/api/drafts", data={"payload": json.dumps(payload)}, headers=headers)
        self.assertEqual(self.client.post(f"/api/drafts/{draft_id}/finalize", headers=headers).get_json()["id"], case_id)
        self.assertEqual(self.client.get("/api/state").get_json()["cases"][0]["deductible"], 200000)
        self.assertEqual(self.client.delete(f"/api/cases/{case_id}", headers=headers).status_code, 200)
        self.assertIsNone(self.client.get(f"/api/drafts/{draft_id}").get_json()["case_id"])
        self.assertEqual(self.client.post(f"/api/drafts/{draft_id}/finalize", headers=headers).status_code, 200)
        self.assertEqual(self.client.delete(f"/api/drafts/{draft_id}", headers=headers).status_code, 200)
        self.assertEqual(len(self.client.get("/api/state").get_json()["cases"]), 1)
        self.assertIsNone(self.client.get("/api/state").get_json()["cases"][0]["draft_id"])


if __name__ == "__main__":
    unittest.main()
