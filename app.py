import json
import re
import secrets
import sqlite3
import zipfile
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from functools import wraps
from io import BytesIO
from pathlib import Path

from flask import Flask, abort, flash, g, jsonify, redirect, render_template, request, send_file, send_from_directory, session, url_for
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill
from werkzeug.exceptions import RequestEntityTooLarge
from werkzeug.security import check_password_hash, generate_password_hash
from werkzeug.utils import secure_filename

ROOT = Path(__file__).resolve().parent
CATEGORIES = {"Mermas", "Desmedros", "Depreciación", "Cobranza dudosa"}
MAX_CENTS = 100_000_000_000
MAX_FILE_SIZE = 10 * 1024 * 1024
MAX_FILES = 5
DRAFT_FIELDS = {"company", "date", "subject", "unit", "quantity", "unit_cost", "process", "cause", "asset_cost", "annual_expense", "document", "due_date", "receivable", "provision"}
FILE_EXTENSIONS = {".pdf", ".jpg", ".jpeg", ".png", ".xls", ".xlsx"}
REVIEW_KEYS = {
    "Mermas": {"nature", "report", "method", "expense", "records"},
    "Desmedros": {"condition", "proof", "notice", "document", "records"},
    "Depreciación": {"asset", "start", "rate", "accounting", "register"},
    "Cobranza dudosa": {"debt", "risk", "provision", "exclusions", "records"},
}


def create_app(test_config=None):
    app = Flask(__name__, template_folder=str(ROOT), static_folder=None)
    instance = Path(app.instance_path)
    instance.mkdir(parents=True, exist_ok=True)
    key_path = instance / ".session-key"
    if test_config is None:
        try:
            with key_path.open("x", encoding="utf-8") as key_file:
                key_file.write(secrets.token_hex(32))
        except FileExistsError:
            pass
        app.secret_key = key_path.read_text(encoding="utf-8")
    app.config.update(
        DATABASE=str(instance / "semana12.db"),
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SAMESITE="Lax",
        MAX_CONTENT_LENGTH=52 * 1024 * 1024,
    )
    if test_config:
        app.config.update(test_config)
    if not app.secret_key:
        raise RuntimeError("No se pudo configurar la clave de sesión.")

    def db():
        if "db" not in g:
            g.db = sqlite3.connect(app.config["DATABASE"])
            g.db.row_factory = sqlite3.Row
            g.db.execute("PRAGMA foreign_keys = ON")
        return g.db

    @app.teardown_appcontext
    def close_db(_error):
        connection = g.pop("db", None)
        if connection is not None:
            connection.close()

    with app.app_context():
        db().executescript("""
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY,
                email TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                company TEXT NOT NULL DEFAULT '',
                period TEXT NOT NULL DEFAULT '',
                imported INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS cases (
                id INTEGER PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id),
                category TEXT NOT NULL,
                description TEXT NOT NULL,
                support TEXT NOT NULL,
                expense INTEGER NOT NULL,
                deductible INTEGER NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT
            );
            CREATE TABLE IF NOT EXISTS drafts (
                id INTEGER PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id),
                category TEXT NOT NULL,
                fields TEXT NOT NULL,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS draft_files (
                id INTEGER PRIMARY KEY,
                draft_id INTEGER NOT NULL REFERENCES drafts(id) ON DELETE CASCADE,
                filename TEXT NOT NULL,
                content BLOB NOT NULL
            );
            CREATE TABLE IF NOT EXISTS draft_reviews (
                draft_id INTEGER PRIMARY KEY REFERENCES drafts(id) ON DELETE CASCADE,
                data TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS case_drafts (
                draft_id INTEGER PRIMARY KEY REFERENCES drafts(id) ON DELETE CASCADE,
                case_id INTEGER NOT NULL UNIQUE REFERENCES cases(id) ON DELETE CASCADE
            );
            CREATE TABLE IF NOT EXISTS report_settings (
                user_id INTEGER PRIMARY KEY REFERENCES users(id),
                data TEXT NOT NULL
            );
        """)
        if "updated_at" not in {row["name"] for row in db().execute("PRAGMA table_info(cases)")}:
            db().execute("ALTER TABLE cases ADD COLUMN updated_at TEXT")
        user_columns = {row["name"] for row in db().execute("PRAGMA table_info(users)")}
        for column in ("display_name", "registered_at", "last_login"):
            if column not in user_columns:
                db().execute(f"ALTER TABLE users ADD COLUMN {column} TEXT")
        db().commit()

    def token():
        if "csrf" not in session:
            session["csrf"] = secrets.token_urlsafe(32)
        return session["csrf"]

    def check_csrf():
        submitted = request.headers.get("X-CSRF-Token") or request.form.get("csrf", "")
        if not session.get("csrf") or not secrets.compare_digest(session["csrf"], submitted):
            abort(403)

    def login_required(func):
        @wraps(func)
        def wrapped(*args, **kwargs):
            if "user_id" not in session:
                if request.path.startswith("/api/"):
                    return jsonify(error="La sesión terminó. Inicia sesión nuevamente."), 401
                return redirect(url_for("auth"))
            return func(*args, **kwargs)
        return wrapped

    @app.errorhandler(RequestEntityTooLarge)
    def request_too_large(_error):
        return jsonify(error="Los archivos superan el límite total permitido."), 413

    def valid_case(item):
        if not isinstance(item, dict):
            return False
        category = item.get("category")
        description = item.get("description")
        support = item.get("support")
        expense = item.get("expense")
        deductible = item.get("deductible")
        return (
            isinstance(category, str) and category in CATEGORIES
            and isinstance(description, str) and 0 < len(description.strip()) <= 160
            and isinstance(support, str) and 0 < len(support.strip()) <= 500
            and type(expense) is int and 0 < expense <= MAX_CENTS
            and type(deductible) is int and 0 <= deductible <= expense
        )

    def insert_case(item):
        db().execute(
            "INSERT INTO cases (user_id, category, description, support, expense, deductible, updated_at) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)",
            (session["user_id"], item["category"], item["description"].strip(), item["support"].strip(), item["expense"], item["deductible"]),
        )

    def account_cases():
        rows = db().execute(
            "SELECT c.id, c.category, c.description, c.support, c.expense, c.deductible, c.created_at, c.updated_at, cd.draft_id, d.fields AS draft_fields FROM cases c LEFT JOIN case_drafts cd ON cd.case_id = c.id LEFT JOIN drafts d ON d.id = cd.draft_id WHERE c.user_id = ? ORDER BY c.id DESC",
            (session["user_id"],),
        ).fetchall()
        cases = []
        for row in rows:
            item = dict(row)
            fields = item.pop("draft_fields")
            item["draft_company"] = json.loads(fields).get("company", "") if fields else ""
            cases.append(item)
        return cases

    @app.route("/auth", methods=["GET", "POST"])
    def auth():
        if request.method == "POST":
            check_csrf()
            action = request.form.get("action")
            email = request.form.get("email", "").strip().lower()
            password = request.form.get("password", "")
            if action not in {"login", "register"}:
                abort(400)
            if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email) or len(email) > 254:
                flash("Ingresa un correo válido.")
            elif len(password) < 8 or len(password) > 128:
                flash("La contraseña debe tener entre 8 y 128 caracteres.")
            elif action == "register":
                if password != request.form.get("confirm_password"):
                    flash("Las contraseñas no coinciden.")
                else:
                    try:
                        cursor = db().execute("INSERT INTO users (email, password_hash, registered_at, last_login) VALUES (?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)", (email, generate_password_hash(password)))
                        db().commit()
                    except sqlite3.IntegrityError:
                        flash("Ya existe una cuenta con ese correo.")
                    else:
                        session.clear()
                        session["user_id"] = cursor.lastrowid
                        return redirect(url_for("index"))
            else:
                user = db().execute("SELECT id, password_hash FROM users WHERE email = ?", (email,)).fetchone()
                if user is None or not check_password_hash(user["password_hash"], password):
                    flash("Correo o contraseña incorrectos.")
                else:
                    db().execute("UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?", (user["id"],))
                    db().commit()
                    session.clear()
                    session["user_id"] = user["id"]
                    return redirect(url_for("index"))
            return render_template("auth.html", csrf=token(), active=action, email=email)
        if "user_id" in session:
            return redirect(url_for("index"))
        return render_template("auth.html", csrf=token(), active="login", email="")

    @app.post("/logout")
    @login_required
    def logout():
        check_csrf()
        session.clear()
        return redirect(url_for("auth"))

    @app.get("/")
    @login_required
    def index():
        return render_template("index.html", csrf=token())

    @app.get("/<any(style.css,app.js,auth.js,calculation.js):filename>")
    def assets(filename):
        return send_from_directory(ROOT, filename)

    @app.get("/auth-background.png")
    def auth_background():
        return send_from_directory(ROOT / "assets", "auth-background.png")

    @app.get("/assets/<any(welcome.png,checklist.png,mermas.png,desmedros.png,depreciacion.png,cobranza.png,informe.png,historial.png,guia.png,perfil.png,docente.png,'equipo-1.png','equipo-2.png','equipo-3.png','equipo-4.png','equipo-5.png','plantilla-casos.xlsx'):filename>")
    @login_required
    def dashboard_asset(filename):
        return send_from_directory(ROOT / "assets", filename, as_attachment=filename.endswith(".xlsx"))

    @app.get("/api/state")
    @login_required
    def state():
        user = db().execute("SELECT email, company, period, imported, display_name, registered_at, last_login FROM users WHERE id = ?", (session["user_id"],)).fetchone()
        if user is None:
            session.clear()
            return jsonify(error="La cuenta ya no existe. Inicia sesión nuevamente."), 401
        settings = db().execute("SELECT data FROM report_settings WHERE user_id = ?", (session["user_id"],)).fetchone()
        return jsonify(email=user["email"], company=user["company"], period=user["period"], display_name=user["display_name"], registered_at=user["registered_at"], last_login=user["last_login"], imported=bool(user["imported"]), cases=account_cases(), report_settings=json.loads(settings["data"]) if settings else None)

    @app.put("/api/account-name")
    @login_required
    def account_name():
        check_csrf()
        data = request.get_json()
        name = data.get("name") if isinstance(data, dict) else None
        if not isinstance(name, str) or not name.strip() or len(name.strip()) > 100:
            return jsonify(error="Ingresa un nombre de entre 1 y 100 caracteres."), 400
        name = name.strip()
        db().execute("UPDATE users SET display_name = ? WHERE id = ?", (name, session["user_id"]))
        db().commit()
        return jsonify(name=name)

    @app.get("/api/project-code")
    @login_required
    def project_code():
        archive = BytesIO()
        with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as bundle:
            for name in ("app.py", "app.js", "auth.js", "calculation.js", "index.html", "auth.html", "style.css", "requirements.txt", "README.md"):
                bundle.write(ROOT / name, name)
            for name in ("welcome.png", "checklist.png", "mermas.png", "desmedros.png", "depreciacion.png", "cobranza.png", "informe.png", "historial.png", "guia.png", "perfil.png", "docente.png", "equipo-1.png", "equipo-2.png", "equipo-3.png", "equipo-4.png", "equipo-5.png", "auth-background.png", "plantilla-casos.xlsx"):
                bundle.write(ROOT / "assets" / name, f"assets/{name}")
        archive.seek(0)
        return send_file(archive, mimetype="application/zip", as_attachment=True, download_name="codigo-tribuanalisis.zip")

    @app.put("/api/report-settings")
    @login_required
    def save_report_settings():
        check_csrf()
        payload = request.get_json(silent=True)
        section_names = {"charts", "analysis", "law", "conclusions", "evidence"}
        if not isinstance(payload, dict) or set(payload) != {"type", "sections", "case_ids"}:
            return jsonify(error="Configuración de informe inválida."), 400
        sections = payload["sections"]
        case_ids = payload["case_ids"]
        if (payload["type"] not in ("complete", "executive", "technical")
                or not isinstance(sections, dict) or set(sections) != section_names
                or any(type(value) is not bool for value in sections.values())
                or not isinstance(case_ids, list)
                or any(type(case_id) is not int or case_id <= 0 for case_id in case_ids)
                or len(case_ids) != len(set(case_ids))):
            return jsonify(error="Configuración de informe inválida."), 400
        db().execute("BEGIN IMMEDIATE")
        owned_ids = {row["id"] for row in db().execute("SELECT id FROM cases WHERE user_id = ?", (session["user_id"],))}
        if not set(case_ids).issubset(owned_ids):
            db().rollback()
            return jsonify(error="La selección contiene casos que no están disponibles en tu cuenta."), 400
        db().execute(
            "INSERT INTO report_settings (user_id, data) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET data = excluded.data",
            (session["user_id"], json.dumps(payload, ensure_ascii=False)),
        )
        db().commit()
        return jsonify(ok=True)

    @app.get("/api/drafts")
    @login_required
    def list_drafts():
        rows = db().execute(
            "SELECT d.id, d.category, d.fields, d.updated_at, r.data AS review, cd.case_id FROM drafts d LEFT JOIN draft_reviews r ON r.draft_id = d.id LEFT JOIN case_drafts cd ON cd.draft_id = d.id WHERE d.user_id = ? ORDER BY d.updated_at DESC, d.id DESC",
            (session["user_id"],),
        ).fetchall()
        return jsonify(drafts=[{"id": row["id"], "category": row["category"], "fields": json.loads(row["fields"]), "updated_at": row["updated_at"], "step": json.loads(row["review"])["step"] if row["review"] else 1, "case_id": row["case_id"]} for row in rows])

    @app.get("/api/drafts/<int:draft_id>")
    @login_required
    def get_draft(draft_id):
        draft = db().execute("SELECT id, category, fields FROM drafts WHERE id = ? AND user_id = ?", (draft_id, session["user_id"])).fetchone()
        if draft is None:
            return jsonify(error="No se encontró el borrador en tu cuenta."), 404
        files = db().execute("SELECT id, filename, length(content) AS size FROM draft_files WHERE draft_id = ? ORDER BY id", (draft_id,)).fetchall()
        review = db().execute("SELECT data FROM draft_reviews WHERE draft_id = ?", (draft_id,)).fetchone()
        link = db().execute("SELECT case_id FROM case_drafts WHERE draft_id = ?", (draft_id,)).fetchone()
        return jsonify(id=draft["id"], category=draft["category"], fields=json.loads(draft["fields"]), files=[dict(row) for row in files], review=json.loads(review["data"]) if review else {"step": 1, "items": {}}, case_id=link["case_id"] if link else None)

    @app.post("/api/drafts")
    @login_required
    def save_draft():
        check_csrf()
        try:
            payload = json.loads(request.form.get("payload", ""))
        except (ValueError, TypeError):
            return jsonify(error="Los datos del borrador no son válidos."), 400
        if not isinstance(payload, dict) or not isinstance(payload.get("category"), str) or payload.get("category") not in CATEGORIES:
            return jsonify(error="Selecciona una categoría válida."), 400
        fields = payload.get("fields")
        kept = payload.get("kept_files")
        draft_id = payload.get("id")
        if not isinstance(fields, dict) or set(fields) - DRAFT_FIELDS or any(not isinstance(value, str) or len(value) > 500 for value in fields.values()):
            return jsonify(error="Los datos del borrador no son válidos."), 400
        if not isinstance(kept, list) or any(type(value) is not int or value <= 0 for value in kept) or len(set(kept)) != len(kept):
            return jsonify(error="La lista de archivos no es válida."), 400
        if draft_id is not None and (type(draft_id) is not int or draft_id <= 0):
            return jsonify(error="El borrador no es válido."), 400
        review = payload.get("review")
        if review is not None:
            if not isinstance(review, dict) or type(review.get("step")) is not int or review["step"] not in (1, 2, 3, 4) or not isinstance(review.get("items"), dict):
                return jsonify(error="La revisión no es válida."), 400
            if set(review["items"]) - REVIEW_KEYS[payload["category"]]:
                return jsonify(error="Los puntos de revisión no corresponden a esta categoría."), 400
            for entry in review["items"].values():
                if not isinstance(entry, dict) or entry.get("status") not in ("pending", "met", "not_met") or not isinstance(entry.get("file_ids"), list):
                    return jsonify(error="El estado de revisión no es válido."), 400
                ids = entry["file_ids"]
                if any(type(value) is not int or value <= 0 for value in ids) or len(set(ids)) != len(ids) or not set(ids).issubset(kept):
                    return jsonify(error="Las evidencias de la revisión no son válidas."), 400
            calculation = review.get("calculation")
            if calculation is not None:
                if not isinstance(calculation, dict) or set(calculation) != {"non_admitted", "tax_rate"}:
                    return jsonify(error="Los datos del cálculo no son válidos."), 400
                if any(not isinstance(value, str) or (value and not re.fullmatch(r"\d{1,16}(?:[.,]\d{1,2})?", value)) for value in calculation.values()):
                    return jsonify(error="Ingresa importes y tasa con hasta dos decimales."), 400
                if calculation["tax_rate"] and Decimal(calculation["tax_rate"].replace(",", ".")) > 100:
                    return jsonify(error="La tasa debe estar entre 0 y 100 %."), 400
        uploads = request.files.getlist("files")
        if len(kept) + len(uploads) > MAX_FILES:
            return jsonify(error="Puedes adjuntar hasta cinco archivos por borrador."), 400
        files = []
        for upload in uploads:
            name = secure_filename(upload.filename or "")
            if not name or len(name) > 150 or Path(name).suffix.lower() not in FILE_EXTENSIONS:
                return jsonify(error="Solo se permiten archivos PDF, JPG, PNG, XLS y XLSX con nombres de hasta 150 caracteres."), 400
            content = upload.stream.read(MAX_FILE_SIZE + 1)
            if not content or len(content) > MAX_FILE_SIZE:
                return jsonify(error="Cada archivo debe tener contenido y pesar como máximo 10 MB."), 400
            files.append((name, content))
        connection = db()
        if draft_id is not None:
            row = connection.execute("SELECT id, category FROM drafts WHERE id = ? AND user_id = ?", (draft_id, session["user_id"])).fetchone()
            if row is None:
                return jsonify(error="No se encontró el borrador en tu cuenta."), 404
            if row["category"] != payload["category"]:
                return jsonify(error="No se puede cambiar la categoría de un borrador existente."), 400
            existing = {row["id"] for row in connection.execute("SELECT id FROM draft_files WHERE draft_id = ?", (draft_id,))}
            if not set(kept).issubset(existing):
                return jsonify(error="No se encontraron algunos archivos del borrador."), 400
            if review is None:
                previous = connection.execute("SELECT data FROM draft_reviews WHERE draft_id = ?", (draft_id,)).fetchone()
                if previous:
                    review = json.loads(previous["data"])
                    for entry in review["items"].values():
                        entry["file_ids"] = [file_id for file_id in entry["file_ids"] if file_id in kept]
        elif kept:
            return jsonify(error="No hay archivos guardados en este borrador."), 400
        with connection:
            if draft_id is None:
                cursor = connection.execute("INSERT INTO drafts (user_id, category, fields) VALUES (?, ?, ?)", (session["user_id"], payload["category"], json.dumps(fields, ensure_ascii=False)))
                draft_id = cursor.lastrowid
            else:
                connection.execute("UPDATE drafts SET category = ?, fields = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?", (payload["category"], json.dumps(fields, ensure_ascii=False), draft_id, session["user_id"]))
                for file_id in existing - set(kept):
                    connection.execute("DELETE FROM draft_files WHERE id = ? AND draft_id = ?", (file_id, draft_id))
            for name, content in files:
                connection.execute("INSERT INTO draft_files (draft_id, filename, content) VALUES (?, ?, ?)", (draft_id, name, content))
            if review is not None:
                connection.execute("INSERT INTO draft_reviews (draft_id, data) VALUES (?, ?) ON CONFLICT(draft_id) DO UPDATE SET data = excluded.data", (draft_id, json.dumps(review, ensure_ascii=False)))
        saved_files = connection.execute("SELECT id, filename, length(content) AS size FROM draft_files WHERE draft_id = ? ORDER BY id", (draft_id,)).fetchall()
        return jsonify(id=draft_id, files=[dict(row) for row in saved_files])

    @app.post("/api/drafts/<int:draft_id>/finalize")
    @login_required
    def finalize_draft(draft_id):
        check_csrf()
        connection = db()
        connection.execute("BEGIN IMMEDIATE")
        row = connection.execute(
            "SELECT d.category, d.fields, r.data AS review, cd.case_id FROM drafts d JOIN draft_reviews r ON r.draft_id = d.id LEFT JOIN case_drafts cd ON cd.draft_id = d.id WHERE d.id = ? AND d.user_id = ?",
            (draft_id, session["user_id"]),
        ).fetchone()
        if row is None:
            connection.rollback()
            return jsonify(error="No se encontró el análisis en tu cuenta."), 404
        fields = json.loads(row["fields"])
        review = json.loads(row["review"])
        calculation = review.get("calculation")
        if not isinstance(calculation, dict):
            connection.rollback()
            return jsonify(error="Completa el cálculo antes de guardar el caso."), 400
        try:
            def amount(name):
                value = fields.get(name, "")
                if not re.fullmatch(r"\d{1,12}(?:\.\d{1,2})?(?:[eE][+-]?\d{1,2})?", value):
                    raise ValueError("Monto inválido")
                number = Decimal(value)
                if not number.is_finite() or number < 0 or number > Decimal("1000000000") or number * 100 != (number * 100).to_integral_value():
                    raise ValueError("Monto fuera de rango")
                return number

            if row["category"] in {"Mermas", "Desmedros"}:
                quantity = amount("quantity")
                if not Decimal("0.01") <= quantity <= Decimal("1000000"):
                    raise ValueError("Cantidad fuera de rango")
                expense = int((quantity * amount("unit_cost") * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
            else:
                expense = int(amount("annual_expense" if row["category"] == "Depreciación" else "provision") * 100)
            raw_adjustment = calculation.get("non_admitted", "")
            if not isinstance(raw_adjustment, str) or not re.fullmatch(r"\d{1,16}(?:[.,]\d{1,2})?", raw_adjustment):
                raise ValueError("Falta el importe no admitido")
            adjustment = int(Decimal(raw_adjustment.replace(",", ".")) * 100)
            item = {"category": row["category"], "description": fields.get("subject", ""), "support": fields.get("cause", ""), "expense": expense, "deductible": expense - adjustment}
            if not valid_case(item) or not fields.get("company", "").strip() or not fields.get("date", "").strip():
                raise ValueError("Datos incompletos")
        except (ValueError, InvalidOperation, OverflowError):
            connection.rollback()
            return jsonify(error="Completa el registro y un importe no admitido válido. El gasto debe ser mayor que cero y no superar S/ 1,000,000,000."), 400
        if row["case_id"] is None:
            cursor = connection.execute(
                "INSERT INTO cases (user_id, category, description, support, expense, deductible, updated_at) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)",
                (session["user_id"], item["category"], item["description"].strip(), item["support"].strip(), item["expense"], item["deductible"]),
            )
            case_id = cursor.lastrowid
            connection.execute("INSERT INTO case_drafts (draft_id, case_id) VALUES (?, ?)", (draft_id, case_id))
        else:
            case_id = row["case_id"]
            connection.execute(
                "UPDATE cases SET description = ?, support = ?, expense = ?, deductible = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?",
                (item["description"].strip(), item["support"].strip(), item["expense"], item["deductible"], case_id, session["user_id"]),
            )
        connection.commit()
        return jsonify(id=case_id)

    @app.get("/api/drafts/<int:draft_id>/files/<int:file_id>")
    @login_required
    def draft_file(draft_id, file_id):
        row = db().execute("SELECT f.filename, f.content FROM draft_files f JOIN drafts d ON d.id = f.draft_id WHERE d.id = ? AND d.user_id = ? AND f.id = ?", (draft_id, session["user_id"], file_id)).fetchone()
        if row is None:
            return jsonify(error="No se encontró el archivo en tu cuenta."), 404
        response = send_file(BytesIO(row["content"]), mimetype="application/octet-stream", as_attachment=True, download_name=row["filename"])
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Cache-Control"] = "private, no-store"
        return response

    @app.delete("/api/drafts/<int:draft_id>")
    @login_required
    def delete_draft(draft_id):
        check_csrf()
        result = db().execute("DELETE FROM drafts WHERE id = ? AND user_id = ?", (draft_id, session["user_id"]))
        db().commit()
        if not result.rowcount:
            return jsonify(error="No se encontró el borrador en tu cuenta."), 404
        return jsonify(ok=True)

    @app.post("/api/cases")
    @login_required
    def add_case():
        check_csrf()
        item = request.get_json()
        if not valid_case(item):
            return jsonify(error="Revisa los datos y los importes del caso."), 400
        insert_case(item)
        db().commit()
        return jsonify(ok=True), 201

    @app.post("/api/cases/export")
    @login_required
    def export_cases():
        check_csrf()
        data = request.get_json(silent=True)
        if not isinstance(data, dict) or set(data) != {"case_ids"} or not isinstance(data["case_ids"], list):
            return jsonify(error="La selección para exportar no es válida."), 400
        ids = data["case_ids"]
        if not ids or any(type(case_id) is not int or case_id <= 0 for case_id in ids) or len(ids) != len(set(ids)):
            return jsonify(error="Selecciona casos válidos para exportar."), 400
        selected_ids = set(ids)
        items = [item for item in account_cases() if item["id"] in selected_ids]
        if len(items) != len(ids):
            return jsonify(error="La selección contiene casos que no están disponibles en tu cuenta."), 400

        def valid_xml_text(value):
            return all(char in "\t\n\r" or 0x20 <= ord(char) <= 0xD7FF or 0xE000 <= ord(char) <= 0xFFFD or 0x10000 <= ord(char) <= 0x10FFFF for char in value)

        if any(not valid_xml_text(item[key]) for item in items for key in ("description", "support", "draft_company")):
            return jsonify(error="Un caso contiene caracteres que Excel no admite. Edita el texto antes de exportar."), 400
        workbook = Workbook()
        sheet = workbook.active
        sheet.title = "Historial de casos"
        sheet.append(["Código", "Categoría", "Descripción", "Empresa del borrador actual", "Gasto (S/)", "Deducción considerada (S/)", "Reparo (S/)", "Deducción según importe", "Registro (UTC)", "Último guardado (UTC)", "Sustento"])
        for cell in sheet[1]:
            cell.font = Font(bold=True, color="FFFFFF")
            cell.fill = PatternFill("solid", fgColor="82164F")
        for item in items:
            status = "Nula" if item["deductible"] == 0 else "Total" if item["deductible"] == item["expense"] else "Parcial"
            sheet.append([f"CAS-{item['id']:03}", item["category"], item["description"], item["draft_company"], item["expense"] / 100, item["deductible"] / 100, (item["expense"] - item["deductible"]) / 100, status, item["created_at"], item["updated_at"] or "No disponible", item["support"]])
            for cell in sheet[sheet.max_row]:
                if isinstance(cell.value, str):
                    cell.data_type = "s"
                elif cell.column in (5, 6, 7):
                    cell.number_format = "#,##0.00"
        sheet.freeze_panes = "A2"
        sheet.auto_filter.ref = sheet.dimensions
        for column, width in {"A": 15, "B": 20, "C": 34, "D": 28, "E": 18, "F": 25, "G": 18, "H": 24, "I": 23, "J": 23, "K": 45}.items():
            sheet.column_dimensions[column].width = width
        output = BytesIO()
        workbook.save(output)
        output.seek(0)
        response = send_file(output, mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", as_attachment=True, download_name="historial-tribuanalisis.xlsx")
        response.headers["Cache-Control"] = "private, no-store"
        return response

    @app.delete("/api/cases/<int:case_id>")
    @login_required
    def delete_case(case_id):
        check_csrf()
        result = db().execute("DELETE FROM cases WHERE id = ? AND user_id = ?", (case_id, session["user_id"]))
        if not result.rowcount:
            db().rollback()
            return jsonify(error="No se encontró el caso en tu cuenta."), 404
        settings = db().execute("SELECT data FROM report_settings WHERE user_id = ?", (session["user_id"],)).fetchone()
        if settings:
            data = json.loads(settings["data"])
            data["case_ids"] = [selected_id for selected_id in data["case_ids"] if selected_id != case_id]
            db().execute("UPDATE report_settings SET data = ? WHERE user_id = ?", (json.dumps(data, ensure_ascii=False), session["user_id"]))
        db().commit()
        return jsonify(ok=True)

    @app.put("/api/profile")
    @login_required
    def profile():
        check_csrf()
        data = request.get_json()
        if not isinstance(data, dict):
            return jsonify(error="Datos de informe inválidos."), 400
        company, period = data.get("company"), data.get("period")
        if not isinstance(company, str) or len(company.strip()) > 100 or not isinstance(period, str) or (period and (not re.fullmatch(r"[0-9]{4}", period) or not 1900 <= int(period) <= 9999)):
            return jsonify(error="Revisa el nombre y el ejercicio tributario."), 400
        db().execute("UPDATE users SET company = ?, period = ? WHERE id = ?", (company.strip(), period, session["user_id"]))
        db().commit()
        return jsonify(ok=True)

    @app.post("/api/import")
    @login_required
    def import_previous():
        check_csrf()
        data = request.get_json()
        if not isinstance(data, dict) or not isinstance(data.get("cases"), list) or not 0 < len(data["cases"]) <= 500 or not all(valid_case(item) for item in data["cases"]):
            return jsonify(error="No se pudieron importar los casos: los datos anteriores no son válidos."), 400
        connection = db()
        # A write lock makes the one-time import check and insertion atomic.
        connection.execute("BEGIN IMMEDIATE")
        user = connection.execute("SELECT imported FROM users WHERE id = ?", (session["user_id"],)).fetchone()
        if user is None or user["imported"]:
            connection.rollback()
            return jsonify(error="Esta cuenta ya importó los datos anteriores."), 409
        for item in data["cases"]:
            insert_case(item)
        connection.execute("UPDATE users SET imported = 1 WHERE id = ?", (session["user_id"],))
        connection.commit()
        return jsonify(ok=True)

    return app



# Instancia de Flask para Vercel
app = create_app()

# Ejecución local
if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8012, debug=False)

