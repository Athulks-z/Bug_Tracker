const router = require('express').Router();
const pool = require('../config/db');
const { auth } = require('../middleware/auth');
const { requireAdministrator } = require('../middleware/roles');

router.get('/', auth, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT value,label,icon,active,sort_order,created_at,updated_at
      FROM public.work_types
      ORDER BY CASE WHEN value='other' THEN 1 ELSE 0 END,
               sort_order, lower(label)
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: 'Unable to load work types' });
  }
});

router.post('/', auth, requireAdministrator, async (req, res) => {
  try {
    const value = String(req.body?.value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    const label = String(req.body?.label || '').trim();
    if (!value || !label) return res.status(400).json({ message: 'Value and label are required' });
    if (value === 'other') return res.status(400).json({ message: 'Other is reserved' });
    const sortOrder = Number.isInteger(Number(req.body?.sortOrder)) ? Number(req.body.sortOrder) : 500;
    const { rows } = await pool.query(`
      INSERT INTO public.work_types (value,label,icon,active,sort_order)
      VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT (value) DO UPDATE SET
        label=EXCLUDED.label, icon=EXCLUDED.icon, active=EXCLUDED.active,
        sort_order=EXCLUDED.sort_order, updated_at=now()
      RETURNING value,label,icon,active,sort_order,created_at,updated_at
    `, [value, label.slice(0,100), String(req.body?.icon || '').trim().slice(0,50), req.body?.active !== false, sortOrder]);
    await pool.query(
      `INSERT INTO public.work_type_kinds (type_value,kind) VALUES ($1,'task')
       ON CONFLICT DO NOTHING`,
      [value]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'Unable to save work type' });
  }
});

router.put('/:value', auth, requireAdministrator, async (req, res) => {
  try {
    if (req.params.value === 'other') return res.status(400).json({ message: 'Other cannot be removed or renamed' });
    const label = req.body?.label === undefined ? null : String(req.body.label).trim();
    const active = req.body?.active;
    const sortOrder = req.body?.sortOrder;
    const { rows } = await pool.query(`
      UPDATE public.work_types
      SET label=COALESCE(NULLIF($2,''),label),
          active=COALESCE($3,active),
          sort_order=COALESCE($4,sort_order),
          icon=COALESCE(NULLIF($5,''),icon),
          updated_at=now()
      WHERE value=$1
      RETURNING value,label,icon,active,sort_order,created_at,updated_at
    `, [req.params.value, label, typeof active === 'boolean' ? active : null,
      Number.isInteger(Number(sortOrder)) ? Number(sortOrder) : null,
      req.body?.icon === undefined ? null : String(req.body.icon).trim()]);
    if (!rows.length) return res.status(404).json({ message: 'Work type not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'Unable to update work type' });
  }
});

module.exports = router;
