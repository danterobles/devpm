const escapeLike = (s) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

// camelCase (API) → columna. Lista cerrada: nunca se interpolan claves del usuario.
const COLUMNS = {
  type: 'type',
  name: 'name',
  contactName: 'contact_name',
  contactEmail: 'contact_email',
  contactPhone: 'contact_phone',
  department: 'department',
  costCenter: 'cost_center',
  legalName: 'legal_name',
  taxId: 'tax_id',
  hourlyRateCents: 'hourly_rate_cents',
  currency: 'currency',
  address: 'address',
  isActive: 'is_active',
  notes: 'notes',
};

const toDb = (v) => (typeof v === 'boolean' ? Number(v) : v);

export function createClientsRepository(db) {
  const byId = db.prepare('SELECT * FROM clients WHERE id = ?');
  const byTaxId = db.prepare('SELECT id FROM clients WHERE tax_id = ?');

  return {
    findById: (id) => byId.get(id),
    findIdByTaxId: (taxId) => byTaxId.get(taxId)?.id ?? null,

    list({ q, status, type, page, pageSize }) {
      const where = [];
      const params = {};
      if (q) {
        where.push(
          `(name LIKE @q ESCAPE '\\' OR legal_name LIKE @q ESCAPE '\\' OR department LIKE @q ESCAPE '\\'
            OR contact_name LIKE @q ESCAPE '\\' OR tax_id LIKE @q ESCAPE '\\')`,
        );
        params.q = `%${escapeLike(q)}%`;
      }
      if (status !== 'all') {
        where.push('is_active = @active');
        params.active = status === 'active' ? 1 : 0;
      }
      if (type !== 'all') {
        where.push('type = @type');
        params.type = type;
      }
      const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const total = db.prepare(`SELECT count(*) FROM clients ${clause}`).pluck().get(params);
      const rows = db
        .prepare(
          `SELECT * FROM clients ${clause}
            ORDER BY name COLLATE NOCASE, id LIMIT @limit OFFSET @offset`,
        )
        .all({ ...params, limit: pageSize, offset: (page - 1) * pageSize });
      return { rows, total };
    },

    insert(fields) {
      const keys = Object.keys(COLUMNS).filter((k) => fields[k] !== undefined);
      const sql = `INSERT INTO clients (${keys.map((k) => COLUMNS[k]).join(', ')})
                   VALUES (${keys.map((k) => `@${k}`).join(', ')})`;
      const params = Object.fromEntries(keys.map((k) => [k, toDb(fields[k])]));
      return Number(db.prepare(sql).run(params).lastInsertRowid);
    },

    update(id, fields) {
      const keys = Object.keys(COLUMNS).filter((k) => fields[k] !== undefined);
      const sets = keys.map((k) => `${COLUMNS[k]} = @${k}`);
      sets.push("updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')");
      const params = { id, ...Object.fromEntries(keys.map((k) => [k, toDb(fields[k])])) };
      db.prepare(`UPDATE clients SET ${sets.join(', ')} WHERE id = @id`).run(params);
    },
  };
}
