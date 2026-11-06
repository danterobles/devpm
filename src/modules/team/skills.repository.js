export function createSkillsRepository(db) {
  const list = db.prepare(
    `SELECT s.id AS skill_id, s.name, s.category, ms.level
       FROM team_member_skills ms JOIN skills s ON s.id = ms.skill_id
      WHERE ms.team_member_id = ?
      ORDER BY s.name COLLATE NOCASE`,
  );
  const one = db.prepare(
    `SELECT s.id AS skill_id, s.name, s.category, ms.level
       FROM team_member_skills ms JOIN skills s ON s.id = ms.skill_id
      WHERE ms.team_member_id = ? AND ms.skill_id = ?`,
  );
  const byName = db.prepare('SELECT id FROM skills WHERE name = ?');
  const insertSkill = db.prepare('INSERT INTO skills (name, category) VALUES (?, ?)');
  const upsert = db.prepare(
    `INSERT INTO team_member_skills (team_member_id, skill_id, level) VALUES (?, ?, ?)
     ON CONFLICT(team_member_id, skill_id) DO UPDATE SET level = excluded.level`,
  );
  const remove = db.prepare(
    'DELETE FROM team_member_skills WHERE team_member_id = ? AND skill_id = ?',
  );
  const memberExists = db.prepare('SELECT 1 FROM team_members WHERE id = ?');

  return {
    memberExists: (id) => Boolean(memberExists.get(id)),
    listByMember: (memberId) => list.all(memberId),
    findAssigned: (memberId, skillId) => one.get(memberId, skillId),
    findSkillIdByName: (name) => byName.get(name)?.id ?? null,
    insertSkill: (name, category) => Number(insertSkill.run(name, category).lastInsertRowid),
    setLevel: (memberId, skillId, level) => upsert.run(memberId, skillId, level),
    unassign: (memberId, skillId) => remove.run(memberId, skillId).changes,
  };
}
