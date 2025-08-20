import { Router } from 'express';
import pool from '../db.js';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const portfoliosRouter = Router();

// Configuration multer pour l'upload d'images
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadPath = path.join(__dirname, '../../uploads/portfolio');
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
    }
    cb(null, uploadPath);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'portfolio-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const fileFilter = (req, file, cb) => {
  const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Type de fichier non autorisé. Utilisez: JPEG, PNG, GIF, WEBP'), false);
  }
};

const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB max
  }
});

// Middleware pour gérer les erreurs async avec gestion de reconnexion
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(async (error) => {
    // Gestion des erreurs de connexion DB
    if (error.code === 'XX000' || error.code === '08006' || error.code === '08003' || 
        error.message?.includes('db_termination') || error.message?.includes('shutdown')) {
      console.error('Erreur de base de données détectée:', error.message);
      
      try {
        // Tentative de reconnexion
        await new Promise(resolve => setTimeout(resolve, 1000));
        const testQuery = await pool.query('SELECT 1');
        console.log('Reconnexion DB réussie');
      } catch (reconnectError) {
        console.error('Échec de reconnexion DB:', reconnectError.message);
        return res.status(503).json({ 
          error: 'Service de base de données temporairement indisponible. Veuillez réessayer dans quelques instants.' 
        });
      }
    }
    next(error);
  });
};

// Fonction utilitaire pour formater les arrays PostgreSQL
const formatArrayForPostgres = (value) => {
  if (!value) return null;
  
  if (Array.isArray(value)) {
    return value.length > 0 ? value.filter(v => v && v.trim()) : null;
  }
  
  if (typeof value === 'string') {
    const items = value.split(',').map(item => item.trim()).filter(item => item.length > 0);
    return items.length > 0 ? items : null;
  }
  
  return null;
};

// Fonction utilitaire pour convertir les arrays PostgreSQL
const formatArrayFromPostgres = (pgArray) => {
  if (!pgArray || !Array.isArray(pgArray)) return '';
  return pgArray.join(', ');
};

// ===== HEALTH CHECK =====
portfoliosRouter.get('/health', asyncHandler(async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'healthy', timestamp: new Date().toISOString() });
  } catch (error) {
    console.error('Health check failed:', error);
    res.status(503).json({ status: 'unhealthy', error: error.message });
  }
}));

// ===== UPLOAD IMAGE - Upload d'une image =====
portfoliosRouter.post('/upload', upload.single('image'), asyncHandler(async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Aucun fichier fourni' });
  }

  const imageUrl = `/uploads/portfolio/${req.file.filename}`;
  res.json({ 
    success: true, 
    imageUrl: imageUrl,
    originalName: req.file.originalname,
    size: req.file.size,
    fullPath: `http://localhost:5000${imageUrl}`
  });
}));

// ===== UPLOAD MULTIPLE IMAGES - Upload de plusieurs images =====
portfoliosRouter.post('/upload-multiple', upload.array('images', 10), asyncHandler(async (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: 'Aucun fichier fourni' });
  }

  const imageUrls = req.files.map(file => `/uploads/portfolio/${file.filename}`);
  res.json({ 
    success: true, 
    imageUrls: imageUrls,
    count: req.files.length,
    fullPaths: imageUrls.map(url => `http://localhost:5000${url}`)
  });
}));

// ===== COUNT - Nombre total de portfolios =====
portfoliosRouter.get('/count', asyncHandler(async (req, res) => {
  try {
    const result = await pool.query('SELECT COUNT(*) FROM portfolios');
    res.json({ count: parseInt(result.rows[0].count) });
  } catch (error) {
    console.error('Error counting portfolios:', error);
    if (error.code === 'XX000' || error.message?.includes('db_termination')) {
      return res.status(503).json({ error: 'Service temporairement indisponible' });
    }
    res.status(500).json({ error: 'Erreur lors du comptage des portfolios' });
  }
}));

// ===== CREATE - Ajouter un portfolio =====
portfoliosRouter.post('/', asyncHandler(async (req, res) => {
  const { 
    titre, 
    categorie, 
    localisation, 
    budget, 
    annee, 
    image_principale, 
    description, 
    technologies, 
    stats_surface, 
    stats_duree, 
    stats_equipe, 
    gallery_images 
  } = req.body;

  // Validation des champs obligatoires
  if (!titre?.trim()) {
    return res.status(400).json({ error: 'Le titre est obligatoire' });
  }
  if (!categorie?.trim()) {
    return res.status(400).json({ error: 'La catégorie est obligatoire' });
  }
  if (!image_principale?.trim()) {
    return res.status(400).json({ error: 'L\'image principale est obligatoire' });
  }
  if (!description?.trim()) {
    return res.status(400).json({ error: 'La description est obligatoire' });
  }

  try {
    // Formater les arrays pour PostgreSQL
    const formattedTechnologies = formatArrayForPostgres(technologies);
    const formattedGalleryImages = formatArrayForPostgres(gallery_images);

    const result = await pool.query(
      `INSERT INTO portfolios 
        (titre, categorie, localisation, budget, annee, image_principale, description, technologies, stats_surface, stats_duree, stats_equipe, gallery_images, date_creation)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,CURRENT_TIMESTAMP) RETURNING *`,
      [
        titre.trim(),
        categorie.trim(),
        localisation?.trim() || null,
        budget?.trim() || null,
        annee ? parseInt(annee) : null,
        image_principale.trim(),
        description.trim(),
        formattedTechnologies,
        stats_surface?.trim() || null,
        stats_duree?.trim() || null,
        stats_equipe?.trim() || null,
        formattedGalleryImages
      ]
    );

    // Reformater les arrays pour la réponse
    const portfolio = { ...result.rows[0] };
    if (portfolio.technologies && Array.isArray(portfolio.technologies)) {
      portfolio.technologies = formatArrayFromPostgres(portfolio.technologies);
    }
    if (portfolio.gallery_images && Array.isArray(portfolio.gallery_images)) {
      portfolio.gallery_images = formatArrayFromPostgres(portfolio.gallery_images);
    }

    res.status(201).json(portfolio);
  } catch (error) {
    console.error('Error creating portfolio:', error);
    if (error.code === 'XX000' || error.message?.includes('db_termination')) {
      return res.status(503).json({ error: 'Service temporairement indisponible' });
    }
    if (error.code === '23505') {
      return res.status(409).json({ error: 'Un portfolio avec ce titre existe déjà' });
    }
    res.status(500).json({ error: 'Erreur lors de la création du portfolio' });
  }
}));

// ===== READ - Tous les portfolios avec pagination et filtre =====
portfoliosRouter.get('/', asyncHandler(async (req, res) => {
  const { page = 1, limit = 10, search, sortBy = 'date_creation', order = 'DESC' } = req.query;

  const pageNum = Math.max(1, parseInt(page));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
  const offset = (pageNum - 1) * limitNum;

  const allowedSortColumns = ['id', 'titre', 'categorie', 'date_creation', 'annee'];
  const sortColumn = allowedSortColumns.includes(sortBy) ? sortBy : 'date_creation';
  const sortOrder = order.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

  let query = 'SELECT * FROM portfolios';
  let countQuery = 'SELECT COUNT(*) FROM portfolios';
  const params = [];

  if (search?.trim()) {
    const searchCondition = ' WHERE titre ILIKE $1 OR categorie ILIKE $1 OR description ILIKE $1 OR localisation ILIKE $1';
    query += searchCondition;
    countQuery += searchCondition;
    params.push(`%${search.trim()}%`);
  }

  query += ` ORDER BY ${sortColumn} ${sortOrder} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
  params.push(limitNum, offset);

  try {
    const [result, countResult] = await Promise.all([
      pool.query(query, params),
      pool.query(countQuery, search?.trim() ? [`%${search.trim()}%`] : [])
    ]);

    // Reformater les arrays pour la réponse
    const portfolios = result.rows.map(portfolio => {
      const formattedPortfolio = { ...portfolio };
      if (formattedPortfolio.technologies && Array.isArray(formattedPortfolio.technologies)) {
        formattedPortfolio.technologies = formatArrayFromPostgres(formattedPortfolio.technologies);
      }
      if (formattedPortfolio.gallery_images && Array.isArray(formattedPortfolio.gallery_images)) {
        formattedPortfolio.gallery_images = formatArrayFromPostgres(formattedPortfolio.gallery_images);
      }
      return formattedPortfolio;
    });

    const total = parseInt(countResult.rows[0].count);
    const totalPages = Math.ceil(total / limitNum);

    res.json({
      success: true,
      data: portfolios,
      pagination: { 
        page: pageNum, 
        limit: limitNum, 
        total, 
        totalPages, 
        hasNext: pageNum < totalPages, 
        hasPrev: pageNum > 1 
      }
    });
  } catch (error) {
    console.error('Error fetching portfolios:', error);
    if (error.code === 'XX000' || error.message?.includes('db_termination')) {
      return res.status(503).json({ error: 'Service temporairement indisponible' });
    }
    res.status(500).json({ error: 'Erreur lors de la récupération des portfolios' });
  }
}));

// ===== READ - Portfolio par ID =====
portfoliosRouter.get('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!id || isNaN(parseInt(id))) {
    return res.status(400).json({ error: 'ID invalide' });
  }

  try {
    const result = await pool.query('SELECT * FROM portfolios WHERE id=$1', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Portfolio non trouvé' });
    }

    // Reformater les arrays pour la réponse
    const portfolio = { ...result.rows[0] };
    if (portfolio.technologies && Array.isArray(portfolio.technologies)) {
      portfolio.technologies = formatArrayFromPostgres(portfolio.technologies);
    }
    if (portfolio.gallery_images && Array.isArray(portfolio.gallery_images)) {
      portfolio.gallery_images = formatArrayFromPostgres(portfolio.gallery_images);
    }

    res.json({ success: true, data: portfolio });
  } catch (error) {
    console.error('Error fetching portfolio:', error);
    if (error.code === 'XX000' || error.message?.includes('db_termination')) {
      return res.status(503).json({ error: 'Service temporairement indisponible' });
    }
    res.status(500).json({ error: 'Erreur lors de la récupération du portfolio' });
  }
}));

// ===== UPDATE - Modifier un portfolio complet =====
portfoliosRouter.put('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const updates = req.body;

  if (!id || isNaN(parseInt(id))) {
    return res.status(400).json({ error: 'ID invalide' });
  }
  
  // Validation des champs obligatoires
  if (!updates.titre?.trim()) {
    return res.status(400).json({ error: 'Le titre est obligatoire' });
  }
  if (!updates.categorie?.trim()) {
    return res.status(400).json({ error: 'La catégorie est obligatoire' });
  }
  if (!updates.image_principale?.trim()) {
    return res.status(400).json({ error: 'L\'image principale est obligatoire' });
  }
  if (!updates.description?.trim()) {
    return res.status(400).json({ error: 'La description est obligatoire' });
  }

  try {
    // Formater les arrays pour PostgreSQL
    const formattedTechnologies = formatArrayForPostgres(updates.technologies);
    const formattedGalleryImages = formatArrayForPostgres(updates.gallery_images);

    const result = await pool.query(
      `UPDATE portfolios SET 
        titre=$1, categorie=$2, localisation=$3, budget=$4, annee=$5, 
        image_principale=$6, description=$7, technologies=$8, stats_surface=$9, 
        stats_duree=$10, stats_equipe=$11, gallery_images=$12
       WHERE id=$13 RETURNING *`,
      [
        updates.titre.trim(),
        updates.categorie.trim(),
        updates.localisation?.trim() || null,
        updates.budget?.trim() || null,
        updates.annee ? parseInt(updates.annee) : null,
        updates.image_principale.trim(),
        updates.description.trim(),
        formattedTechnologies,
        updates.stats_surface?.trim() || null,
        updates.stats_duree?.trim() || null,
        updates.stats_equipe?.trim() || null,
        formattedGalleryImages,
        id
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Portfolio non trouvé' });
    }

    // Reformater les arrays pour la réponse
    const portfolio = { ...result.rows[0] };
    if (portfolio.technologies && Array.isArray(portfolio.technologies)) {
      portfolio.technologies = formatArrayFromPostgres(portfolio.technologies);
    }
    if (portfolio.gallery_images && Array.isArray(portfolio.gallery_images)) {
      portfolio.gallery_images = formatArrayFromPostgres(portfolio.gallery_images);
    }

    res.json({ success: true, data: portfolio });
  } catch (error) {
    console.error('Error updating portfolio:', error);
    if (error.code === 'XX000' || error.message?.includes('db_termination')) {
      return res.status(503).json({ error: 'Service temporairement indisponible' });
    }
    if (error.code === '23505') {
      return res.status(409).json({ error: 'Un portfolio avec ce titre existe déjà' });
    }
    res.status(500).json({ error: 'Erreur lors de la modification du portfolio' });
  }
}));

// ===== PATCH - Modification partielle =====
portfoliosRouter.patch('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const updates = req.body;

  if (!id || isNaN(parseInt(id))) {
    return res.status(400).json({ error: 'ID invalide' });
  }
  if (!updates || Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'Aucun champ à modifier' });
  }

  const allowedFields = [
    'titre', 'categorie', 'localisation', 'budget', 'annee', 
    'image_principale', 'description', 'technologies', 'stats_surface', 
    'stats_duree', 'stats_equipe', 'gallery_images'
  ];
  
  const fieldsToUpdate = Object.keys(updates).filter(f => allowedFields.includes(f));
  if (fieldsToUpdate.length === 0) {
    return res.status(400).json({ error: 'Aucun champ valide à modifier' });
  }

  // Traiter les valeurs avant la mise à jour
  const processedValues = fieldsToUpdate.map(field => {
    let value = updates[field];
    
    // Formater les arrays
    if (field === 'technologies' || field === 'gallery_images') {
      return formatArrayForPostgres(value);
    }
    
    // Convertir l'année en nombre
    if (field === 'annee' && value) {
      return parseInt(value);
    }
    
    // Nettoyer les strings
    if (typeof value === 'string') {
      return value.trim() || null;
    }
    
    return value || null;
  });

  const setClause = fieldsToUpdate.map((f, i) => `${f}=$${i + 1}`).join(', ');
  processedValues.push(id);

  try {
    const result = await pool.query(
      `UPDATE portfolios SET ${setClause} WHERE id=$${processedValues.length} RETURNING *`, 
      processedValues
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Portfolio non trouvé' });
    }

    // Reformater les arrays pour la réponse
    const portfolio = { ...result.rows[0] };
    if (portfolio.technologies && Array.isArray(portfolio.technologies)) {
      portfolio.technologies = formatArrayFromPostgres(portfolio.technologies);
    }
    if (portfolio.gallery_images && Array.isArray(portfolio.gallery_images)) {
      portfolio.gallery_images = formatArrayFromPostgres(portfolio.gallery_images);
    }

    res.json({ success: true, data: portfolio });
  } catch (error) {
    console.error('Error updating portfolio:', error);
    if (error.code === 'XX000' || error.message?.includes('db_termination')) {
      return res.status(503).json({ error: 'Service temporairement indisponible' });
    }
    res.status(500).json({ error: 'Erreur lors de la modification du portfolio' });
  }
}));

// ===== DELETE - Supprimer un portfolio =====
portfoliosRouter.delete('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!id || isNaN(parseInt(id))) {
    return res.status(400).json({ error: 'ID invalide' });
  }

  try {
    const result = await pool.query('DELETE FROM portfolios WHERE id=$1 RETURNING *', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Portfolio non trouvé' });
    }

    res.json({ 
      success: true, 
      message: 'Portfolio supprimé avec succès', 
      data: result.rows[0] 
    });
  } catch (error) {
    console.error('Error deleting portfolio:', error);
    if (error.code === 'XX000' || error.message?.includes('db_termination')) {
      return res.status(503).json({ error: 'Service temporairement indisponible' });
    }
    res.status(500).json({ error: 'Erreur lors de la suppression du portfolio' });
  }
}));

// ===== DELETE - Suppression multiple =====
portfoliosRouter.delete('/', asyncHandler(async (req, res) => {
  const { ids } = req.body;
  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: 'Liste d\'IDs requise' });
  }

  const validIds = ids.filter(id => !isNaN(parseInt(id)));
  if (validIds.length === 0) {
    return res.status(400).json({ error: 'Aucun ID valide fourni' });
  }

  const placeholders = validIds.map((_, i) => `$${i + 1}`).join(', ');

  try {
    const result = await pool.query(
      `DELETE FROM portfolios WHERE id IN (${placeholders}) RETURNING *`, 
      validIds
    );
    res.json({ 
      success: true,
      message: `${result.rows.length} portfolio(s) supprimé(s) avec succès`, 
      data: result.rows 
    });
  } catch (error) {
    console.error('Error deleting multiple portfolios:', error);
    if (error.code === 'XX000' || error.message?.includes('db_termination')) {
      return res.status(503).json({ error: 'Service temporairement indisponible' });
    }
    res.status(500).json({ error: 'Erreur lors de la suppression des portfolios' });
  }
}));

// Middleware global pour erreurs
portfoliosRouter.use((error, req, res, next) => {
  console.error('Erreur dans portfoliosRouter:', error);

  // Erreurs Multer
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'Fichier trop volumineux (max 5MB)' });
    }
    if (error.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({ error: 'Trop de fichiers (max 10)' });
    }
    return res.status(400).json({ error: 'Erreur lors de l\'upload: ' + error.message });
  }
  
  // Erreurs de base de données
  if (error.code === '23505') {
    return res.status(409).json({ error: 'Conflit de données - entrée déjà existante' });
  }
  if (['XX000', '08006', '08003'].includes(error.code) || 
      error.message?.includes('db_termination') || 
      error.message?.includes('shutdown')) {
    return res.status(503).json({ error: 'Service de base de données temporairement indisponible. Veuillez réessayer plus tard.' });
  }
  
  // Erreur générique
  res.status(500).json({ error: 'Erreur interne du serveur' });
});

export default portfoliosRouter;