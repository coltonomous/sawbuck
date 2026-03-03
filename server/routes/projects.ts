import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Hono } from 'hono';
import { db } from '../db/index.js';
import { projects, listings, refinishingPlans, materials, projectPhotos, listingImages } from '../db/schema.js';
import { eq, desc, sql } from 'drizzle-orm';
import { generateRefinishingPlan, parsePlanSteps } from '../analysis/refinishing.js';
import { generateMaterialsFromPlan, getMaterialsForProject } from '../analysis/sourcing.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PHOTO_DIR = path.join(__dirname, '..', '..', 'data', 'images', 'projects');

export const projectsRouter = new Hono();

// GET / — list all projects
projectsRouter.get('/', async (c) => {
  const { status } = c.req.query();
  const conditions = status ? eq(projects.status, status as any) : undefined;

  const results = await db.select()
    .from(projects)
    .where(conditions)
    .orderBy(desc(projects.createdAt));

  return c.json(results);
});

// GET /:id — single project with listing, plan, and materials
projectsRouter.get('/:id', async (c) => {
  const id = parseInt(c.req.param('id'));
  const project = await db.select().from(projects).where(eq(projects.id, id)).get();
  if (!project) return c.json({ error: 'Not found' }, 404);

  const listing = await db.select().from(listings).where(eq(listings.id, project.listingId)).get();

  const plans = await db.select()
    .from(refinishingPlans)
    .where(eq(refinishingPlans.projectId, id));

  const plan = plans[0] ?? null;
  const planWithSteps = plan ? { ...plan, steps: parsePlanSteps(plan.steps) } : null;

  const mats = await getMaterialsForProject(id);
  const photos = await db.select().from(projectPhotos).where(eq(projectPhotos.projectId, id));
  const images = listing
    ? await db.select().from(listingImages).where(eq(listingImages.listingId, listing.id))
    : [];

  return c.json({ ...project, listing: listing ? { ...listing, images } : null, plan: planWithSteps, materials: mats, photos });
});

// POST / — create project from listing
projectsRouter.post('/', async (c) => {
  const body = await c.req.json();
  const { listingId, name, purchasePrice, purchaseDate, purchaseNotes } = body;

  if (!listingId || !name || purchasePrice === undefined) {
    return c.json({ error: 'listingId, name, and purchasePrice are required' }, 400);
  }

  // Create the project
  const [project] = await db.insert(projects).values({
    listingId,
    name,
    purchasePrice,
    purchaseDate: purchaseDate || new Date().toISOString().split('T')[0],
    purchaseNotes,
  }).returning();

  // Update listing status to acquired
  await db.update(listings).set({ status: 'acquired' }).where(eq(listings.id, listingId));

  return c.json(project, 201);
});

// PATCH /:id — update project
projectsRouter.patch('/:id', async (c) => {
  const id = parseInt(c.req.param('id'));
  const body = await c.req.json();

  // Recalculate financials if relevant fields changed
  await db.update(projects).set({
    ...body,
    updatedAt: new Date().toISOString(),
  }).where(eq(projects.id, id));

  // Recalculate totals
  await recalculateFinancials(id);

  const updated = await db.select().from(projects).where(eq(projects.id, id)).get();
  return c.json(updated);
});

// POST /:id/refinish — generate refinishing plan
projectsRouter.post('/:id/refinish', async (c) => {
  const id = parseInt(c.req.param('id'));
  const project = await db.select().from(projects).where(eq(projects.id, id)).get();
  if (!project) return c.json({ error: 'Project not found' }, 404);

  try {
    const plan = await generateRefinishingPlan(project.listingId, id);
    if (!plan) return c.json({ error: 'Failed to generate refinishing plan' }, 422);

    // Get the stored plan record to generate materials
    const storedPlans = await db.select()
      .from(refinishingPlans)
      .where(eq(refinishingPlans.projectId, id));
    const storedPlan = storedPlans[storedPlans.length - 1];

    if (storedPlan) {
      // Auto-generate materials list
      await generateMaterialsFromPlan(storedPlan.id, id);
    }

    // Update project status
    await db.update(projects).set({
      status: 'refinishing',
      updatedAt: new Date().toISOString(),
    }).where(eq(projects.id, id));

    return c.json({
      plan,
      materials: storedPlan ? await getMaterialsForProject(id) : [],
    });
  } catch (err: any) {
    console.error(`[projects] Error generating plan for project ${id}:`, err);
    return c.json({ error: err.message }, 500);
  }
});

// GET /:id/refinish — get existing refinishing plan
projectsRouter.get('/:id/refinish', async (c) => {
  const id = parseInt(c.req.param('id'));
  const plans = await db.select()
    .from(refinishingPlans)
    .where(eq(refinishingPlans.projectId, id));

  if (plans.length === 0) return c.json({ error: 'No plan found' }, 404);

  const plan = plans[plans.length - 1]; // Latest plan
  return c.json({ ...plan, steps: parsePlanSteps(plan.steps) });
});

// GET /:id/materials — get materials for project
projectsRouter.get('/:id/materials', async (c) => {
  const id = parseInt(c.req.param('id'));
  const mats = await getMaterialsForProject(id);
  return c.json(mats);
});

// PATCH /:id/materials/:materialId — update material (actual price, purchased)
projectsRouter.patch('/:id/materials/:materialId', async (c) => {
  const projectId = parseInt(c.req.param('id'));
  const materialId = parseInt(c.req.param('materialId'));
  const body = await c.req.json();

  await db.update(materials).set(body).where(eq(materials.id, materialId));

  // Recalculate project material costs
  await recalculateFinancials(projectId);

  const updated = await db.select().from(materials).where(eq(materials.id, materialId)).get();
  return c.json(updated);
});

// PATCH /:id/costs — update cost-related fields
projectsRouter.patch('/:id/costs', async (c) => {
  const id = parseInt(c.req.param('id'));
  const body = await c.req.json();

  const allowed = ['hoursInvested', 'hourlyRate', 'soldPrice', 'soldDate', 'listedPrice', 'listedDate', 'listedPlatform', 'sellingFees', 'shippingCost'];
  const updates: Record<string, any> = {};
  for (const key of allowed) {
    if (body[key] !== undefined) updates[key] = body[key];
  }

  if (Object.keys(updates).length > 0) {
    updates.updatedAt = new Date().toISOString();
    await db.update(projects).set(updates).where(eq(projects.id, id));
    await recalculateFinancials(id);
  }

  const updated = await db.select().from(projects).where(eq(projects.id, id)).get();
  return c.json(updated);
});

async function recalculateFinancials(projectId: number) {
  const project = await db.select().from(projects).where(eq(projects.id, projectId)).get();
  if (!project) return;

  // Sum purchased material costs; fall back to full estimate if none purchased
  const mats = await getMaterialsForProject(projectId);
  const purchased = mats.filter((m) => m.purchased);
  const totalMaterialCost = purchased.length > 0
    ? purchased.reduce((sum, m) => sum + (m.actualPrice ?? m.estimatedPrice ?? 0), 0)
    : mats.reduce((sum, m) => sum + (m.estimatedPrice ?? 0), 0);

  const laborCost = (project.hoursInvested ?? 0) * (project.hourlyRate ?? 25);
  const totalCost = project.purchasePrice + totalMaterialCost + laborCost + (project.sellingFees ?? 0) + (project.shippingCost ?? 0);
  const profit = (project.soldPrice ?? 0) - totalCost;
  const roi = totalCost > 0 ? Math.round((profit / totalCost) * 10000) / 100 : 0;

  await db.update(projects).set({
    totalMaterialCost: Math.round(totalMaterialCost * 100) / 100,
    totalCost: Math.round(totalCost * 100) / 100,
    profit: project.soldPrice ? Math.round(profit * 100) / 100 : null,
    roiPercentage: project.soldPrice ? roi : null,
  }).where(eq(projects.id, projectId));
}

// ============================================================
// Photos
// ============================================================

// GET /:id/photos — list photos for project
projectsRouter.get('/:id/photos', async (c) => {
  const id = parseInt(c.req.param('id'));
  const photos = await db.select().from(projectPhotos).where(eq(projectPhotos.projectId, id));
  return c.json(photos);
});

// POST /:id/photos — upload a photo (multipart form)
projectsRouter.post('/:id/photos', async (c) => {
  const id = parseInt(c.req.param('id'));
  const project = await db.select().from(projects).where(eq(projects.id, id)).get();
  if (!project) return c.json({ error: 'Project not found' }, 404);

  const formData = await c.req.formData();
  const file = formData.get('photo') as File | null;
  const photoType = (formData.get('type') as string) || 'during';
  const caption = (formData.get('caption') as string) || '';

  if (!file) return c.json({ error: 'No photo file provided' }, 400);

  const validTypes = ['before', 'during', 'after'] as const;
  if (!validTypes.includes(photoType as any)) {
    return c.json({ error: 'type must be before, during, or after' }, 400);
  }

  // Save file
  const projectDir = path.join(PHOTO_DIR, String(id));
  fs.mkdirSync(projectDir, { recursive: true });

  const ext = path.extname(file.name) || '.jpg';
  const timestamp = Date.now();
  const filename = `${photoType}-${timestamp}${ext}`;
  const filePath = path.join(projectDir, filename);
  const relativePath = path.join('projects', String(id), filename);

  const buffer = Buffer.from(await file.arrayBuffer());
  fs.writeFileSync(filePath, buffer);

  const [photo] = await db.insert(projectPhotos).values({
    projectId: id,
    photoType: photoType as 'before' | 'during' | 'after',
    localPath: relativePath,
    caption: caption || null,
  }).returning();

  return c.json(photo, 201);
});

// DELETE /:id — delete project and reset listing status
projectsRouter.delete('/:id', async (c) => {
  const id = parseInt(c.req.param('id'));
  const project = await db.select().from(projects).where(eq(projects.id, id)).get();
  if (!project) return c.json({ error: 'Not found' }, 404);

  // Delete related data (photos, materials, plans)
  const photos = await db.select().from(projectPhotos).where(eq(projectPhotos.projectId, id));
  for (const photo of photos) {
    const filePath = path.join(__dirname, '..', '..', 'data', 'images', photo.localPath);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }
  await db.delete(projectPhotos).where(eq(projectPhotos.projectId, id));
  await db.delete(materials).where(eq(materials.projectId, id));
  await db.delete(refinishingPlans).where(eq(refinishingPlans.projectId, id));
  await db.delete(projects).where(eq(projects.id, id));

  // Reset listing status back to analyzed (or new if never analyzed)
  const listing = await db.select().from(listings).where(eq(listings.id, project.listingId)).get();
  if (listing) {
    const newStatus = listing.furnitureType ? 'analyzed' : 'new';
    await db.update(listings).set({ status: newStatus }).where(eq(listings.id, project.listingId));
  }

  return c.json({ ok: true });
});

// DELETE /:id/photos/:photoId — delete a photo
projectsRouter.delete('/:id/photos/:photoId', async (c) => {
  const photoId = parseInt(c.req.param('photoId'));
  const photo = await db.select().from(projectPhotos).where(eq(projectPhotos.id, photoId)).get();

  if (photo) {
    // Delete file
    const filePath = path.join(__dirname, '..', '..', 'data', 'images', photo.localPath);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

    await db.delete(projectPhotos).where(eq(projectPhotos.id, photoId));
  }

  return c.json({ ok: true });
});

// ============================================================
// List projects with listing data for pipeline view
// ============================================================

// GET /pipeline — projects with listing primary image for kanban cards
projectsRouter.get('/pipeline/all', async (c) => {
  const allProjects = await db.select()
    .from(projects)
    .orderBy(desc(projects.updatedAt));

  // Fetch primary images for each project's listing
  const enriched = await Promise.all(allProjects.map(async (project) => {
    const primaryImage = await db.select()
      .from(listingImages)
      .where(eq(listingImages.listingId, project.listingId))
      .limit(1)
      .get();

    const listing = await db.select()
      .from(listings)
      .where(eq(listings.id, project.listingId))
      .get();

    return {
      ...project,
      primaryImagePath: primaryImage?.localPathResized || primaryImage?.localPathOriginal || null,
      furnitureType: listing?.furnitureType || null,
      furnitureStyle: listing?.furnitureStyle || null,
    };
  }));

  return c.json(enriched);
});
