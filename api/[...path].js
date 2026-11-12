const { createClient } = require("@supabase/supabase-js");
const { timingSafeEqual } = require("node:crypto");

const schema = {
  Users: ["Roll_No", "Name", "Email", "Phone_No"],
  Organizers: ["Organizer_ID", "Roll_No", "Organization_Name", "Designation"],
  Venues: ["Venue_ID", "Venue_Name", "Building", "Floor", "Room_Number", "Capacity"],
  Events: ["Event_ID", "Event_Name", "Description", "Category", "Event_Date", "Start_Time", "End_Time", "Venue_ID", "Event_Capacity", "Registration_Deadline"],
  Event_Organizers: ["Organizer_ID", "Event_ID"],
  Registrations: ["Registration_ID", "Roll_No", "Event_ID", "Registration_Date"],
  Payments: ["Payment_ID", "Roll_No", "Payment_Date", "Amount", "Transaction_ID"],
  Suppliers: ["Supplier_ID", "Supplier_Name", "Category", "Phone_No", "Email"],
  Event_Suppliers: ["Event_ID", "Supplier_ID"]
};
const primary = {
  Users: "Roll_No", Organizers: "Organizer_ID", Venues: "Venue_ID",
  Events: "Event_ID", Registrations: "Registration_ID", Payments: "Payment_ID",
  Suppliers: "Supplier_ID"
};
const operatorMap = { "=": "eq", "!=": "neq", ">": "gt", "<": "lt", ">=": "gte", "<=": "lte", "LIKE": "like", "IS NULL": "is", "IS NOT NULL": "not.is" };
const metadata = Object.fromEntries(Object.entries(schema).map(([table, fields]) => [table, fields.map(name => ({
  name, type: name.includes("Date") ? "DATE" : name.includes("Time") ? "TIME" :
    ["Capacity", "Amount", "ID"].some(token => name.includes(token)) ? "INTEGER" : "TEXT",
  pk: (primary[table] || "").split(",").includes(name) ? 1 : 0,
  dflt_value: ["Registration_Date", "Payment_Date"].includes(name) ? "CURRENT_TIMESTAMP" : null
}))]));

function authorized(req) {
  const expected = process.env.APP_PASSWORD || "";
  const given = req.headers["x-app-password"] || "";
  if (!expected || !given) return false;
  const a = Buffer.from(expected), b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}
function send(res, status, data) { return res.status(status).json(data); }
function getTable(req) { return new URL(req.url, "http://localhost").searchParams.get("table") || ""; }
function checkedTable(name) {
  if (!Object.prototype.hasOwnProperty.call(schema, name)) throw new Error("Choose a valid table.");
  return name;
}
function conditionList(payload, table) {
  const items = payload.conditions || [];
  if (!Array.isArray(items)) throw new Error("Conditions must be a list.");
  for (const c of items) {
    if (!schema[table].includes(c.column) || !operatorMap[c.operator]) throw new Error("Invalid filter column or operator.");
  }
  return items;
}
function addFilters(query, conditions) {
  for (const c of conditions) {
    const op = c.operator;
    if (op === "IS NULL") query = query.is(c.column, null);
    else if (op === "IS NOT NULL") query = query.not(c.column, "is", null);
    else query = query.filter(c.column, operatorMap[op], c.value);
  }
  return query;
}
function quote(value) {
  if (value === null || value === undefined) return "NULL";
  return "'" + String(value).replaceAll("'", "''") + "'";
}
function preview(payload, table, conditions) {
  const t = '"' + table + '"';
  const where = conditions.length ? " WHERE " + conditions.map(c => '"' + c.column + '" ' + c.operator + (c.operator.startsWith("IS ") ? "" : " " + quote(c.value))).join(" AND ") : "";
  if (payload.operation === "search") return "SELECT * FROM " + t + where + " ORDER BY " + (primary[table] ? '"' + primary[table] + '"' : "1") + " LIMIT 200;";
  if (payload.operation === "delete") return "DELETE FROM " + t + where + ";";
  const values = payload.values || {};
  if (!values || typeof values !== "object" || Array.isArray(values) || !Object.keys(values).length) throw new Error("Provide at least one field value.");
  for (const key of Object.keys(values)) if (!schema[table].includes(key)) throw new Error("Unknown field name.");
  if (payload.operation === "insert") return "INSERT INTO " + t + " (" + Object.keys(values).map(k => '"' + k + '"').join(", ") + ") VALUES (" + Object.values(values).map(quote).join(", ") + ");";
  if (payload.operation === "update") return "UPDATE " + t + " SET " + Object.entries(values).map(([k, v]) => '"' + k + '" = ' + quote(v)).join(", ") + where + ";";
  throw new Error("Unsupported operation.");
}
async function reports(db) {
  const [users, organizers, events, registrations, payments, venues] = await Promise.all([
    db.from("Users").select("Roll_No", { count: "exact", head: true }),
    db.from("Organizers").select("Organizer_ID", { count: "exact", head: true }),
    db.from("Events").select("*"),
    db.from("Registrations").select("Event_ID"),
    db.from("Payments").select("Amount"),
    db.from("Venues").select("Venue_ID,Venue_Name")
  ]);
  for (const result of [users, organizers, events, registrations, payments, venues]) if (result.error) throw result.error;
  const counts = {};
  for (const r of registrations.data) counts[r.Event_ID] = (counts[r.Event_ID] || 0) + 1;
  const categoryMap = {};
  for (const e of events.data) {
    const item = categoryMap[e.Category] || (categoryMap[e.Category] = { Category: e.Category, Event_Count: 0, cap: 0 });
    item.Event_Count++; item.cap += Number(e.Event_Capacity);
  }
  const venueMap = Object.fromEntries(venues.data.map(v => [v.Venue_ID, v.Venue_Name]));
  const popular = events.data.filter(e => counts[e.Event_ID]).map(e => ({
    Event_Name: e.Event_Name, Event_Date: e.Event_Date, Venue_Name: venueMap[e.Venue_ID] || "",
    Registrations: counts[e.Event_ID]
  })).sort((a,b) => b.Registrations - a.Registrations || String(a.Event_Date).localeCompare(String(b.Event_Date))).slice(0,10);
  return {
    summary: { Students: users.count, Events: events.data.length, Organizers: organizers.count,
      Registrations: registrations.data.length, Payments_Total: payments.data.reduce((s,p) => s + Number(p.Amount || 0), 0) },
    categories: Object.values(categoryMap).map(x => ({ Category: x.Category, Event_Count: x.Event_Count,
      Avg_Capacity: Math.round(x.cap / x.Event_Count * 10) / 10 })).sort((a,b) => b.Event_Count-a.Event_Count || a.Category.localeCompare(b.Category)),
    popular
  };
}

module.exports = async function handler(req, res) {
  if (!authorized(req)) return send(res, 401, { error: "Enter the app password configured by the project owner." });
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return send(res, 503, { error: "Supabase environment variables are not configured in Vercel." });
  const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const path = new URL(req.url, "http://localhost").pathname.replace(/^\/api\/?/, "");
  try {
    if (req.method === "GET" && path === "schema") return send(res, 200, metadata);
    if (req.method === "GET" && path === "rows") {
      const table = checkedTable(getTable(req));
      let q = db.from(table).select("*").limit(100);
      if (primary[table]) q = q.order(primary[table], { ascending: false });
      const { data, error } = await q;
      if (error) throw error;
      return send(res, 200, data);
    }
    if (req.method === "GET" && path === "reports") return send(res, 200, await reports(db));
    if (req.method !== "POST") return send(res, 405, { error: "Method not allowed." });
    const payload = req.body || {};
    const table = checkedTable(payload.table);
    const conditions = conditionList(payload, table);
    const shown = preview(payload, table, conditions);
    if (path === "preview") return send(res, 200, { sql: shown });
    if (path !== "execute") return send(res, 404, { error: "Not found." });
    let result;
    if (payload.operation === "search") {
      let q = addFilters(db.from(table).select("*").limit(200), conditions);
      if (primary[table]) q = q.order(primary[table], { ascending: false });
      result = await q;
      if (result.error) throw result.error;
      return send(res, 200, { sql: shown, rows: result.data, count: result.data.length });
    }
    if (["update", "delete"].includes(payload.operation) && !conditions.length) throw new Error("Add at least one WHERE condition before updating or deleting.");
    if (payload.operation === "insert") {
      const values = payload.values || {};
      for (const key of Object.keys(values)) if (!schema[table].includes(key)) throw new Error("Unknown field name.");
      result = await db.from(table).insert(values).select();
    } else if (payload.operation === "update") {
      result = await addFilters(db.from(table).update(payload.values || {}).select(), conditions);
    } else if (payload.operation === "delete") {
      result = await addFilters(db.from(table).delete().select(), conditions);
    } else throw new Error("Unsupported operation.");
    if (result.error) throw result.error;
    return send(res, 200, { sql: shown, affected: (result.data || []).length });
  } catch (error) {
    return send(res, 400, { error: error.message || "Request failed." });
  }
};

