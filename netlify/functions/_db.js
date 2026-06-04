const { neon } = require("@neondatabase/serverless");

let _sql;
function getSQL() {
  if (!_sql) _sql = neon(process.env.DATABASE_URL);
  return _sql;
}

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
  "Content-Type": "application/json",
};

function ok(data) { return { statusCode: 200, headers: cors, body: JSON.stringify(data) }; }
function err(msg, code = 500) { return { statusCode: code, headers: cors, body: JSON.stringify({ error: msg }) }; }
function options() { return { statusCode: 200, headers: cors, body: "" }; }

module.exports = { getSQL, cors, ok, err, options };
