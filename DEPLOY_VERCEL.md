# Preparación del despliegue en Vercel

## Qué incluye este proyecto

- `wsgi.py` expone la aplicación Flask como `wsgi:app`.
- `pyproject.toml` declara el punto de entrada `wsgi:app`.
- `vercel.json` incluye las plantillas, hojas de estilo, scripts y recursos visuales necesarios.
- `requirements.txt` instala Flask, openpyxl y psycopg.
- En Vercel, la aplicación requiere PostgreSQL persistente. No usa SQLite ni `/tmp` como almacenamiento de producción.
- Las evidencias se guardan en PostgreSQL (`BYTEA`), junto con los datos de los borradores.

## Antes del primer despliegue

1. Crea una base PostgreSQL administrada (por ejemplo, Neon).
2. Copia la URL de conexión PostgreSQL del proveedor. Usa TLS según la indicación del proveedor (normalmente `sslmode=require`) y una conexión apropiada para funciones serverless.
3. En el proyecto Vercel, abre **Settings → Environment Variables** y configura:
   - `DATABASE_URL`: URL de conexión PostgreSQL completa.
   - `SESSION_SECRET`: valor aleatorio de al menos 32 caracteres.
4. Para generar el secreto en tu computadora:
   ```bash
   python -c "import secrets; print(secrets.token_hex(32))"
   ```
5. Marca las variables para **Production** y, si usarás despliegues de vista previa, configura también **Preview**. Es preferible usar una base de datos separada para Preview.
6. Importa el repositorio GitHub a Vercel usando la carpeta que contiene `app.py`, `wsgi.py` y `vercel.json` como Root Directory.
7. Framework Preset: Flask si Vercel lo detecta; de lo contrario, conserva la detección basada en `pyproject.toml`. No agregues un Build Command personalizado sin una necesidad concreta. Deja que Vercel instale `requirements.txt`.
8. Despliega. Los cambios de variables de entorno requieren un nuevo despliegue.

`SECRET_KEY` también se acepta como alias de `SESSION_SECRET` por compatibilidad, pero se recomienda usar solo `SESSION_SECRET`.

## Datos locales y seguridad

- Este paquete no incluye `.git`, `instance/`, archivos SQLite, claves de sesión ni cachés de Python.
- El ZIP original que entregaste no se modifica. Conserva ese original como respaldo privado.
- Las cuentas, casos y borradores guardados en la SQLite local no se copian automáticamente a PostgreSQL.
- Antes de usar la versión pública, prueba crear una cuenta de prueba, iniciar sesión, guardar un caso, crear un borrador, subir y descargar una evidencia y generar un informe.
- No compartas `DATABASE_URL`, `SESSION_SECRET` ni archivos `.env`.
