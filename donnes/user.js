import { Router } from 'express';
import pool from '../db.js';

const router = Router();

// Middleware async
const asyncHandler = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ===== CREATE =====
router.post('/', asyncHandler(async (req, res) => {
  const { nom_prenom, email, telephone, mot_de_passe } = req.body;

  if (!nom_prenom || !email || !mot_de_passe) {
    return res.status(400).json({ error: 'nom_prenom, email et mot_de_passe sont obligatoires' });
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) return res.status(400).json({ error: 'Format email invalide' });

  if (mot_de_passe.length < 6) {
    return res.status(400).json({ error: 'Le mot de passe doit contenir au moins 6 caractères' });
  }

  // Stocker le mot de passe en clair
  const result = await pool.query(
    'INSERT INTO utilisateurs (nom_prenom, email, telephone, mot_de_passe) VALUES ($1, $2, $3, $4) RETURNING id, nom_prenom, email, telephone',
    [nom_prenom.trim(), email.toLowerCase().trim(), telephone?.trim() || null, mot_de_passe]
  );

  res.status(201).json(result.rows[0]);
}));

// ===== READ - tous utilisateurs =====
router.get('/', asyncHandler(async (req, res) => {
  const { page = 1, limit = 10, search, sortBy = 'id', order = 'ASC' } = req.query;

  const pageNum = Math.max(1, parseInt(page));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
  const offset = (pageNum - 1) * limitNum;

  const allowedSortColumns = ['id', 'nom_prenom', 'email', 'telephone'];
  const sortColumn = allowedSortColumns.includes(sortBy) ? sortBy : 'id';
  const sortOrder = order.toUpperCase() === 'DESC' ? 'DESC' : 'ASC';

  let query = 'SELECT id, nom_prenom, email, telephone FROM utilisateurs';
  let countQuery = 'SELECT COUNT(*) FROM utilisateurs';
  const params = [];

  if (search) {
    const condition = ' WHERE nom_prenom ILIKE $1 OR email ILIKE $1';
    query += condition;
    countQuery += condition;
    params.push(`%${search}%`);
  }

  query += ` ORDER BY ${sortColumn} ${sortOrder} LIMIT $${params.length+1} OFFSET $${params.length+2}`;
  params.push(limitNum, offset);

  const [result, countResult] = await Promise.all([
    pool.query(query, params),
    pool.query(countQuery, search ? [`%${search}%`] : [])
  ]);

  const total = parseInt(countResult.rows[0].count);
  const totalPages = Math.ceil(total / limitNum);

  res.json({
    data: result.rows,
    pagination: { page: pageNum, limit: limitNum, total, totalPages, hasNext: pageNum < totalPages, hasPrev: pageNum > 1 }
  });
}));

// ===== READ - utilisateur par ID =====
router.get('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!id || isNaN(parseInt(id))) return res.status(400).json({ error: 'ID invalide' });

  const result = await pool.query(
    'SELECT id, nom_prenom, email, telephone FROM utilisateurs WHERE id=$1',
    [id]
  );
  if (result.rows.length === 0) return res.status(404).json({ error: 'Utilisateur non trouvé' });

  res.json(result.rows[0]);
}));

// ===== READ - par email =====
router.get('/email/:email', asyncHandler(async (req, res) => {
  const { email } = req.params;
  if (!email) return res.status(400).json({ error: 'Email requis' });

  const result = await pool.query(
    'SELECT id, nom_prenom, email, telephone FROM utilisateurs WHERE email=$1',
    [email.toLowerCase()]
  );
  if (result.rows.length === 0) return res.status(404).json({ error: 'Utilisateur non trouvé' });

  res.json(result.rows[0]);
}));

// ===== UPDATE complet =====
router.put('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { nom_prenom, email, telephone, mot_de_passe } = req.body;

  if (!id || isNaN(parseInt(id))) return res.status(400).json({ error: 'ID invalide' });
  if (!nom_prenom || !email) return res.status(400).json({ error: 'nom_prenom et email sont obligatoires' });

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) return res.status(400).json({ error: 'Format email invalide' });

  let query;
  let values;

  if (mot_de_passe) {
    if (mot_de_passe.length < 6) {
      return res.status(400).json({ error: 'Le mot de passe doit contenir au moins 6 caractères' });
    }
    query = 'UPDATE utilisateurs SET nom_prenom=$1, email=$2, telephone=$3, mot_de_passe=$4 WHERE id=$5 RETURNING id, nom_prenom, email, telephone';
    values = [nom_prenom.trim(), email.toLowerCase().trim(), telephone?.trim() || null, mot_de_passe, id];
  } else {
    query = 'UPDATE utilisateurs SET nom_prenom=$1, email=$2, telephone=$3 WHERE id=$4 RETURNING id, nom_prenom, email, telephone';
    values = [nom_prenom.trim(), email.toLowerCase().trim(), telephone?.trim() || null, id];
  }

  const result = await pool.query(query, values);
  if (result.rows.length === 0) return res.status(404).json({ error: 'Utilisateur non trouvé' });

  res.json(result.rows[0]);
}));

// ===== PATCH =====
router.patch('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const updates = req.body;

  if (!id || isNaN(parseInt(id))) return res.status(400).json({ error: 'ID invalide' });
  if (!updates || Object.keys(updates).length === 0) return res.status(400).json({ error: 'Aucun champ à modifier' });

  const allowed = ['nom_prenom', 'email', 'telephone', 'mot_de_passe'];
  const fields = Object.keys(updates).filter(f => allowed.includes(f));
  if (fields.length === 0) return res.status(400).json({ error: 'Aucun champ valide à modifier' });

  if (updates.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(updates.email)) {
    return res.status(400).json({ error: 'Format email invalide' });
  }

  if (updates.mot_de_passe && updates.mot_de_passe.length < 6) {
    return res.status(400).json({ error: 'Le mot de passe doit contenir au moins 6 caractères' });
  }

  const setValues = [];
  const queryValues = [];
  let valueIndex = 1;

  for (const field of fields) {
    if (field === 'email') {
      setValues.push(`email=$${valueIndex}`);
      queryValues.push(updates[field].toLowerCase().trim());
    } else {
      setValues.push(`${field}=$${valueIndex}`);
      queryValues.push(updates[field]?.trim() || null);
    }
    valueIndex++;
  }

  queryValues.push(id);
  const setClause = setValues.join(', ');

  const result = await pool.query(
    `UPDATE utilisateurs SET ${setClause} WHERE id=$${valueIndex} RETURNING id, nom_prenom, email, telephone`,
    queryValues
  );

  if (result.rows.length === 0) return res.status(404).json({ error: 'Utilisateur non trouvé' });

  res.json(result.rows[0]);
}));

// ===== DELETE simple =====
router.delete('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!id || isNaN(parseInt(id))) return res.status(400).json({ error: 'ID invalide' });

  const result = await pool.query(
    'DELETE FROM utilisateurs WHERE id=$1 RETURNING id, nom_prenom, email, telephone',
    [id]
  );
  if (result.rows.length === 0) return res.status(404).json({ error: 'Utilisateur non trouvé' });

  res.json({ message: 'Utilisateur supprimé avec succès', deletedUser: result.rows[0] });
}));

// ===== DELETE multiple =====
router.delete('/', asyncHandler(async (req, res) => {
  const { ids } = req.body;
  if (!ids || !Array.isArray(ids) || ids.length===0) return res.status(400).json({ error: 'Liste d\'IDs requise' });

  const validIds = ids.filter(i => !isNaN(parseInt(i)));
  if (validIds.length===0) return res.status(400).json({ error: 'Aucun ID valide fourni' });

  const placeholders = validIds.map((_, i)=>`$${i+1}`).join(',');
  const result = await pool.query(
    `DELETE FROM utilisateurs WHERE id IN (${placeholders}) RETURNING id, nom_prenom, email, telephone`,
    validIds
  );

  res.json({ message: `${result.rows.length} utilisateur(s) supprimé(s)`, deletedUsers: result.rows });
}));

// ===== Stats =====
router.get('/stats/summary', asyncHandler(async (req, res) => {
  const [total, withPhone] = await Promise.all([
    pool.query('SELECT COUNT(*) AS total FROM utilisateurs'),
    pool.query('SELECT COUNT(*) AS with_phone FROM utilisateurs WHERE telephone IS NOT NULL AND telephone !=\'\'')
  ]);

  res.json({
    total: parseInt(total.rows[0].total),
    withPhone: parseInt(withPhone.rows[0].with_phone),
    withoutPhone: parseInt(total.rows[0].total)-parseInt(withPhone.rows[0].with_phone)
  });
}));

// ===== Login endpoint =====
router.post('/login', asyncHandler(async (req, res) => {
  const { email, mot_de_passe } = req.body;

  if (!email || !mot_de_passe) {
    return res.status(400).json({ error: 'Email et mot de passe requis' });
  }

  // Récupérer l'utilisateur
  const result = await pool.query(
    'SELECT * FROM utilisateurs WHERE email=$1',
    [email.toLowerCase().trim()]
  );

  if (result.rows.length === 0) {
    return res.status(401).json({ error: 'Email ou mot de passe incorrect' });
  }

  const user = result.rows[0];

  // Comparaison directe des mots de passe en clair
  if (mot_de_passe !== user.mot_de_passe) {
    return res.status(401).json({ error: 'Email ou mot de passe incorrect' });
  }

  // Ne pas renvoyer le mot de passe
  const { mot_de_passe: _, ...userWithoutPassword } = user;
  res.json({ message: 'Connexion réussie', user: userWithoutPassword });
}));

// ===== Vérifier si email existe =====
router.get('/check-email/:email', asyncHandler(async (req, res) => {
  const { email } = req.params;
  if (!email) return res.status(400).json({ error: 'Email requis' });

  const result = await pool.query(
    'SELECT EXISTS(SELECT 1 FROM utilisateurs WHERE email=$1) AS email_exists',
    [email.toLowerCase()]
  );

  res.json({ emailExists: result.rows[0].email_exists });
}));

// Middleware erreurs
router.use((err, req, res, next) => {
  console.error('Erreur userRouter:', err);

  if (err.code==='23505') return res.status(409).json({ error: 'Cet email existe déjà' });
  if (['XX000','08006','08003'].includes(err.code)) return res.status(503).json({ error: 'Problème DB, réessayez plus tard' });

  res.status(500).json({ error: 'Erreur interne du serveur' });
});

export default router;