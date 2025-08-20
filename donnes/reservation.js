import { Router } from 'express';
import pool from '../db.js';

const reservationsRouter = Router();

// Middleware async pour gérer les erreurs
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

// ===== COUNT - Nombre total de réservations =====
reservationsRouter.get('/count', asyncHandler(async (req, res) => {
  try {
    const result = await pool.query('SELECT COUNT(*) FROM reservations_voitures');
    res.json({ count: parseInt(result.rows[0].count) });
  } catch (error) {
    console.error('Error counting reservations:', error);
    res.status(500).json({ error: 'Erreur lors du comptage des réservations' });
  }
}));

// ===== CREATE - Ajouter une réservation =====
reservationsRouter.post('/', asyncHandler(async (req, res) => {
  const {
    nom_client,
    email,
    telephone,
    type_modele_voiture,
    date_heure_depart,
    date_heure_retour,
    lieu_prise_en_charge,
    lieu_restitution,
    options,
    commentaires
  } = req.body;

  if (!nom_client || !email || !telephone || !type_modele_voiture || 
      !date_heure_depart || !date_heure_retour || !lieu_prise_en_charge || !lieu_restitution) {
    return res.status(400).json({ error: 'Champs obligatoires manquants' });
  }

  const result = await pool.query(
    `INSERT INTO reservations_voitures
    (nom_client, email, telephone, type_modele_voiture, date_heure_depart, 
     date_heure_retour, lieu_prise_en_charge, lieu_restitution, options, commentaires)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
    [
      nom_client, 
      email, 
      telephone,
      type_modele_voiture, 
      date_heure_depart, 
      date_heure_retour, 
      lieu_prise_en_charge, 
      lieu_restitution, 
      options || [], 
      commentaires || null
    ]
  );

  res.status(201).json(result.rows[0]);
}));

// ===== READ - Toutes les réservations =====
reservationsRouter.get('/', asyncHandler(async (req, res) => {
  const { page = 1, limit = 10, search, sortBy = 'id', order = 'ASC' } = req.query;
  const pageNum = Math.max(1, parseInt(page));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
  const offset = (pageNum - 1) * limitNum;

  const allowedSortColumns = ['id', 'nom_client', 'email', 'telephone', 'type_modele_voiture', 'date_heure_depart'];
  const sortColumn = allowedSortColumns.includes(sortBy) ? sortBy : 'id';
  const sortOrder = order.toUpperCase() === 'DESC' ? 'DESC' : 'ASC';

  let query = 'SELECT * FROM reservations_voitures';
  let countQuery = 'SELECT COUNT(*) FROM reservations_voitures';
  const params = [];

  if (search) {
    const searchCondition = ' WHERE nom_client ILIKE $1 OR email ILIKE $1 OR type_modele_voiture ILIKE $1 OR lieu_prise_en_charge ILIKE $1';
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

// ===== READ - Une réservation par ID =====
reservationsRouter.get('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!id || isNaN(parseInt(id))) return res.status(400).json({ error: 'ID invalide' });

  const result = await pool.query('SELECT * FROM reservations_voitures WHERE id=$1', [id]);
  if (result.rows.length === 0) return res.status(404).json({ error: 'Réservation non trouvée' });

  res.json(result.rows[0]);
}));

// ===== UPDATE - Modifier une réservation complète =====
reservationsRouter.put('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const updates = req.body;

  if (!id || isNaN(parseInt(id))) return res.status(400).json({ error: 'ID invalide' });
  const requiredFields = ['nom_client', 'email', 'telephone', 'type_modele_voiture',
                         'date_heure_depart', 'date_heure_retour', 'lieu_prise_en_charge', 'lieu_restitution'];
  for (let field of requiredFields) {
    if (!updates[field]) return res.status(400).json({ error: `Champ obligatoire manquant: ${field}` });
  }

  const result = await pool.query(
    `UPDATE reservations_voitures SET
    nom_client=$1, email=$2, telephone=$3, type_modele_voiture=$4, 
    date_heure_depart=$5, date_heure_retour=$6, lieu_prise_en_charge=$7, 
    lieu_restitution=$8, options=$9, commentaires=$10
    WHERE id=$11 RETURNING *`,
    [
      updates.nom_client,
      updates.email,
      updates.telephone,
      updates.type_modele_voiture,
      updates.date_heure_depart,
      updates.date_heure_retour,
      updates.lieu_prise_en_charge,
      updates.lieu_restitution,
      updates.options || [],
      updates.commentaires || null,
      id
    ]
  );

  if (result.rows.length === 0) return res.status(404).json({ error: 'Réservation non trouvée' });

  res.json(result.rows[0]);
}));

// ===== PATCH - Modification partielle =====
reservationsRouter.patch('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const updates = req.body;
  if (!id || isNaN(parseInt(id))) return res.status(400).json({ error: 'ID invalide' });
  if (!updates || Object.keys(updates).length === 0) return res.status(400).json({ error: 'Aucun champ à modifier' });

  const allowedFields = ['nom_client', 'email', 'telephone', 'type_modele_voiture',
                        'date_heure_depart', 'date_heure_retour', 'lieu_prise_en_charge', 
                        'lieu_restitution', 'options', 'commentaires'];
  const fieldsToUpdate = Object.keys(updates).filter(f => allowedFields.includes(f));
  if (fieldsToUpdate.length === 0) return res.status(400).json({ error: 'Aucun champ valide à modifier' });

  const setClause = fieldsToUpdate.map((f, i) => `${f}=$${i+1}`).join(', ');
  const values = fieldsToUpdate.map(f => updates[f]);
  values.push(id);

  const result = await pool.query(`UPDATE reservations_voitures SET ${setClause} WHERE id=$${values.length} RETURNING *`, values);
  if (result.rows.length === 0) return res.status(404).json({ error: 'Réservation non trouvée' });

  res.json(result.rows[0]);
}));

// ===== DELETE - Supprimer une réservation =====
reservationsRouter.delete('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!id || isNaN(parseInt(id))) return res.status(400).json({ error: 'ID invalide' });

  const result = await pool.query('DELETE FROM reservations_voitures WHERE id=$1 RETURNING *', [id]);
  if (result.rows.length === 0) return res.status(404).json({ error: 'Réservation non trouvée' });

  res.json({ message: 'Réservation supprimée', deletedReservation: result.rows[0] });
}));

// ===== DELETE - Suppression multiple =====
reservationsRouter.delete('/', asyncHandler(async (req, res) => {
  const { ids } = req.body;
  if (!ids || !Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'Liste d\'IDs requise' });

  const validIds = ids.filter(id => !isNaN(parseInt(id)));
  if (validIds.length === 0) return res.status(400).json({ error: 'Aucun ID valide fourni' });

  const placeholders = validIds.map((_, i) => `$${i+1}`).join(', ');
  const result = await pool.query(`DELETE FROM reservations_voitures WHERE id IN (${placeholders}) RETURNING *`, validIds);

  res.json({ message: `${result.rows.length} réservation(s) supprimée(s)`, deletedReservations: result.rows });
}));

// Middleware global pour erreurs
reservationsRouter.use((error, req, res, next) => {
  console.error('Erreur dans reservationsRouter:', error);
  res.status(500).json({ error: 'Erreur interne du serveur' });
});

export default reservationsRouter;