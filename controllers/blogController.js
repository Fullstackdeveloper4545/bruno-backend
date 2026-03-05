const pool = require('../config/db');

function slugify(value) {
  if (!value) return '';
  return String(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function toNullableText(value) {
  if (value == null) return null;
  const text = String(value).trim();
  return text ? text : null;
}

function toNullableTimestamp(value) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function toBoolean(value, fallback = false) {
  if (value == null) return fallback;
  if (typeof value === 'boolean') return value;
  return String(value).trim().toLowerCase() === 'true';
}

async function listPublicPosts(req, res) {
  try {
    const result = await pool.query(
      `SELECT
         id,
         slug,
         title_pt,
         title_es,
         excerpt_pt,
         excerpt_es,
         cover_image_url,
         is_published,
         published_at,
         created_at,
         updated_at
       FROM blog_posts
       WHERE is_published = true
         AND (published_at IS NULL OR published_at <= NOW())
       ORDER BY COALESCE(published_at, created_at) DESC, created_at DESC`
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}

async function getPublicPostBySlug(req, res) {
  try {
    const slug = String(req.params.slug || '').trim().toLowerCase();
    if (!slug) {
      return res.status(400).json({ message: 'Invalid slug' });
    }

    const result = await pool.query(
      `SELECT
         id,
         slug,
         title_pt,
         title_es,
         excerpt_pt,
         excerpt_es,
         content_pt,
         content_es,
         cover_image_url,
         is_published,
         published_at,
         created_at,
         updated_at
       FROM blog_posts
       WHERE slug = $1
         AND is_published = true
         AND (published_at IS NULL OR published_at <= NOW())
       LIMIT 1`,
      [slug]
    );

    if (!result.rows[0]) {
      return res.status(404).json({ message: 'Blog post not found' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}

async function listAdminPosts(req, res) {
  try {
    const result = await pool.query(
      `SELECT
         id,
         slug,
         title_pt,
         title_es,
         excerpt_pt,
         excerpt_es,
         content_pt,
         content_es,
         cover_image_url,
         is_published,
         published_at,
         created_at,
         updated_at
       FROM blog_posts
       ORDER BY created_at DESC, id DESC`
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}

async function createPost(req, res) {
  try {
    const titlePt = toNullableText(req.body?.title_pt);
    const titleEs = toNullableText(req.body?.title_es);
    const excerptPt = toNullableText(req.body?.excerpt_pt);
    const excerptEs = toNullableText(req.body?.excerpt_es);
    const contentPt = toNullableText(req.body?.content_pt);
    const contentEs = toNullableText(req.body?.content_es);
    const coverImageUrl = toNullableText(req.body?.cover_image_url);
    const isPublished = toBoolean(req.body?.is_published, false);

    if (!titlePt && !titleEs) {
      return res.status(400).json({ message: 'title_pt or title_es is required' });
    }

    const providedSlug = slugify(req.body?.slug);
    const fallbackSlugSource = titlePt || titleEs;
    const slug = providedSlug || slugify(fallbackSlugSource);
    if (!slug) {
      return res.status(400).json({ message: 'slug is required' });
    }

    const publishedAtInput = toNullableTimestamp(req.body?.published_at);

    const result = await pool.query(
      `INSERT INTO blog_posts (
        slug,
        title_pt,
        title_es,
        excerpt_pt,
        excerpt_es,
        content_pt,
        content_es,
        cover_image_url,
        is_published,
        published_at,
        updated_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,CASE WHEN $9 THEN COALESCE($10::timestamp, NOW()) ELSE NULL END,NOW())
      RETURNING *`,
      [
        slug,
        titlePt,
        titleEs,
        excerptPt,
        excerptEs,
        contentPt,
        contentEs,
        coverImageUrl,
        isPublished,
        publishedAtInput,
      ]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    if (error?.code === '23505') {
      return res.status(409).json({ message: 'Slug already exists' });
    }
    res.status(500).json({ message: error.message });
  }
}

async function updatePost(req, res) {
  try {
    const id = String(req.params.id || '').trim();
    if (!id) {
      return res.status(400).json({ message: 'Invalid id' });
    }

    const titlePt = toNullableText(req.body?.title_pt);
    const titleEs = toNullableText(req.body?.title_es);
    if (!titlePt && !titleEs) {
      return res.status(400).json({ message: 'title_pt or title_es is required' });
    }

    const providedSlug = slugify(req.body?.slug);
    const fallbackSlugSource = titlePt || titleEs;
    const slug = providedSlug || slugify(fallbackSlugSource);
    if (!slug) {
      return res.status(400).json({ message: 'slug is required' });
    }

    const excerptPt = toNullableText(req.body?.excerpt_pt);
    const excerptEs = toNullableText(req.body?.excerpt_es);
    const contentPt = toNullableText(req.body?.content_pt);
    const contentEs = toNullableText(req.body?.content_es);
    const coverImageUrl = toNullableText(req.body?.cover_image_url);
    const isPublished = toBoolean(req.body?.is_published, false);
    const publishedAtInput = toNullableTimestamp(req.body?.published_at);

    const result = await pool.query(
      `UPDATE blog_posts
       SET slug = $1,
           title_pt = $2,
           title_es = $3,
           excerpt_pt = $4,
           excerpt_es = $5,
           content_pt = $6,
           content_es = $7,
           cover_image_url = $8,
           is_published = $9,
           published_at = CASE WHEN $9 THEN COALESCE($10::timestamp, NOW()) ELSE NULL END,
           updated_at = NOW()
       WHERE id::text = $11::text
       RETURNING *`,
      [slug, titlePt, titleEs, excerptPt, excerptEs, contentPt, contentEs, coverImageUrl, isPublished, publishedAtInput, id]
    );

    if (!result.rows[0]) {
      return res.status(404).json({ message: 'Blog post not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    if (error?.code === '23505') {
      return res.status(409).json({ message: 'Slug already exists' });
    }
    res.status(500).json({ message: error.message });
  }
}

async function deletePost(req, res) {
  try {
    const id = String(req.params.id || '').trim();
    if (!id) {
      return res.status(400).json({ message: 'Invalid id' });
    }

    const result = await pool.query(`DELETE FROM blog_posts WHERE id::text = $1::text`, [id]);
    if (!result.rowCount) {
      return res.status(404).json({ message: 'Blog post not found' });
    }

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}

module.exports = {
  listPublicPosts,
  getPublicPostBySlug,
  listAdminPosts,
  createPost,
  updatePost,
  deletePost,
};
