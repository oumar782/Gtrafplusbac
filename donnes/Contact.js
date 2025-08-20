import { Router } from 'express';
import pool from '../db.js';

const contactsRouter = Router();

// Middleware pour gérer les erreurs async
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

// ===== COUNT - Nombre total de contacts =====
contactsRouter.get('/count', asyncHandler(async (req, res) => {
  try {
    const result = await pool.query('SELECT COUNT(*) FROM contacts');
    res.json({ count: parseInt(result.rows[0].count) });
  } catch (error) {
    console.error('Error counting contacts:', error);
    res.status(500).json({ error: 'Erreur lors du comptage des contacts' });
  }
}));

// ===== CREATE - Ajouter un contact =====
contactsRouter.post('/', asyncHandler(async (req, res) => {
  const { nom, email, telephone, project_type, budget, message } = req.body;

  if (!nom || !email || !project_type || !message) {
    return res.status(400).json({ error: 'nom, email, project_type et message sont obligatoires' });
  }

  const result = await pool.query(
    `INSERT INTO contacts (nom, email, telephone, project_type, budget, message) 
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [nom.trim(), email.trim(), telephone?.trim() || null, project_type.trim(), budget?.trim() || null, message.trim()]
  );

  res.status(201).json(result.rows[0]);
}));

// ===== READ - Tous les contacts avec pagination et filtres =====
contactsRouter.get('/', asyncHandler(async (req, res) => {
  const { page = 1, limit = 10, search, sortBy = 'date_creation', order = 'DESC' } = req.query;

  const pageNum = Math.max(1, parseInt(page));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
  const offset = (pageNum - 1) * limitNum;

  const allowedSortColumns = ['id', 'nom', 'email', 'telephone', 'project_type', 'budget', 'date_creation'];
  const sortColumn = allowedSortColumns.includes(sortBy) ? sortBy : 'date_creation';
  const sortOrder = order.toUpperCase() === 'DESC' ? 'DESC' : 'ASC';

  let query = 'SELECT * FROM contacts';
  let countQuery = 'SELECT COUNT(*) FROM contacts';
  const params = [];

  if (search) {
    const searchCondition = ' WHERE nom ILIKE $1 OR email ILIKE $1 OR telephone ILIKE $1 OR project_type ILIKE $1 OR message ILIKE $1';
    query += searchCondition;
    countQuery += searchCondition;
    params.push(`%${search}%`);
  }

  query += ` ORDER BY ${sortColumn} ${sortOrder} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
  params.push(limitNum, offset);

  const [result, countResult] = await Promise.all([
    pool.query(query, params),
    pool.query(countQuery, search ? [`%${search}%`] : [])
  ]);

  const total = parseInt(countResult.rows[0].count);
  const totalPages = Math.ceil(total / limitNum);

  res.json({
    data: result.rows,
    pagination: {
      page: pageNum,
      limit: limitNum,
      total,
      totalPages,
      hasNext: pageNum < totalPages,
      hasPrev: pageNum > 1
    }
  });
}));

// ===== READ - Contact par ID =====
contactsRouter.get('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!id || isNaN(parseInt(id))) return res.status(400).json({ error: 'ID invalide' });

  const result = await pool.query('SELECT * FROM contacts WHERE id=$1', [id]);
  if (result.rows.length === 0) return res.status(404).json({ error: 'Contact non trouvé' });

  res.json(result.rows[0]);
}));

// ===== UPDATE - Modifier un contact complet =====
contactsRouter.put('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { nom, email, telephone, project_type, budget, message } = req.body;

  if (!id || isNaN(parseInt(id))) return res.status(400).json({ error: 'ID invalide' });
  if (!nom || !email || !project_type || !message) {
    return res.status(400).json({ error: 'nom, email, project_type et message sont obligatoires' });
  }

  const result = await pool.query(
    `UPDATE contacts 
     SET nom=$1, email=$2, telephone=$3, project_type=$4, budget=$5, message=$6
     WHERE id=$7 RETURNING *`,
    [nom.trim(), email.trim(), telephone?.trim() || null, project_type.trim(), budget?.trim() || null, message.trim(), id]
  );

  if (result.rows.length === 0) return res.status(404).json({ error: 'Contact non trouvé' });

  res.json(result.rows[0]);
}));

// ===== PATCH - Modification partielle =====
contactsRouter.patch('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const updates = req.body;

  if (!id || isNaN(parseInt(id))) return res.status(400).json({ error: 'ID invalide' });
  if (!updates || Object.keys(updates).length === 0) return res.status(400).json({ error: 'Aucun champ à modifier' });

  const allowedFields = ['nom', 'email', 'telephone', 'project_type', 'budget', 'message'];
  const fieldsToUpdate = Object.keys(updates).filter(key => allowedFields.includes(key));
  if (fieldsToUpdate.length === 0) return res.status(400).json({ error: 'Aucun champ valide à modifier' });

  const setClause = fieldsToUpdate.map((f, i) => `${f}=$${i+1}`).join(', ');
  const values = fieldsToUpdate.map(f => updates[f]);
  values.push(id);

  const result = await pool.query(`UPDATE contacts SET ${setClause} WHERE id=$${values.length} RETURNING *`, values);
  if (result.rows.length === 0) return res.status(404).json({ error: 'Contact non trouvé' });

  res.json(result.rows[0]);
}));

// ===== DELETE - Supprimer un contact =====
contactsRouter.delete('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!id || isNaN(parseInt(id))) return res.status(400).json({ error: 'ID invalide' });

  const result = await pool.query('DELETE FROM contacts WHERE id=$1 RETURNING *', [id]);
  if (result.rows.length === 0) return res.status(404).json({ error: 'Contact non trouvé' });

  res.json({ message: 'Contact supprimé avec succès', deletedContact: result.rows[0] });
}));

// ===== DELETE - Suppression multiple =====
contactsRouter.delete('/', asyncHandler(async (req, res) => {
  const { ids } = req.body;
  if (!ids || !Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'Liste d\'IDs requise' });

  const validIds = ids.filter(id => !isNaN(parseInt(id)));
  if (validIds.length === 0) return res.status(400).json({ error: 'Aucun ID valide fourni' });

  const placeholders = validIds.map((_, i) => `$${i+1}`).join(', ');
  const result = await pool.query(`DELETE FROM contacts WHERE id IN (${placeholders}) RETURNING *`, validIds);

  res.json({ message: `${result.rows.length} contact(s) supprimé(s)`, deletedContacts: result.rows });
}));

// Middleware global pour les erreurs du router
contactsRouter.use((error, req, res, next) => {
  console.error('Erreur dans contactsRouter:', error);
  if (error.code === '23505') return res.status(409).json({ error: 'Conflit de données' });
  if (['XX000', '08006', '08003'].includes(error.code)) return res.status(503).json({ error: 'Problème BDD, réessayez plus tard' });
  res.status(500).json({ error: 'Erreur interne du serveur' });
});

export default contactsRouter;