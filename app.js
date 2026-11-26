"use strict";

const storageKey = "tribuanalisis-semana12-v1";
const $ = (id) => document.getElementById(id);
const form = $("case-form");
const currency = new Intl.NumberFormat("es-PE", { style: "currency", currency: "PEN", minimumFractionDigits: 2 });
const csrf = document.querySelector('meta[name="csrf-token"]').content;
let cases = [];
let selectedReportIds = null;
let reportRenderVersion = 0;
let historyFilters = { query: "", category: "", status: "", month: "" };

function showView() {
  const views = ["inicio", "informe", "historial", "mis-casos", "registro", "guia", "perfil"];
  const view = views.includes(location.hash.slice(1)) ? location.hash.slice(1) : "inicio";
  document.querySelectorAll(".app-view").forEach((section) => {
    section.hidden = section.id !== view;
  });
  document.querySelectorAll("[data-view]").forEach((link) => {
    if (link.dataset.view === view) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
}

window.addEventListener("hashchange", showView);
showView();

function money(cents) {
  return currency.format(cents / 100);
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { ...(options.body instanceof FormData ? {} : { "Content-Type": "application/json" }), "X-CSRF-Token": csrf, ...options.headers }
  });
  if (response.status === 401 || response.status === 403) {
    throw new Error("La sesión terminó o cambió. Recarga la página e inicia sesión nuevamente.");
  }
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(data?.error || "No se pudo completar la operación. Inténtalo nuevamente.");
  }
  return response.json();
}

async function load() {
  const data = await api("/api/state");
  cases = data.cases;
  $("account-email").textContent = data.email;
  $("profile-email").textContent = data.email;
  updateAccountName(data.display_name);
  $("profile-registered").textContent = accountDate(data.registered_at);
  $("profile-login").textContent = accountDate(data.last_login);
  $("company").value = data.company;
  $("period").value = data.period;
  if (data.report_settings) {
    selectedReportIds = new Set(data.report_settings.case_ids);
    document.querySelector(`input[name="report-type"][value="${data.report_settings.type}"]`).checked = true;
    document.querySelectorAll("[data-report-section]").forEach((input) => {
      input.checked = data.report_settings.sections[input.dataset.reportSection];
    });
  }
  render();
  await loadDrafts();
  try {
    const previous = localStorage.getItem(storageKey);
    const oldData = previous ? JSON.parse(previous) : null;
    $("import-notice").hidden = data.imported || !Array.isArray(oldData?.cases) || oldData.cases.length === 0;
  } catch (error) {
    console.error("No se pudieron leer los datos anteriores del navegador:", error);
    alert("No se pudieron leer los datos anteriores del navegador.");
  }
}

function totals(items = cases) {
  return items.reduce((sum, item) => {
    sum.expense += item.expense;
    sum.deductible += item.deductible;
    return sum;
  }, { expense: 0, deductible: 0 });
}

function makeElement(tag, text, className) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
}

function updateAccountName(name) {
  $("profile-name").textContent = name || "Sin nombre registrado";
  $("account-name-input").value = name || "";
  const initials = name ? name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase() : "U";
  $("profile-initials").textContent = initials;
  $("header-initials").textContent = initials;
}

function accountDate(value) {
  if (!value) return "No disponible";
  const date = new Date(value.replace(" ", "T") + "Z");
  return new Intl.DateTimeFormat("es-PE", { dateStyle: "short", timeStyle: "short", timeZone: "UTC" }).format(date) + " UTC";
}

$("edit-account").addEventListener("click", () => {
  $("account-form").hidden = false;
  $("edit-account").hidden = true;
  $("account-message").textContent = "";
  $("account-name-input").focus();
});
$("cancel-account").addEventListener("click", () => {
  $("account-form").hidden = true;
  $("edit-account").hidden = false;
  $("account-message").textContent = "";
});
$("account-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = $("account-form").querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    const result = await api("/api/account-name", { method: "PUT", body: JSON.stringify({ name: $("account-name-input").value }) });
    updateAccountName(result.name);
    $("account-form").hidden = true;
    $("edit-account").hidden = false;
  } catch (error) {
    $("account-message").textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

function printProfileDocument(title, sections) {
  const report = $("print-view");
  report.replaceChildren(makeElement("h1", title));
  sections.forEach(([heading, content]) => report.append(makeElement("h2", heading), makeElement("p", content)));
  report.append(makeElement("p", "Para guardar este documento como PDF, elige «Guardar como PDF» en la ventana de impresión.", "report-note"));
  window.print();
}
$("print-manual").addEventListener("click", () => printProfileDocument("Manual de usuario · Tribuanálisis", [
  ["Acceso", "Crea una cuenta o inicia sesión. La información se guarda en esta computadora."],
  ["Nuevo análisis", "Selecciona un concepto, registra los datos y adjunta las evidencias. Guarda el borrador y continúa con la revisión de requisitos."],
  ["Cálculo y resultado", "Ingresa el importe no admitido tras tu revisión. La aplicación calcula el reparo; guarda el caso para incluirlo en el historial y en el informe."],
  ["Historial e informe", "Filtra los casos en el historial o expórtalos a Excel. En Informe de reparos selecciona los casos y las secciones, y genera el PDF mediante la impresión del navegador."],
  ["Guía tributaria", "Consulta las categorías y los enlaces oficiales. Verifica la normativa vigente para cada ejercicio."],
  ["Alcance", "La aplicación es académica y no determina automáticamente la deducibilidad ni sustituye la revisión profesional."]
]));
$("print-credits").addEventListener("click", () => printProfileDocument("Créditos · Tribuanálisis", [
  ["Proyecto", "Tribuanálisis – Semana 12 · Tributación II · UNIVERSIDAD NACIONAL DE TRUJILLO - FILIAL VALLE JEQUETEPEQUE."],
  ["Docente", "CPC. Marlene Lourdes Altamirano."],
  ["Integrantes", "Chavarrea Tanta Liz Rosmery; Portales Pairazaman Noemi Araceli; Ramos Novoa María Roxana; Terán Cabanillas Treisy Josseph; Vásquez Tarrillo Rut; Vidaurre Rojas Melany Laylin."],
  ["Sistema", "Equipo Tribuanálisis – Semana 12. Tecnologías: Python (Flask), SQLite, HTML, CSS y JavaScript."]
]));

const concepts = [
  { name: "Mermas", color: "#802151" },
  { name: "Desmedros", color: "#dc6b9b" },
  { name: "Depreciación", color: "#c27cb9" },
  { name: "Cobranza dudosa", color: "#f0b5d4" }
];

function renderHome() {
  const sum = totals();
  $("home-count").textContent = cases.length;
  $("home-deductible").textContent = money(sum.deductible);
  $("home-adjustment").textContent = money(sum.expense - sum.deductible);
  $("donut-count").textContent = cases.length;
  const groups = concepts.map((concept) => {
    const items = cases.filter((item) => item.category === concept.name);
    const groupSum = totals(items);
    return { ...concept, count: items.length, deductible: groupSum.deductible, adjustment: groupSum.expense - groupSum.deductible };
  });
  const legend = $("distribution-legend");
  legend.replaceChildren();
  let offset = 0;
  const segments = [];
  groups.forEach((group) => {
    const percentage = cases.length ? group.count / cases.length * 100 : 0;
    if (group.count) {
      segments.push(`${group.color} ${offset}% ${offset + percentage}%`);
      offset += percentage;
    }
    const row = makeElement("div", undefined, "legend-row");
    const dot = makeElement("span", undefined, "legend-dot");
    dot.style.backgroundColor = group.color;
    row.append(dot, makeElement("span", `${group.name} (${group.count} ${group.count === 1 ? "caso" : "casos"})`), makeElement("b", `${Math.round(percentage)}%`));
    legend.append(row);
  });
  $("home-donut").style.background = segments.length ? `conic-gradient(${segments.join(",")})` : "#eee3e9";
  $("home-donut").setAttribute("aria-label", cases.length ? `Distribución de ${cases.length} casos por concepto; detalle en la leyenda` : "Sin casos registrados");
  renderAmountChart(groups);
  const recent = $("home-recent");
  recent.replaceChildren();
  $("home-recent-empty").hidden = cases.length > 0;
  cases.slice(0, 4).forEach((item) => {
    const row = makeElement("tr");
    const code = makeElement("td");
    const button = makeElement("button", `CAS-${String(item.id).padStart(3, "0")}`, "recent-link");
    button.type = "button";
    button.setAttribute("aria-label", `Ver informe: ${item.description}`);
    button.addEventListener("click", () => {
      selectedReportIds = new Set([item.id]);
      render();
      location.hash = "informe";
    });
    code.append(button);
    row.append(code);
    [item.category, item.description, money(item.deductible), money(item.expense - item.deductible), `${item.created_at.slice(0, 10)} (UTC)`].forEach((value) => row.append(makeElement("td", value)));
    const status = makeElement("td");
    status.append(makeElement("span", "Registrado", "registered-badge"));
    row.append(status);
    recent.append(row);
  });
}

function renderAmountChart(groups) {
  const chart = $("amount-chart");
  if (!cases.length) {
    chart.replaceChildren(makeElement("p", "Registra un caso para visualizar los montos.", "chart-empty"));
    return;
  }
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 420 150");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", groups.map((group) => `${group.name}: deducción ${money(group.deductible)}, reparo ${money(group.adjustment)}`).join("; "));
  const draw = (tag, attrs, text) => {
    const node = document.createElementNS(ns, tag);
    Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, value));
    if (text !== undefined) node.textContent = text;
    svg.append(node);
    return node;
  };
  const max = Math.max(1, ...groups.flatMap((group) => [group.deductible, group.adjustment]));
  for (let i = 0; i <= 4; i++) {
    const y = 12 + i * 25;
    draw("line", { x1: 56, y1: y, x2: 410, y2: y, class: "chart-gridline" });
    draw("text", { x: 52, y: y + 3, "text-anchor": "end", class: "chart-axis" }, new Intl.NumberFormat("es-PE", { maximumFractionDigits: 2 }).format((max * (4 - i) / 4) / 100));
  }
  const points = [];
  groups.forEach((group, index) => {
    const x = 95 + index * 86;
    const barHeight = group.deductible / max * 100;
    const lineY = 112 - group.adjustment / max * 100;
    draw("rect", { x: x - 17, y: 112 - barHeight, width: 34, height: barHeight, class: "chart-bar" });
    points.push(`${x},${lineY}`);
    const label = group.name === "Cobranza dudosa" ? ["Cobranza", "dudosa"] : [group.name];
    label.forEach((part, line) => draw("text", { x, y: 128 + line * 10, "text-anchor": "middle", class: "chart-label" }, part));
  });
  draw("polyline", { points: points.join(" "), class: "chart-line" });
  points.forEach((point) => {
    const [cx, cy] = point.split(",");
    draw("circle", { cx, cy, r: 3.5, class: "chart-point" });
  });
  chart.replaceChildren(svg);
}

function render() {
  if (selectedReportIds !== null) {
    const ids = new Set(cases.map((item) => item.id));
    selectedReportIds = new Set([...selectedReportIds].filter((id) => ids.has(id)));
  }
  const shown = selectedCases();
  const sum = totals(shown);
  $("case-count").textContent = shown.length;
  $("total-deductible").textContent = money(sum.deductible);
  $("total-adjustment").textContent = money(sum.expense - sum.deductible);
  $("my-cases-empty").hidden = cases.length > 0;
  renderReportSelection();
  renderReportPreview();
  renderHome();
  renderHistory();
  [$("my-case-list")].forEach((list) => {
    list.replaceChildren();
    cases.forEach((item) => {
    const card = makeElement("article", undefined, "case");
    const top = makeElement("div", undefined, "case-top");
    const remove = makeElement("button", "Eliminar", "delete-button");
    remove.type = "button";
    remove.setAttribute("aria-label", `Eliminar caso: ${item.description}`);
    remove.addEventListener("click", () => removeCase(item, remove));
    const actions = makeElement("div", undefined, "case-actions");
    if (item.draft_id) {
      const edit = makeElement("button", "Editar análisis", "text-action");
      edit.type = "button";
      edit.addEventListener("click", () => editCase(item));
      actions.append(edit);
    }
    const view = makeElement("button", "Ver informe", "text-action");
    view.type = "button";
    view.setAttribute("aria-label", `Ver informe: ${item.description}`);
    view.addEventListener("click", () => {
      selectedReportIds = new Set([item.id]);
      render();
      location.hash = "informe";
    });
    actions.append(view, remove);
    top.append(makeElement("span", item.category, "case-tag"), actions);
    const amounts = makeElement("div", undefined, "case-amounts");
    [["Gasto", item.expense], ["Deducible", item.deductible], ["Reparo", item.expense - item.deductible]].forEach(([label, amount]) => {
      const wrapper = makeElement("span", label);
      wrapper.append(makeElement("strong", money(amount)));
      amounts.append(wrapper);
    });
    const date = makeElement("div", `Registrado: ${item.created_at} (UTC)`, "case-date");
    card.append(top, makeElement("h4", item.description), makeElement("p", item.support), amounts, date);
      list.append(card);
    });
  });
}

async function removeCase(item, button) {
  if (!confirm("¿Deseas eliminar este caso del informe? El borrador y sus evidencias se conservarán.")) return;
  button.disabled = true;
  try {
    await api(`/api/cases/${item.id}`, { method: "DELETE" });
    cases = cases.filter((entry) => entry.id !== item.id);
    if (item.id === linkedCaseId) linkedCaseId = null;
    render();
    await loadDrafts();
  } catch (error) {
    alert(error.message);
    button.disabled = false;
  }
}

async function editCase(item) {
  if (!confirmDiscard()) return;
  try {
    openDraft(await api(`/api/drafts/${item.draft_id}`));
  } catch (error) {
    alert(error.message);
  }
}

function historyStatus(item) {
  if (item.deductible === 0) return "none";
  return item.deductible === item.expense ? "full" : "partial";
}

function historyCases() {
  const query = historyFilters.query.toLocaleLowerCase("es");
  return cases.filter((item) => {
    const text = `CAS-${String(item.id).padStart(3, "0")} ${item.description} ${item.draft_company}`.toLocaleLowerCase("es");
    return (!query || text.includes(query))
      && (!historyFilters.category || item.category === historyFilters.category)
      && (!historyFilters.status || historyStatus(item) === historyFilters.status)
      && (!historyFilters.month || item.created_at.slice(0, 7) === historyFilters.month);
  });
}

function renderHistory() {
  const shown = historyCases();
  const labels = { full: "Total", partial: "Parcial", none: "Nula" };
  const counts = { full: 0, partial: 0, none: 0 };
  shown.forEach((item) => { counts[historyStatus(item)]++; });
  $("history-count").textContent = shown.length;
  Object.entries(counts).forEach(([key, count]) => { $(`history-${key}`).textContent = count; });
  const latest = shown.map((item) => item.updated_at).filter(Boolean).sort().at(-1);
  $("history-updated").textContent = latest ? latest.slice(0, 16) : "No disponible";
  $("empty-state").hidden = shown.length > 0;
  $("history-empty-text").textContent = cases.length ? "No hay casos que coincidan con los filtros." : "Aún no hay casos registrados.";
  $("history-report").disabled = shown.length === 0;
  $("history-export").disabled = shown.length === 0;
  const list = $("case-list");
  list.replaceChildren();
  shown.forEach((item, index) => {
    const row = makeElement("tr");
    const status = historyStatus(item);
    [String(index + 1), `CAS-${String(item.id).padStart(3, "0")}`, item.category, item.description, money(item.expense), money(item.deductible), money(item.expense - item.deductible), item.created_at.slice(0, 10)].forEach((value) => row.append(makeElement("td", value)));
    const statusCell = makeElement("td");
    statusCell.append(makeElement("span", labels[status], `history-status ${status}`));
    row.append(statusCell);
    const actions = makeElement("td", undefined, "history-row-actions");
    const view = makeElement("button", "◉");
    view.type = "button";
    view.title = "Ver informe";
    view.setAttribute("aria-label", `Ver informe: ${item.description}`);
    view.addEventListener("click", () => { selectedReportIds = new Set([item.id]); render(); location.hash = "informe"; });
    const edit = makeElement("button", "✎");
    edit.type = "button";
    edit.title = item.draft_id ? "Editar análisis" : "Sin borrador vinculado";
    edit.setAttribute("aria-label", `Editar análisis: ${item.description}`);
    edit.disabled = !item.draft_id;
    edit.addEventListener("click", () => editCase(item));
    const remove = makeElement("button", "⌫");
    remove.type = "button";
    remove.title = "Eliminar caso";
    remove.setAttribute("aria-label", `Eliminar caso: ${item.description}`);
    remove.addEventListener("click", () => removeCase(item, remove));
    actions.append(view, edit, remove);
    row.append(actions);
    list.append(row);
  });
  const groups = concepts.map((concept) => ({ ...concept, count: shown.filter((item) => item.category === concept.name).length }));
  let offset = 0;
  const segments = [];
  const legend = $("history-legend");
  legend.replaceChildren();
  groups.forEach((group) => {
    const percent = shown.length ? group.count / shown.length * 100 : 0;
    if (group.count) {
      segments.push(`${group.color} ${offset}% ${offset + percent}%`);
      offset += percent;
    }
    const row = makeElement("div", undefined, "history-legend-row");
    const dot = makeElement("span", undefined, "legend-dot");
    dot.style.backgroundColor = group.color;
    row.append(dot, makeElement("span", `${group.name} (${group.count})`), makeElement("b", `${Math.round(percent)}%`));
    legend.append(row);
  });
  $("history-donut").style.background = segments.length ? `conic-gradient(${segments.join(",")})` : "#eee3e9";
  $("history-donut").setAttribute("aria-label", shown.length ? `Distribución de ${shown.length} casos; detalle en la leyenda` : "Sin casos para mostrar");
  $("history-donut-count").textContent = shown.length;
  const chart = $("history-chart");
  chart.replaceChildren();
  chart.setAttribute("aria-label", Object.entries(counts).map(([key, count]) => `${labels[key]}: ${count}`).join("; "));
  const maximum = Math.max(1, ...Object.values(counts));
  Object.entries(counts).forEach(([key, count]) => {
    const column = makeElement("div", undefined, "history-chart-column");
    const track = makeElement("div", undefined, "history-chart-track");
    const bar = makeElement("span", undefined, `history-chart-bar ${key}`);
    bar.style.height = `${count / maximum * 100}%`;
    track.append(bar);
    column.append(makeElement("strong", String(count)), track, makeElement("span", labels[key]));
    chart.append(column);
  });
}

$("history-filters").addEventListener("submit", (event) => {
  event.preventDefault();
  historyFilters = { query: $("history-query").value.trim(), category: $("history-category").value, status: $("history-status").value, month: $("history-month").value };
  $("history-export-message").textContent = "";
  renderHistory();
});
$("history-clear").addEventListener("click", () => {
  $("history-filters").reset();
  historyFilters = { query: "", category: "", status: "", month: "" };
  $("history-export-message").textContent = "";
  renderHistory();
});
$("history-report").addEventListener("click", () => {
  selectedReportIds = new Set(historyCases().map((item) => item.id));
  render();
  location.hash = "informe";
});
$("history-export").addEventListener("click", async () => {
  const button = $("history-export");
  button.disabled = true;
  $("history-export-message").textContent = "";
  try {
    const response = await fetch("/api/cases/export", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
      body: JSON.stringify({ case_ids: historyCases().map((item) => item.id) })
    });
    if (response.status === 401 || response.status === 403) throw new Error("La sesión terminó o cambió. Recarga la página e inicia sesión nuevamente.");
    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || "No se pudo exportar el historial.");
    }
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement("a");
    link.href = url;
    link.download = "historial-tribuanalisis.xlsx";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    $("history-export-message").textContent = "Excel generado con los casos filtrados.";
  } catch (error) {
    $("history-export-message").textContent = `No se pudo exportar: ${error.message}`;
  } finally {
    button.disabled = historyCases().length === 0;
  }
});

function selectedCases() {
  return selectedReportIds === null ? cases : cases.filter((item) => selectedReportIds.has(item.id));
}

$("notice-link").addEventListener("click", (event) => {
  event.preventDefault();
  location.hash = "inicio";
  showView();
  $("cumplimiento").focus();
});

function showCategories() {
  $("analysis-selection").hidden = false;
  $("analysis-entry").hidden = true;
}

document.querySelectorAll('a[href="#registro"]').forEach((link) => {
  link.addEventListener("click", () => {
    if (location.hash !== "#guia" || $("analysis-entry").hidden) showCategories();
  });
});

document.querySelectorAll("[data-category]").forEach((button) => {
  button.setAttribute("aria-label", `Analizar caso de ${button.dataset.category}`);
  button.addEventListener("click", () => {
    if (!confirmDiscard()) return;
    openDraft({ category: button.dataset.category, fields: {}, files: [], id: null });
  });
});

$("back-to-categories").addEventListener("click", () => {
  if (draftStep === 4) {
    setWizardStep(3);
    draftDirty = true;
    $("entry-title").focus();
    return;
  }
  if (draftStep === 3) {
    if (!validateCalculation()) return;
    setWizardStep(2);
    draftDirty = true;
    $("entry-title").focus();
    return;
  }
  if (draftStep === 2) {
    setWizardStep(1);
    draftDirty = true;
    $("entry-title").focus();
    return;
  }
  if (!confirmDiscard()) return;
  clearDraft();
  showCategories();
  $("register-title").focus();
});

const wizardForm = $("wizard-form");
const categoryDetails = {
  "Mermas": { image: "mermas.png", group: "stock", subject: "Producto o existencia", cause: "Causa de la merma", law: ["Ley del Impuesto a la Renta: artículo 37, inciso f).", "Reglamento: artículo 21, inciso c)."] },
  "Desmedros": { image: "desmedros.png", group: "stock", subject: "Producto o existencia", cause: "Descripción del deterioro", law: ["Ley del Impuesto a la Renta: artículo 37, inciso f).", "Reglamento: artículo 21, inciso c)."] },
  "Depreciación": { image: "depreciacion.png", group: "asset", subject: "Activo", cause: "Descripción del activo y su uso", law: ["Ley del Impuesto a la Renta: normas sobre depreciación.", "Reglamento: artículo 22."] },
  "Cobranza dudosa": { image: "cobranza.png", group: "debt", subject: "Cliente o cuenta por cobrar", cause: "Descripción de la deuda y gestiones de cobro", law: ["Ley del Impuesto a la Renta: artículo 37, inciso i).", "Reglamento: artículo 21, inciso f)."] }
};
const reviewPoints = {
  "Mermas": [
    ["nature", "La pérdida física de existencias es inherente a su naturaleza o al proceso productivo; revisa el supuesto aplicable."],
    ["report", "Cuando SUNAT lo requiera, se acredita con informe técnico del profesional u organismo competente previsto en la norma."],
    ["method", "El informe técnico indica la metodología y las pruebas realizadas."],
    ["expense", "Revisa el sustento del gasto y su correspondencia con el ejercicio."],
    ["records", "Revisa la consistencia con inventarios y registros del proceso."]
  ],
  "Desmedros": [
    ["condition", "Revisa el deterioro o pérdida de calidad de las existencias y su documentación."],
    ["proof", "Verifica la acreditación del desmedro mediante el procedimiento o medio admitido aplicable."],
    ["notice", "Revisa la comunicación previa a SUNAT y el plazo aplicable a la destrucción."],
    ["document", "Verifica el acta o constancia de destrucción, o el informe cuando corresponda, y su presentación."],
    ["records", "Revisa el costo y la consistencia con los inventarios y registros contables."]
  ],
  "Depreciación": [
    ["asset", "Identifica el activo y revisa su vinculación con la producción de rentas gravadas."],
    ["start", "Verifica desde cuándo procede la depreciación y el período del gasto."],
    ["rate", "Revisa el porcentaje tributario aplicable al tipo de bien y las reglas especiales."],
    ["accounting", "Revisa la depreciación contabilizada y las excepciones aplicables al caso."],
    ["register", "Verifica el control y la información del activo en los registros correspondientes."]
  ],
  "Cobranza dudosa": [
    ["debt", "Identifica la deuda y verifica su vencimiento y sustento."],
    ["risk", "Revisa la acreditación de las dificultades financieras o de los supuestos de incobrabilidad previstos en la norma."],
    ["provision", "Verifica la provisión y su discriminación al cierre del ejercicio conforme a la norma."],
    ["exclusions", "Revisa si existen supuestos excluidos, como vinculación, garantías o renovación de deuda."],
    ["records", "Revisa la documentación de la deuda y las gestiones de cobranza disponibles."]
  ]
};
let draftId = null;
let draftCategory = null;
let savedFiles = [];
let newFiles = [];
let draftDirty = false;
let savingDraft = false;
let draftStep = 1;
let reviewItems = {};
let calculation = { non_admitted: "", tax_rate: "" };
let linkedCaseId = null;

const guideLaw = "https://www.sunat.gob.pe/legislacion/renta/ley/capvi.pdf";
const guideRegulation = "https://www.sunat.gob.pe/legislacion/renta/regla/cap6.pdf";
const guideData = {
  "Mermas": {
    definition: "Pérdida física, en el volumen, peso o cantidad de las existencias, ocasionada por causas inherentes a su naturaleza o al proceso productivo.",
    requirements: ["Identifica la pérdida física y su relación con la naturaleza del bien o el proceso productivo.", "Cuando SUNAT lo requiera, acredita la merma con el informe técnico previsto en el reglamento.", "El informe debe indicar la metodología empleada y las pruebas realizadas.", "Revisa el importe, el ejercicio y la documentación contable del caso."],
    documents: ["Informe técnico del profesional u organismo competente, cuando corresponda.", "Registros de producción, inventarios y control de calidad.", "Mediciones, metodología y pruebas de la pérdida."],
    laws: [["Ley del Impuesto a la Renta", "Art. 37, inciso f) · página 7", `${guideLaw}#page=7`], ["Reglamento de la LIR", "Art. 21, inciso c) · página 4", `${guideRegulation}#page=4`]],
    resources: [["Informe SUNAT N.° 000094-2023", "Criterio sobre pérdidas de comercialización", "https://www.sunat.gob.pe/legislacion/oficios/2023/informe-oficios/i000094-2023-7T0000.pdf"]]
  },
  "Desmedros": {
    definition: "Pérdida de orden cualitativo e irrecuperable de las existencias, que las hace inutilizables para los fines a los que estaban destinadas.",
    requirements: ["Identifica el deterioro y el costo de las existencias.", "Revisa la acreditación de la destrucción y la comunicación previa a SUNAT.", "Verifica cuándo corresponde la presencia de notario o juez de paz, o el informe de destrucción.", "Comprueba los plazos, la presentación del informe y las reglas aplicables al ejercicio."],
    documents: ["Inventario y costo de los bienes deteriorados.", "Comunicación previa y constancia de presentación a SUNAT.", "Acta o informe de destrucción y sustento técnico, según corresponda."],
    laws: [["Ley del Impuesto a la Renta", "Art. 37, inciso f) · página 7", `${guideLaw}#page=7`], ["Reglamento de la LIR", "Art. 21, inciso c) · páginas 4–5", `${guideRegulation}#page=4`]],
    resources: [["Informe SUNAT N.° 000095-2023", "Devengo y acreditación de desmedros", "https://www.sunat.gob.pe/legislacion/oficios/2023/informe-oficios/i000095-2023-7T0000.pdf"]]
  },
  "Depreciación": {
    definition: "Reconocimiento del desgaste o agotamiento de bienes del activo fijo utilizados en actividades productoras de renta, conforme a las reglas tributarias.",
    requirements: ["Identifica el bien y su uso en la producción de rentas gravadas.", "Verifica el inicio de la depreciación y el ejercicio correspondiente.", "Aplica el porcentaje y las reglas que correspondan al tipo de bien.", "Revisa la depreciación contabilizada y las excepciones previstas en la norma."],
    documents: ["Comprobantes de adquisición y costo del activo.", "Registro de activos fijos y depreciación contabilizada.", "Sustento de la fecha de uso y cálculo de la depreciación."],
    laws: [["Ley del Impuesto a la Renta", "Arts. 38, 39 y 40 · página 12", `${guideLaw}#page=12`], ["Reglamento de la LIR", "Art. 22 · página 25", `${guideRegulation}#page=25`]],
    resources: []
  },
  "Cobranza dudosa": {
    definition: "Cuentas por cobrar respecto de las cuales se evalúa el riesgo de incobrabilidad y, de corresponder, la provisión o castigo tributario.",
    requirements: ["Identifica las cuentas y verifica las condiciones de incobrabilidad al efectuar la provisión.", "Sustenta el riesgo de incobrabilidad según los supuestos del reglamento.", "Revisa la discriminación de la provisión al cierre y su correspondencia con la deuda.", "Verifica las exclusiones y las reglas específicas para el castigo, si corresponde."],
    documents: ["Comprobantes y detalle de las cuentas por cobrar.", "Gestiones de cobro u otra evidencia prevista en el reglamento.", "Registro de la provisión y documentación del castigo, si corresponde."],
    laws: [["Ley del Impuesto a la Renta", "Art. 37, inciso i) · página 7", `${guideLaw}#page=7`], ["Reglamento de la LIR", "Art. 21, inciso f): provisión · página 6", `${guideRegulation}#page=6`], ["Reglamento de la LIR", "Art. 21, inciso g): castigo · página 7", `${guideRegulation}#page=7`]],
    resources: []
  }
};

function renderGuideLinks(id, links) {
  $(id).replaceChildren(...links.map(([title, detail, href]) => {
    const link = makeElement("a", undefined, "guide-source");
    link.href = href;
    if (href.startsWith("https://")) {
      link.target = "_blank";
      link.rel = "noopener noreferrer";
    } else {
      link.download = "";
    }
    const icon = makeElement("span", "▤", "guide-source-icon");
    const text = makeElement("span");
    text.append(makeElement("b", title), makeElement("small", detail));
    link.append(icon, text, makeElement("span", "↗", "guide-source-arrow"));
    return link;
  }));
}

function selectGuideCategory(category) {
  const data = guideData[category];
  if (!data) return;
  document.querySelectorAll("[data-guide-category]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.guideCategory === category));
  });
  $("guide-category-title").textContent = category;
  $("guide-definition").textContent = data.definition;
  $("guide-category-image").src = `/assets/${categoryDetails[category].image}`;
  $("guide-requirements").replaceChildren(...data.requirements.map((item) => makeElement("li", item)));
  $("guide-documents").replaceChildren(...data.documents.map((item) => makeElement("li", item)));
  renderGuideLinks("guide-laws", data.laws);
  renderGuideLinks("guide-official", data.laws);
  renderGuideLinks("guide-resources", [...data.resources, ["Plantilla de casos", "Excel de trabajo de Tribuanálisis", "/assets/plantilla-casos.xlsx"]]);
}

document.querySelectorAll("[data-guide-category]").forEach((button) => {
  button.addEventListener("click", () => selectGuideCategory(button.dataset.guideCategory));
});
document.querySelectorAll("[data-guide-case]").forEach((link) => {
  link.addEventListener("click", () => {
    if (draftCategory) selectGuideCategory(draftCategory);
  });
});
selectGuideCategory("Mermas");

function confirmDiscard() {
  if (savingDraft) {
    alert("Espera a que termine el guardado del borrador.");
    return false;
  }
  return !draftDirty || confirm("Hay cambios sin guardar en el borrador. ¿Deseas descartarlos?");
}

function clearDraft() {
  wizardForm.reset();
  draftId = null;
  draftCategory = null;
  savedFiles = [];
  newFiles = [];
  draftDirty = false;
  draftStep = 1;
  reviewItems = {};
  calculation = { non_admitted: "", tax_rate: "" };
  linkedCaseId = null;
  $("non-admitted").value = "";
  $("tax-rate").value = "";
  $("legacy-entry").hidden = true;
  $("legacy-toggle").textContent = "Usar registro rápido anterior →";
  $("wizard-message").hidden = true;
  renderEvidence();
}

function openDraft(draft) {
  clearDraft();
  draftId = draft.id;
  draftCategory = draft.category;
  const detail = categoryDetails[draftCategory];
  $("category").value = draftCategory;
  $("entry-title").textContent = `Registro del caso: ${draftCategory}`;
  $("wizard-data-title").textContent = `Datos de ${draftCategory.toLowerCase()}`;
  $("wizard-data-subtitle").textContent = "Completa los datos de la situación empresarial.";
  $("wizard-image").src = `/assets/${detail.image}`;
  $("subject-label").textContent = detail.subject;
  $("cause-label").textContent = detail.cause;
  $("quantity-label").textContent = draftCategory === "Mermas" ? "Cantidad de merma" : "Cantidad de existencias";
  $("total-label").textContent = draftCategory === "Mermas" ? "Monto total de la merma (S/)" : "Monto total (S/)";
  $("draft-code").textContent = draftId ? `Borrador #${draftId}` : "Nuevo borrador";
  document.querySelectorAll(".wizard-field-group").forEach((group) => {
    const active = group.classList.contains(`wizard-${detail.group}`);
    group.hidden = !active;
    group.querySelectorAll("input, select, textarea").forEach((field) => { field.disabled = !active; });
  });
  Object.entries(draft.fields).forEach(([name, value]) => {
    const field = wizardForm.elements.namedItem(name);
    if (field) field.value = value;
  });
  $("wizard-law-list").replaceChildren(...detail.law.map((line) => makeElement("li", line)));
  savedFiles = draft.files;
  reviewItems = draft.review?.items || {};
  calculation = draft.review?.calculation || { non_admitted: "", tax_rate: "" };
  linkedCaseId = draft.case_id || null;
  renderEvidence();
  updateStockTotal();
  $("analysis-selection").hidden = true;
  $("analysis-entry").hidden = false;
  location.hash = "registro";
  setWizardStep([2, 3, 4].includes(draft.review?.step) ? draft.review.step : 1);
  $("entry-title").focus();
}

function setWizardStep(step) {
  draftStep = step;
  $("wizard-step-one").hidden = step !== 1;
  $("wizard-step-two").hidden = step !== 2;
  $("wizard-step-three").hidden = step !== 3;
  $("wizard-step-four").hidden = step !== 4;
  [1, 2, 3, 4].forEach((number) => {
    const indicator = $(`step-indicator-${number}`);
    indicator.classList.toggle("active", step === number);
    if (step === number) indicator.setAttribute("aria-current", "step");
    else indicator.removeAttribute("aria-current");
  });
  $("step-indicator-1").querySelector("b").textContent = step > 1 ? "✓" : "1";
  $("step-indicator-2").querySelector("b").textContent = step > 2 ? "✓" : "2";
  $("step-indicator-3").querySelector("b").textContent = step > 3 ? "✓" : "3";
  const titles = ["Registro del caso", "Requisitos tributarios", "Cálculo y evaluación", "Resultado del caso"];
  const subtitles = ["Ingresa la información de la situación empresarial y la documentación de sustento.", "Revisa los puntos tributarios y relaciona la evidencia de tu caso.", "Determina la deducción considerada y el posible reparo según tu revisión.", "Resumen del análisis, la deducción considerada y el posible reparo tributario."];
  $("entry-title").textContent = `${titles[step - 1]} – ${draftCategory}`;
  $("entry-subtitle").textContent = subtitles[step - 1];
  if (step === 2) renderReview();
  if (step === 3) renderCalculation();
  if (step === 4) renderFinal();
}

function draftAmount() {
  const detail = categoryDetails[draftCategory];
  if (detail.group === "stock") {
    const quantity = decimalHundredths(wizardForm.elements.namedItem("quantity").value);
    const price = decimalHundredths(wizardForm.elements.namedItem("unit_cost").value);
    return quantity === null || price === null ? null : (quantity * price + 50n) / 100n;
  }
  const field = detail.group === "asset" ? "annual_expense" : "provision";
  return decimalHundredths(wizardForm.elements.namedItem(field).value);
}

function formatCents(cents) {
  const whole = new Intl.NumberFormat("es-PE").format(cents / 100n);
  return `S/ ${whole}.${String(cents % 100n).padStart(2, "0")}`;
}

function updateStockTotal() {
  const q = decimalHundredths(wizardForm.elements.namedItem("quantity").value);
  const p = decimalHundredths(wizardForm.elements.namedItem("unit_cost").value);
  const cents = q === null || p === null ? null : (q * p + 50n) / 100n;
  $("stock-total").textContent = cents === null ? "—" : formatCents(cents);
}

wizardForm.addEventListener("input", (event) => {
  if (["quantity", "unit_cost", "annual_expense", "provision"].includes(event.target.name) && calculation.non_admitted !== "") {
    calculation.non_admitted = "";
    $("non-admitted").value = "";
    $("wizard-message").textContent = "Cambió el monto del caso. Ingresa nuevamente el importe no admitido en el cálculo.";
    $("wizard-message").hidden = false;
  } else {
    $("wizard-message").hidden = true;
  }
  draftDirty = true;
  updateStockTotal();
});
wizardForm.addEventListener("change", () => { draftDirty = true; });
wizardForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (await saveDraft(2)) {
    setWizardStep(2);
    $("entry-title").focus();
  }
});

function renderEvidence() {
  const list = $("evidence-list");
  list.replaceChildren();
  [...savedFiles.map((file) => ({ ...file, saved: true })), ...newFiles.map((file, index) => ({ filename: file.name, size: file.size, index, saved: false }))].forEach((file) => {
    const row = makeElement("div", undefined, "evidence-row");
    const icon = makeElement("span", "▤", "evidence-icon");
    const info = makeElement("div", undefined, "evidence-info");
    if (file.saved) {
      const link = makeElement("a", file.filename);
      link.href = `/api/drafts/${draftId}/files/${file.id}`;
      link.setAttribute("download", "");
      info.append(link);
    } else {
      info.append(makeElement("strong", file.filename));
    }
    info.append(makeElement("small", `${(file.size / 1024 / 1024).toFixed(2)} MB · ${file.saved ? "Guardado · Descargar" : "Pendiente de guardar"}`));
    const remove = makeElement("button", "✕", "evidence-remove");
    remove.type = "button";
    remove.setAttribute("aria-label", `Quitar ${file.filename}`);
    remove.addEventListener("click", () => {
      if (file.saved) {
        savedFiles = savedFiles.filter((entry) => entry.id !== file.id);
        Object.values(reviewItems).forEach((entry) => { entry.file_ids = entry.file_ids.filter((id) => id !== file.id); });
      }
      else newFiles.splice(file.index, 1);
      draftDirty = true;
      renderEvidence();
    });
    row.append(icon, info, remove);
    list.append(row);
  });
}

function addEvidence(files) {
  const added = Array.from(files);
  if (savedFiles.length + newFiles.length + added.length > 5) {
    alert("Puedes adjuntar hasta cinco archivos por borrador.");
    return;
  }
  if (added.some((file) => !/\.(pdf|jpe?g|png|xls|xlsx)$/i.test(file.name) || file.size === 0 || file.size > 10 * 1024 * 1024)) {
    alert("Usa archivos PDF, JPG, PNG, XLS o XLSX con contenido y de hasta 10 MB cada uno.");
    return;
  }
  newFiles.push(...added);
  if (added.length) draftDirty = true;
  renderEvidence();
}

$("evidence-input").addEventListener("change", (event) => {
  addEvidence(event.target.files);
  event.target.value = "";
});
["dragenter", "dragover"].forEach((type) => $("upload-zone").addEventListener(type, (event) => {
  event.preventDefault();
  $("upload-zone").classList.add("dragging");
}));
["dragleave", "drop"].forEach((type) => $("upload-zone").addEventListener(type, (event) => {
  event.preventDefault();
  $("upload-zone").classList.remove("dragging");
  if (type === "drop") addEvidence(event.dataTransfer.files);
}));

async function saveDraft(targetStep) {
  const button = draftStep === 4 ? $("final-save") : draftStep === 3 ? $("save-calculation") : draftStep === 2 ? $("save-review") : $("save-draft");
  button.disabled = true;
  const fields = Object.fromEntries(new FormData(wizardForm).entries());
  const body = new FormData();
  body.append("payload", JSON.stringify({ id: draftId, category: draftCategory, fields, kept_files: savedFiles.map((file) => file.id), review: { step: targetStep, items: reviewItems, calculation } }));
  newFiles.forEach((file) => body.append("files", file));
  savingDraft = true;
  $("analysis-entry").inert = true;
  try {
    const result = await api("/api/drafts", { method: "POST", body });
    draftId = result.id;
    savedFiles = result.files;
    newFiles = [];
    draftDirty = false;
    $("draft-code").textContent = `Borrador #${draftId}`;
    renderEvidence();
    draftStep = targetStep;
    try {
      await loadDrafts();
    } catch (error) {
      alert(`El borrador se guardó, pero no se pudo actualizar el historial: ${error.message}`);
    }
    return true;
  } catch (error) {
    alert(error.message);
    return false;
  } finally {
    savingDraft = false;
    $("analysis-entry").inert = false;
    button.disabled = false;
  }
}

$("save-draft").addEventListener("click", async () => {
  if (await saveDraft(1)) {
    $("wizard-message").textContent = "Borrador y evidencias guardados. Puedes recuperarlos desde el historial.";
    $("wizard-message").hidden = false;
  }
});

function renderCaseSummary(prefix) {
  const detail = categoryDetails[draftCategory];
  $(`${prefix}-image`).src = `/assets/${detail.image}`;
  $(`${prefix}-code`).textContent = `Borrador #${draftId}`;
  $(`${prefix}-company`).textContent = wizardForm.elements.namedItem("company").value || "Empresa sin indicar";
  $(`${prefix}-category`).textContent = draftCategory;
  const date = wizardForm.elements.namedItem("date").value;
  $(`${prefix}-date`).textContent = date ? date.split("-").reverse().join("/") : "Sin indicar";
  const amount = draftAmount();
  $(`${prefix}-amount`).textContent = amount === null ? "—" : formatCents(amount);
  $(`${prefix}-amount-label`).textContent = detail.group === "asset" ? "Depreciación contabilizada" : detail.group === "debt" ? "Provisión contabilizada" : "Costo estimado";
}

function renderReview() {
  const detail = categoryDetails[draftCategory];
  renderCaseSummary("review");
  $("review-law-list").replaceChildren(...detail.law.map((line) => makeElement("li", line)));
  const body = $("review-items");
  body.replaceChildren();
  reviewPoints[draftCategory].forEach(([key, description], index) => {
    const entry = reviewItems[key] || { status: "pending", file_ids: [] };
    const row = makeElement("tr");
    const number = makeElement("td");
    number.append(makeElement("span", String(index + 1), "review-number"));
    const text = makeElement("td", description);
    const statusCell = makeElement("td");
    const status = makeElement("select", undefined, "review-status");
    status.setAttribute("aria-label", `Estado: ${description}`);
    [["pending", "Pendiente"], ["met", "Cumple"], ["not_met", "No cumple"]].forEach(([value, label]) => status.add(new Option(label, value)));
    status.value = entry.status;
    status.dataset.status = entry.status;
    status.addEventListener("change", () => {
      entry.status = status.value;
      status.dataset.status = entry.status;
      reviewItems[key] = entry;
      draftDirty = true;
      $("review-message").hidden = true;
      updateReviewResult();
    });
    statusCell.append(status);
    const evidenceCell = makeElement("td");
    const details = makeElement("details", undefined, "review-evidence");
    details.append(makeElement("summary", `Evidencias (${entry.file_ids.length})`));
    const choices = makeElement("div", undefined, "review-evidence-choices");
    if (!savedFiles.length) choices.append(makeElement("p", "No hay archivos guardados. Agrégalos en el registro del caso."));
    savedFiles.forEach((file) => {
      const label = makeElement("label");
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = entry.file_ids.includes(file.id);
      checkbox.addEventListener("change", () => {
        entry.file_ids = checkbox.checked ? [...entry.file_ids, file.id] : entry.file_ids.filter((id) => id !== file.id);
        reviewItems[key] = entry;
        draftDirty = true;
        details.querySelector("summary").textContent = `Evidencias (${entry.file_ids.length})`;
        $("review-message").hidden = true;
      });
      const link = makeElement("a", file.filename);
      link.href = `/api/drafts/${draftId}/files/${file.id}`;
      link.setAttribute("download", "");
      label.append(checkbox, link);
      choices.append(label);
    });
    const manage = makeElement("button", "Agregar o quitar archivos", "text-action");
    manage.type = "button";
    manage.addEventListener("click", () => {
      setWizardStep(1);
      draftDirty = true;
      $("evidence-input").focus();
    });
    choices.append(manage);
    details.append(choices);
    evidenceCell.append(details);
    row.append(number, text, statusCell, evidenceCell);
    body.append(row);
  });
  updateReviewResult();
  $("review-message").hidden = true;
}

function updateReviewResult() {
  const statuses = reviewPoints[draftCategory].map(([key]) => reviewItems[key]?.status || "pending");
  const met = statuses.filter((status) => status === "met").length;
  const pending = statuses.filter((status) => status === "pending").length;
  const notMet = statuses.filter((status) => status === "not_met").length;
  const percent = Math.round(met / statuses.length * 100);
  $("review-percent").textContent = `${percent}%`;
  $("review-met").textContent = met;
  $("review-pending").textContent = pending;
  $("review-not-met").textContent = notMet;
  $("review-meter-progress").style.strokeDasharray = `${percent * 1.4137} 141.37`;
}

$("review-previous").addEventListener("click", () => {
  setWizardStep(1);
  draftDirty = true;
  $("entry-title").focus();
});
$("save-review").addEventListener("click", async () => {
  if (await saveDraft(2)) {
    $("review-message").textContent = "Avance guardado. Puedes recuperarlo desde el historial.";
    $("review-message").hidden = false;
  }
});
$("review-next").addEventListener("click", async () => {
  if (await saveDraft(3)) {
    setWizardStep(3);
    $("entry-title").focus();
  }
});

function calculationState() {
  return calculateTaxValues(draftAmount(), calculation);
}

function renderCalculation() {
  renderCaseSummary("calculation");
  $("calculation-law-list").replaceChildren(...categoryDetails[draftCategory].law.map((line) => makeElement("li", line)));
  $("non-admitted").value = calculation.non_admitted;
  $("tax-rate").value = calculation.tax_rate;
  $("calculation-message").hidden = true;
  updateCalculation();
}

function updateCalculation() {
  const { recorded, nonAdmitted, deductible, tax, error } = calculationState();
  $("calc-error").textContent = error;
  $("calc-error").hidden = !error;
  $("calc-recorded").textContent = recorded === null ? "—" : formatCents(recorded);
  $("calc-deductible").textContent = deductible === null ? "—" : formatCents(deductible);
  $("result-deductible").textContent = deductible === null ? "—" : formatCents(deductible);
  $("result-adjustment").textContent = deductible === null ? "—" : formatCents(nonAdmitted);
  $("result-tax").textContent = tax === null ? "—" : formatCents(tax);
  $("chart-recorded-value").textContent = recorded === null ? "—" : formatCents(recorded);
  $("chart-deductible-value").textContent = deductible === null ? "—" : formatCents(deductible);
  $("chart-recorded-bar").style.height = recorded && recorded > 0n ? "100%" : "0%";
  $("chart-deductible-bar").style.height = deductible !== null && recorded > 0n ? `${Number(deductible * 10000n / recorded) / 100}%` : "0%";
  $("calc-interpretation").textContent = deductible === null
    ? "Ingresa el importe no admitido para calcular la deducción considerada y el reparo."
    : `Según el importe no admitido que ingresaste, la deducción considerada es ${formatCents(deductible)} y el reparo es ${formatCents(nonAdmitted)}. Verifica los requisitos y el sustento antes de concluir.`;
}

function validateCalculation() {
  const { error } = calculationState();
  if (error) {
    updateCalculation();
    $("calc-error").scrollIntoView({ block: "nearest" });
    return false;
  }
  return true;
}

[["non-admitted", "non_admitted"], ["tax-rate", "tax_rate"]].forEach(([id, key]) => {
  $(id).addEventListener("input", (event) => {
    calculation[key] = event.target.value.trim();
    draftDirty = true;
    $("calculation-message").hidden = true;
    updateCalculation();
  });
});
$("calculation-previous").addEventListener("click", () => {
  if (!validateCalculation()) return;
  setWizardStep(2);
  draftDirty = true;
  $("entry-title").focus();
});
$("save-calculation").addEventListener("click", async () => {
  if (validateCalculation() && await saveDraft(3)) {
    $("calculation-message").textContent = "Avance guardado. Puedes recuperarlo desde el historial.";
    $("calculation-message").hidden = false;
  }
});
$("calculation-next").addEventListener("click", async () => {
  if (!validateCalculation()) return;
  const { recorded, deductible } = calculationState();
  if (deductible === null || recorded <= 0n || recorded > 100000000000n) {
    $("calculation-message").textContent = "Ingresa el importe no admitido y verifica que el gasto sea mayor que cero y no supere S/ 1,000,000,000.";
    $("calculation-message").hidden = false;
    return;
  }
  if (await saveDraft(4)) {
    setWizardStep(4);
    $("entry-title").focus();
  }
});

function renderFinal() {
  renderCaseSummary("final");
  const { recorded, deductible, nonAdmitted, tax } = calculationState();
  const valid = recorded !== null && deductible !== null && recorded > 0n && recorded <= 100000000000n;
  $("final-code").textContent = linkedCaseId ? `Caso CAS-${String(linkedCaseId).padStart(3, "0")}` : `Borrador #${draftId}`;
  $("final-expense").textContent = recorded === null ? "—" : formatCents(recorded);
  $("final-deductible").textContent = valid ? formatCents(deductible) : "—";
  $("final-adjustment").textContent = valid ? formatCents(nonAdmitted) : "—";
  $("final-tax").textContent = valid && tax !== null ? formatCents(tax) : "No calculada";
  $("final-tax-label").textContent = calculation.tax_rate ? `Incidencia estimada en el IR (${calculation.tax_rate} %)` : "Incidencia estimada en el IR";
  $("final-chart-expense").textContent = recorded === null ? "—" : formatCents(recorded);
  $("final-chart-deductible").textContent = valid ? formatCents(deductible) : "—";
  $("final-expense-bar").style.height = recorded && recorded > 0n ? "100%" : "0%";
  $("final-deductible-bar").style.height = valid ? `${Number(deductible * 10000n / recorded) / 100}%` : "0%";
  const statuses = reviewPoints[draftCategory].map(([key]) => reviewItems[key]?.status || "pending");
  const met = statuses.filter((status) => status === "met").length;
  const pending = statuses.filter((status) => status === "pending").length;
  const notMet = statuses.filter((status) => status === "not_met").length;
  $("final-review-status").textContent = `Tu revisión: ${met} cumple, ${pending} pendiente(s), ${notMet} no cumple.`;
  $("final-evidence-status").textContent = `${savedFiles.length} archivo(s) guardado(s); contenido no verificado.`;
  $("final-save-status").textContent = linkedCaseId ? "Caso registrado. Guarda el caso para actualizar cualquier cambio." : "Aún no registrado; pulsa Guardar caso para añadirlo al informe.";
  $("final-status").textContent = valid ? "Resultado según tu revisión" : "Cálculo pendiente";
  $("final-interpretation").textContent = valid
    ? `Según los datos ingresados, de ${formatCents(recorded)} se considera deducible ${formatCents(deductible)} y se determina un reparo de ${formatCents(nonAdmitted)}. Las marcas y los importes son proporcionados por el usuario; no constituyen una validación tributaria automática.`
    : "Vuelve a cálculo y completa un importe no admitido válido para revisar el resultado.";
  $("final-law-list").replaceChildren(...categoryDetails[draftCategory].law.map((line) => makeElement("li", line)));
  $("final-message").hidden = true;
}

$("final-previous").addEventListener("click", () => {
  setWizardStep(3);
  draftDirty = true;
  $("entry-title").focus();
});
$("final-edit").addEventListener("click", () => {
  setWizardStep(1);
  draftDirty = true;
  $("entry-title").focus();
});
$("final-save").addEventListener("click", async () => {
  const button = $("final-save");
  if (!await saveDraft(4)) return;
  button.disabled = true;
  savingDraft = true;
  $("analysis-entry").inert = true;
  try {
    const result = await api(`/api/drafts/${draftId}/finalize`, { method: "POST" });
    linkedCaseId = result.id;
    renderFinal();
    $("final-message").textContent = `Caso CAS-${String(result.id).padStart(3, "0")} guardado en el historial y el informe.`;
    $("final-message").hidden = false;
    try {
      await Promise.all([loadCases(), loadDrafts()]);
    } catch (error) {
      alert(`El caso se guardó, pero no se pudo actualizar la pantalla: ${error.message}`);
    }
  } catch (error) {
    alert(error.message);
  } finally {
    savingDraft = false;
    $("analysis-entry").inert = false;
    button.disabled = false;
  }
});

$("final-print").addEventListener("click", () => {
  const { recorded, deductible, nonAdmitted, tax } = calculationState();
  if (recorded === null || deductible === null || recorded <= 0n || recorded > 100000000000n) {
    alert("Completa un cálculo válido antes de generar el informe.");
    return;
  }
  const report = $("print-view");
  report.replaceChildren();
  report.append(
    makeElement("h1", "Informe de reparos tributarios"),
    makeElement("p", "Tribuanálisis · Semana 12"),
    makeElement("p", `${linkedCaseId ? `Caso CAS-${String(linkedCaseId).padStart(3, "0")} · Datos actuales del análisis; guarda el caso para actualizar el historial` : `Borrador #${draftId} · No registrado`}\nEmpresa: ${wizardForm.elements.namedItem("company").value}\nConcepto: ${draftCategory}\nFecha de identificación: ${wizardForm.elements.namedItem("date").value}\nDescripción: ${wizardForm.elements.namedItem("subject").value}`, "report-support"),
    makeElement("h2", "Resumen del análisis"),
    makeElement("p", `Gasto registrado: ${formatCents(recorded)}\nDeducción considerada: ${formatCents(deductible)}\nReparo: ${formatCents(nonAdmitted)}\nIncidencia estimada en el IR${calculation.tax_rate ? ` (${calculation.tax_rate} %)` : ""}: ${tax === null ? "No calculada" : formatCents(tax)}`, "report-support"),
    makeElement("h2", "Sustento"),
    makeElement("p", wizardForm.elements.namedItem("cause").value, "report-support"),
    makeElement("h2", "Revisión ingresada por el usuario")
  );
  const list = makeElement("ul");
  reviewPoints[draftCategory].forEach(([key, text]) => {
    const entry = reviewItems[key];
    const status = entry?.status === "met" ? "Cumple" : entry?.status === "not_met" ? "No cumple" : "Pendiente";
    const names = (entry?.file_ids || []).map((id) => savedFiles.find((file) => file.id === id)?.filename).filter(Boolean);
    list.append(makeElement("li", `${text} — ${status}${names.length ? ` · Evidencia: ${names.join(", ")}` : ""}`));
  });
  report.append(list, makeElement("h2", "Base normativa referencial"));
  const laws = makeElement("ul");
  categoryDetails[draftCategory].law.forEach((text) => laws.append(makeElement("li", text)));
  report.append(laws, makeElement("p", "Uso académico. Las marcas y los importes son ingresados por el usuario; no constituyen una validación tributaria automática. La incidencia estimada no es el impuesto definitivo. Verifica la normativa vigente y el sustento.", "report-note"));
  window.print();
});

$("wizard-cancel").addEventListener("click", () => {
  if (!confirmDiscard()) return;
  clearDraft();
  showCategories();
  $("register-title").focus();
});
$("legacy-toggle").addEventListener("click", () => {
  const section = $("legacy-entry");
  section.hidden = !section.hidden;
  $("legacy-toggle").textContent = section.hidden ? "Usar registro rápido anterior →" : "Ocultar registro rápido ↑";
});
window.addEventListener("beforeunload", (event) => {
  if (draftDirty) {
    event.preventDefault();
    event.returnValue = "";
  }
});

async function loadDrafts() {
  const { drafts } = await api("/api/drafts");
  drafts.forEach((draft) => {
    const item = cases.find((entry) => entry.id === draft.case_id);
    if (item) item.draft_company = draft.fields.company || "";
  });
  renderHistory();
  $("draft-badge").textContent = `${drafts.length} ${drafts.length === 1 ? "borrador" : "borradores"}`;
  $("draft-empty").hidden = drafts.length > 0;
  const list = $("draft-list");
  list.replaceChildren();
  drafts.forEach((draft) => {
    const card = makeElement("article", undefined, "case");
    const top = makeElement("div", undefined, "case-top");
    const actions = makeElement("div", undefined, "case-actions");
    const edit = makeElement("button", draft.case_id ? "Editar análisis" : "Continuar borrador", "text-action");
    edit.type = "button";
    edit.addEventListener("click", async () => {
      if (!confirmDiscard()) return;
      try {
        openDraft(await api(`/api/drafts/${draft.id}`));
      } catch (error) {
        alert(error.message);
      }
    });
    const remove = makeElement("button", "Eliminar", "delete-button");
    remove.type = "button";
    remove.addEventListener("click", async () => {
      if (!confirm(draft.case_id ? "¿Eliminar los datos detallados y evidencias de este análisis? El caso registrado y sus importes permanecerán en el informe." : "¿Deseas eliminar este borrador y sus evidencias?")) return;
      if (draft.id === draftId && !confirmDiscard()) return;
      remove.disabled = true;
      try {
        await api(`/api/drafts/${draft.id}`, { method: "DELETE" });
        if (draft.id === draftId) clearDraft();
        await Promise.all([loadCases(), loadDrafts()]);
      } catch (error) {
        alert(error.message);
        remove.disabled = false;
      }
    });
    actions.append(edit, remove);
    top.append(makeElement("span", draft.category, "case-tag"), actions);
    card.append(top, makeElement("h4", draft.fields.subject || "Borrador sin descripción"), makeElement("p", draft.fields.company || "Empresa sin indicar"), makeElement("div", `Actualizado: ${draft.updated_at} (UTC) · Paso ${draft.step}${draft.case_id ? " · Caso registrado" : ""}`, "case-date"));
    list.append(card);
  });
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const description = $("description").value.trim();
  const support = $("support").value.trim();
  if (!description || !support) {
    alert("Completa la descripción y el sustento del caso.");
    return;
  }
  const expense = Math.round(Number($("expense").value) * 100);
  const deductible = Math.round(Number($("deductible").value) * 100);
  if (!Number.isSafeInteger(expense) || !Number.isSafeInteger(deductible) || expense <= 0 || deductible < 0 || deductible > expense) {
    alert("El importe deducible debe estar entre cero y el gasto contabilizado.");
    return;
  }
  const sum = totals();
  if (!Number.isSafeInteger(sum.expense + expense)) {
    alert("El total de gastos supera el límite que puede calcular la herramienta.");
    return;
  }
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    await api("/api/cases", {
      method: "POST",
      body: JSON.stringify({ category: $("category").value, description, support, expense, deductible })
    });
    form.reset();
    await loadCases();
    selectedReportIds = new Set(cases.length ? [cases[0].id] : []);
    render();
    showCategories();
    location.hash = "informe";
  } catch (error) {
    alert(error.message);
  } finally {
    button.disabled = false;
  }
});

async function loadCases() {
  const data = await api("/api/state");
  cases = data.cases;
  render();
}

$("save-profile").addEventListener("click", async () => {
  if (!$("period").reportValidity()) return;
  const button = $("save-profile");
  button.disabled = true;
  try {
    await api("/api/profile", { method: "PUT", body: JSON.stringify({ company: $("company").value, period: $("period").value }) });
    alert("Los datos del informe se guardaron correctamente.");
  } catch (error) {
    alert(error.message);
  } finally {
    button.disabled = false;
  }
});

$("import-old").addEventListener("click", async () => {
  if (!confirm("¿Estos casos anteriores te pertenecen y deseas copiarlos a tu cuenta?")) return;
  const button = $("import-old");
  button.disabled = true;
  try {
    const previous = JSON.parse(localStorage.getItem(storageKey));
    await api("/api/import", { method: "POST", body: JSON.stringify({ cases: previous.cases }) });
    $("import-notice").hidden = true;
    await loadCases();
    alert("Se importaron los casos anteriores. Los datos de empresa y ejercicio se guardan por separado.");
  } catch (error) {
    alert(error.message || "No se pudieron importar los datos anteriores.");
  } finally {
    button.disabled = false;
  }
});

function reportOptions() {
  const sections = {};
  document.querySelectorAll("[data-report-section]").forEach((input) => { sections[input.dataset.reportSection] = input.checked; });
  return {
    type: document.querySelector('input[name="report-type"]:checked').value,
    sections,
    case_ids: selectedCases().map((item) => item.id)
  };
}

function renderReportSelection() {
  const rows = $("report-case-rows");
  rows.replaceChildren();
  $("report-cases-empty").hidden = cases.length > 0;
  cases.forEach((item, index) => {
    const row = makeElement("tr");
    const cell = makeElement("td");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = selectedReportIds === null || selectedReportIds.has(item.id);
    checkbox.setAttribute("aria-label", `Incluir caso ${item.description}`);
    checkbox.addEventListener("change", () => {
      $("report-message").textContent = "";
      if (selectedReportIds === null) selectedReportIds = new Set(cases.map((entry) => entry.id));
      if (checkbox.checked) selectedReportIds.add(item.id);
      else selectedReportIds.delete(item.id);
      render();
    });
    cell.append(checkbox);
    row.append(cell);
    [String(index + 1), `CAS-${String(item.id).padStart(3, "0")}`, item.category, item.description, money(item.expense), money(item.deductible), money(item.expense - item.deductible)].forEach((text) => row.append(makeElement("td", text)));
    rows.append(row);
  });
}

async function renderReportPreview() {
  const version = ++reportRenderVersion;
  const preview = $("report-preview");
  const shown = selectedCases();
  const options = reportOptions();
  $("report-status").textContent = shown.length ? "Listo para revisar" : "Sin casos seleccionados";
  $("print-report").disabled = true;
  if (!shown.length) {
    preview.replaceChildren(makeElement("p", "Selecciona uno o más casos registrados para preparar el informe.", "report-preview-empty"));
    return;
  }
  const needsDetails = options.sections.evidence || (options.type === "technical" && options.sections.analysis);
  const details = new Map();
  if (needsDetails) {
    preview.replaceChildren(makeElement("p", "Cargando los detalles de los análisis…", "report-preview-empty"));
    try {
      await Promise.all(shown.filter((item) => item.draft_id).map(async (item) => {
        details.set(item.id, await api(`/api/drafts/${item.draft_id}`));
      }));
    } catch (error) {
      if (version === reportRenderVersion) {
        preview.replaceChildren(makeElement("p", `No se pudieron cargar los detalles: ${error.message}`, "report-preview-empty"));
        $("report-status").textContent = "Revisión pendiente";
      }
      return;
    }
  }
  if (version !== reportRenderVersion) return;
  const sum = totals(shown);
  const typeNames = { complete: "Informe completo", executive: "Informe ejecutivo", technical: "Informe técnico" };
  const cover = makeElement("div", undefined, "report-document-cover");
  cover.append(makeElement("strong", "▣ tribuanálisis", "report-document-brand"), makeElement("span", typeNames[options.type], "report-document-type"), makeElement("h1", "INFORME DE REPAROS TRIBUTARIOS"), makeElement("p", "Gastos empresariales: Mermas, Desmedros, Depreciación y Cobranza Dudosa"), makeElement("span", "Semana 12", "report-document-week"));
  const content = makeElement("div", undefined, "report-document-content");
  content.append(
    makeElement("h2", "Datos del informe"),
    makeElement("p", `Empresa o caso: ${$("company").value.trim() || "No indicado"}\nEjercicio tributario: ${$("period").value || "No indicado"}\nCasos incluidos: ${shown.length}`, "report-support"),
    makeElement("h2", "Resumen de importes"),
    makeElement("p", `Gasto registrado: ${money(sum.expense)}\nDeducción considerada: ${money(sum.deductible)}\nReparo tributario: ${money(sum.expense - sum.deductible)}\nIncidencia en el IR: No calculada`, "report-support")
  );
  const caseList = makeElement("ul");
  shown.forEach((item) => caseList.append(makeElement("li", `CAS-${String(item.id).padStart(3, "0")} · ${item.category} — ${item.description}`)));
  content.append(makeElement("h2", "Casos incluidos"), caseList);
  if (options.sections.charts) {
    content.append(makeElement("h2", "Casos y comparativo"));
    const table = makeElement("table");
    const head = makeElement("thead");
    const header = makeElement("tr");
    ["Código", "Concepto", "Descripción", "Gasto", "Deducción", "Reparo"].forEach((text) => header.append(makeElement("th", text)));
    head.append(header);
    const body = makeElement("tbody");
    shown.forEach((item) => {
      const row = makeElement("tr");
      [`CAS-${String(item.id).padStart(3, "0")}`, item.category, item.description, money(item.expense), money(item.deductible), money(item.expense - item.deductible)].forEach((text) => row.append(makeElement("td", text)));
      body.append(row);
    });
    table.append(head, body);
    content.append(table);
    const chart = makeElement("div", undefined, "report-document-chart");
    [["Gasto", sum.expense], ["Deducción", sum.deductible], ["Reparo", sum.expense - sum.deductible]].forEach(([label, amount]) => {
      const bar = makeElement("div", undefined, "report-document-chart-row");
      const track = makeElement("span", undefined, "report-document-track");
      const fill = makeElement("i");
      fill.style.width = `${sum.expense ? amount / sum.expense * 100 : 0}%`;
      track.append(fill);
      bar.append(makeElement("b", label), track, makeElement("strong", money(amount)));
      chart.append(bar);
    });
    content.append(chart);
  }
  if (options.sections.analysis) {
    content.append(makeElement("h2", "Interpretación y análisis"));
    content.append(makeElement("p", `De ${money(sum.expense)} registrados, se consideran deducibles ${money(sum.deductible)} y se determina un reparo de ${money(sum.expense - sum.deductible)}, según los importes ingresados por el usuario.`));
    if (options.type !== "executive") {
      shown.forEach((item) => {
        const section = makeElement("div", undefined, "report-case");
        section.append(makeElement("strong", `CAS-${String(item.id).padStart(3, "0")} · ${item.category} — ${item.description}`), makeElement("p", item.support, "report-support"));
        const detail = details.get(item.id);
        if (options.type === "technical") {
          if (detail) {
            section.append(makeElement("p", "Revisión actual del borrador; puede diferir del caso guardado.", "report-note"));
            const list = makeElement("ul");
            reviewPoints[item.category].forEach(([key, text]) => {
              const status = detail.review.items[key]?.status;
              list.append(makeElement("li", `${text} — ${status === "met" ? "Cumple" : status === "not_met" ? "No cumple" : "Pendiente"}`));
            });
            section.append(list);
          } else {
            section.append(makeElement("p", "Este caso no tiene un análisis detallado vinculado.", "report-note"));
          }
        }
        content.append(section);
      });
    }
  }
  if (options.sections.law) {
    content.append(makeElement("h2", "Base normativa referencial"));
    const list = makeElement("ul");
    [...new Set(shown.map((item) => item.category))].forEach((category) => {
      list.append(makeElement("li", `${category}: ${categoryDetails[category].law.join(" ")}`));
    });
    content.append(list);
  }
  if (options.sections.conclusions) {
    content.append(makeElement("h2", "Conclusiones y recomendaciones"), makeElement("p", "Verifica los requisitos, la normativa vigente y los documentos de sustento de cada caso antes de concluir sobre la deducción. El reparo es la diferencia entre el gasto y la deducción considerada; no es el impuesto a pagar."));
  }
  if (options.sections.evidence) {
    content.append(makeElement("h2", "Relación de evidencias"), makeElement("p", "Archivos actuales del borrador vinculado; pueden diferir del caso guardado. Los enlaces permiten descargarlos por separado mientras la aplicación esté disponible; los archivos no se insertan en el PDF.", "report-note"));
    shown.forEach((item) => {
      const section = makeElement("div", undefined, "report-case");
      section.append(makeElement("strong", `CAS-${String(item.id).padStart(3, "0")} · ${item.description}`));
      const detail = details.get(item.id);
      if (!detail || !detail.files.length) {
        section.append(makeElement("p", "Sin evidencias vinculadas disponibles."));
      } else {
        const list = makeElement("ul");
        detail.files.forEach((file) => {
          const entry = makeElement("li");
          const link = makeElement("a", file.filename);
          link.href = `${location.origin}/api/drafts/${item.draft_id}/files/${file.id}`;
          entry.append(link);
          list.append(entry);
        });
        section.append(list);
      }
      content.append(section);
    });
  }
  content.append(makeElement("p", "Uso académico. Los importes y marcas son ingresados por el usuario y no constituyen una validación tributaria automática.", "report-note"));
  preview.replaceChildren(cover, content);
  $("print-report").disabled = false;
}

$("select-all-cases").addEventListener("click", () => { $("report-message").textContent = ""; selectedReportIds = null; render(); });
document.querySelectorAll('input[name="report-type"], [data-report-section], #company, #period').forEach((input) => {
  input.addEventListener("input", () => { $("report-message").textContent = ""; renderReportPreview(); });
});
$("refresh-preview").addEventListener("click", () => { renderReportPreview(); $("report-preview").focus(); });
$("save-report-settings").addEventListener("click", async () => {
  const button = $("save-report-settings");
  button.disabled = true;
  try {
    const saved = JSON.stringify(reportOptions());
    await api("/api/report-settings", { method: "PUT", body: saved });
    $("report-message").textContent = saved === JSON.stringify(reportOptions()) ? "Configuración guardada para tu cuenta." : "Se guardó la configuración anterior; guarda de nuevo los cambios actuales.";
  } catch (error) {
    $("report-message").textContent = `No se pudo guardar la configuración: ${error.message}`;
  } finally {
    button.disabled = false;
  }
});
$("print-report").addEventListener("click", () => {
  if (!$("period").reportValidity()) return;
  const report = $("print-view");
  report.replaceChildren(...Array.from($("report-preview").children, (child) => child.cloneNode(true)));
  window.print();
});

load().catch((error) => {
  alert(error.message);
  form.querySelector('button[type="submit"]').disabled = true;
  $("save-profile").disabled = true;
  $("print-report").disabled = true;
});
