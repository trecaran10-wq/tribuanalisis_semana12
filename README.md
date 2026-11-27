# Tribuanálisis · Semana 12

Herramienta académica para elaborar un informe de reparos tributarios sobre mermas, desmedros, depreciación y cobranza dudosa en Perú.

## GitHub y Vercel

La aplicación utiliza SQLite en la computadora y PostgreSQL externo en Vercel. Las evidencias se cargan en fragmentos de 2 MB y las descargas grandes se transmiten progresivamente para respetar los límites de Vercel. No utiliza el disco temporal de Vercel para conservar datos.

Fuentes oficiales: [Flask en Vercel](https://vercel.com/docs/frameworks/backend/flask) y [límite de peticiones](https://vercel.com/docs/errors/function_payload_too_large).

### Preparar los archivos para GitHub

1. Crea preferiblemente un repositorio **privado**: el proyecto contiene nombres e imágenes proporcionadas para el equipo y la docente. Revisa que tengas permiso antes de publicar esos materiales.
2. Usa esta carpeta, `tribuanalisis_semana12`, como raíz del repositorio. Incluye los archivos de la aplicación, la carpeta `assets`, las pruebas y `.gitignore`.
3. No subas `instance`, entornos virtuales, archivos `.env`, bases de datos, claves ni copias de seguridad privadas. El ZIP de despliegue preparado excluye expresamente estos datos locales. `.gitignore` ayuda a excluirlos, pero no elimina archivos que ya estén seguidos por Git.
4. Antes de agregar o subir archivos, revisa `git status --short` y la lista de archivos preparados. No incluyas información privada o credenciales.
5. Sube el repositorio a GitHub e impórtalo en Vercel siguiendo la configuración siguiente. No guardes credenciales en el repositorio.

### Configurar Vercel

1. Crea una base PostgreSQL administrada con conexiones cifradas y consulta los precios, límites de almacenamiento, respaldos y políticas de privacidad del proveedor. Necesitas una base dedicada a esta aplicación y una cuenta que pueda crear tablas. Usa la dirección PostgreSQL indicada por el proveedor, preferiblemente la conexión con agrupador (*pooler*) y con TLS habilitado.
2. En Vercel, importa el repositorio, selecciona la carpeta del proyecto como raíz y el framework Flask. Antes del primer despliegue configura estas variables en **Settings → Environment Variables**:
   - `DATABASE_URL`: URL completa de PostgreSQL, incluida la configuración TLS requerida por el proveedor.
   - `SESSION_SECRET`: cadena aleatoria y privada de al menos 32 caracteres. También se acepta `SECRET_KEY` como alias de compatibilidad. Puedes generarla con `python -c "import secrets; print(secrets.token_hex(32))"` en tu computadora. No la publiques ni la compartas.
3. Configura las variables en el entorno que corresponda y despliega. Usa una base distinta para producción y para vistas previas; no compartas los datos reales con pruebas. Mantén la misma clave para todas las instancias de un mismo entorno: cambiarla cerrará las sesiones existentes.
4. Comprueba en el enlace de Vercel el registro e inicio de sesión, el guardado y la descarga de una evidencia, la edición de un caso y el informe. Consulta los registros de Vercel si hay errores. Las pruebas se ejecutaron con PostgreSQL local; la conexión a un servicio administrado y el despliegue público aún no se han probado.

Las cuentas, borradores y evidencias locales existentes **no se migran automáticamente** a PostgreSQL. Realiza una migración y copias de seguridad verificadas antes de usar datos existentes. Los archivos se guardan en la base de datos y consumen su cuota; una carga interrumpida puede conservar hasta cinco archivos temporales durante un máximo de 24 horas de validez y se elimina al iniciar otra carga de la misma cuenta. La aplicación es académica: no ofrece recuperación de contraseña ni protección completa frente a abuso, por lo que no debe tratarse como servicio empresarial para datos sensibles.

## Iniciar la aplicación

Desde PowerShell, en esta carpeta:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe app.py
```

Abre http://127.0.0.1:8012/ y crea una cuenta. En esta computadora también puedes usar el entorno existente `D:\TRIBUANALISIS_2U\.venv\Scripts\python.exe app.py`, si tiene Flask instalado. Deja el servidor funcionando mientras usas la aplicación. La dirección solo funciona en esta computadora; no es un enlace público.

El inicio de sesión y la creación de cuenta comparten la ilustración de fondo enviada para el proyecto. El formulario mantiene sus campos funcionales; el selector permite alternar entre ingresar y registrarse, y el botón junto a la contraseña permite mostrarla u ocultarla.

## Uso e historial

El menú incluye **Inicio / Dashboard**, **Nuevo análisis**, **Historial de casos**, **Mis casos**, **Informe de reparos** y **Perfil y créditos**. El inicio resume los casos guardados en la cuenta con importes y gráficos por categoría. La deducción es la ingresada por el usuario; la aplicación no evalúa el cumplimiento ni calcula ahorro del impuesto. Cada cuenta tiene su propio historial. Los casos se guardan al agregarlos y se pueden eliminar.

En **Nuevo análisis**, elige una de las cuatro categorías y completa el primer paso. **Continuar** guarda el borrador y abre la lista de verificación. En el segundo paso puedes marcar cada punto como pendiente, cumple o no cumple y relacionar los archivos guardados con él. El porcentaje solo resume tus marcas; no determina la deducibilidad.

El tercer paso calcula la deducción considerada como el gasto registrado menos el importe no admitido que ingresas tras tu revisión. No se asigna automáticamente ese importe: escribe 0 si no hay reparo. El monto de referencia es el costo estimado de las existencias, la depreciación contabilizada o la provisión contabilizada, según la categoría. Puedes ingresar una tasa para estimar la incidencia del reparo en el impuesto; sin tasa no se calcula, y esa estimación no es el impuesto definitivo. Si cambias el monto en el primer paso, debes ingresar de nuevo el importe no admitido.

El cuarto paso muestra el resumen y permite **Guardar caso** para añadirlo al informe y al historial. Puedes volver a editar el análisis; guarda de nuevo el caso para actualizar los importes registrados sin duplicarlo. El análisis detallado y sus evidencias permanecen en la sección de borradores. Eliminar el caso registrado conserva el borrador; eliminar el borrador borra sus evidencias pero conserva el caso registrado. **Generar informe PDF** abre la impresión del navegador: elige guardar como PDF. El PDF refleja los datos actuales del análisis, incluso si aún no has guardado el caso.

En **Historial de casos**, usa los filtros de código, descripción, empresa del borrador actual, categoría, deducción considerada y mes de registro (UTC). Los indicadores y gráficos corresponden a los casos filtrados; total, parcial y nula describen únicamente la relación entre los importes ingresados, no una calificación tributaria. La fecha de último guardado de casos anteriores a esta versión no está disponible hasta que se guarden de nuevo. Puedes abrir el informe, editar el análisis si conserva su borrador o eliminar el caso sin borrar el borrador. **Generar informe** selecciona los casos filtrados y **Exportar a Excel** descarga esos mismos casos, sin incluir archivos de evidencia. La empresa mostrada en el Excel procede del borrador actual y puede diferir del caso guardado.

Cada borrador admite hasta cinco archivos PDF, JPG, PNG, XLS o XLSX de 10 MB por archivo. Los archivos se descargan desde el borrador; para añadirlos o quitarlos, vuelve al registro del caso y guarda. Al quitar un archivo también se eliminan sus asociaciones con los puntos de revisión. La aplicación no verifica el contenido de las evidencias.

Para registrar un caso terminado mientras se desarrollan los demás pasos, selecciona **Usar registro rápido anterior**. El importe deducible se ingresa después de la revisión del usuario; la aplicación calcula el reparo como gasto menos deducción. Los borradores no se incluyen en los indicadores ni en el informe hasta que exista un caso registrado.

En **Informe de reparos**, selecciona los casos que quieras incluir; la vista previa y los totales se actualizan con esa selección. Al abrir un caso desde el historial se selecciona únicamente ese caso. Elige informe completo, ejecutivo (resumen) o técnico (incluye la revisión actual del borrador si está disponible), y marca las secciones que deseas. **Guardar configuración** conserva la selección y las opciones en tu cuenta; los casos nuevos deben seleccionarse si ya guardaste una selección. Los datos de empresa y ejercicio se guardan por separado con **Guardar datos de empresa y ejercicio**. **Generar informe PDF** abre la impresión del navegador; selecciona guardar como PDF. La incidencia del impuesto no se consolida porque no se guarda en el caso registrado.

La opción de evidencias incluye sus nombres y enlaces de descarga, no inserta los archivos en el PDF. La revisión técnica y la relación de evidencias muestran el estado actual del borrador, que puede diferir del caso guardado; los enlaces funcionan mientras la aplicación esté disponible y la sesión iniciada. No se verifican automáticamente los requisitos ni los archivos.

En **Guía tributaria** puedes cambiar entre las cuatro categorías para consultar definiciones, puntos de revisión, documentación y fuentes oficiales. Desde un análisis, los enlaces de normativa abren la guía en la categoría del caso sin borrar los cambios del formulario. Los enlaces a la ley y al reglamento indican la página del PDF oficial que contiene el artículo citado; el salto automático depende del visor de PDF. Verifica la vigencia de las normas para el ejercicio del caso.

En **Perfil y créditos** se muestran los integrantes, la docente y la institución del proyecto. Las ilustraciones del equipo son decorativas y el retrato de la docente se basa en la fotografía proporcionada. **Editar perfil** guarda el nombre de la cuenta actual, sin modificar el correo ni los datos del informe. Las fechas se muestran en UTC; las cuentas antiguas no tienen fecha de registro y la última conexión se registra desde esta actualización. El código se descarga como ZIP sin la base de datos, la clave ni las evidencias. El manual y los créditos se pueden guardar como PDF desde la impresión del navegador. Las fuentes oficiales de SUNAT están en la **Guía tributaria**. El acceso **Plantilla Excel** descarga una hoja para organizar los datos; la aplicación no importa los datos de esa plantilla.

Si hay casos de la versión anterior guardados en el mismo navegador y la misma dirección, aparece la opción de importarlos una vez a tu cuenta. Solo importa datos que te pertenezcan. La importación copia los casos, no los datos de empresa o ejercicio, y no borra el respaldo anterior del navegador. Los datos de `file://` y de `http://127.0.0.1:8012/` son independientes.

En uso local, las cuentas, los casos, los borradores y sus evidencias se guardan en `instance\semana12.db`; en Vercel se guardan en PostgreSQL. Las contraseñas se almacenan como hashes y los archivos no están cifrados por la aplicación. Eliminar un borrador elimina también sus evidencias. Conserva copias de seguridad seguras de la carpeta `instance` para uso local y de PostgreSQL para Vercel. No publiques las bases de datos ni las claves.

## Alcance

La aplicación no determina si un gasto cumple los requisitos tributarios: el usuario debe revisar la normativa vigente y la documentación antes de ingresar el importe deducible. El reparo mostrado es una diferencia de gastos y no el impuesto a pagar. El informe es orientativo y no reemplaza asesoría profesional.
