import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';
// Categories used to be a fixed list here (z.enum). They're now managed
// as their own Decap collection (src/content/categories) so new categories
// can be added from the CMS without touching code — see the "categories"
// collection below and the "Category"/"Topic" relation fields in
// public/admin/config.yml. Any string is accepted here on purpose.
const categoryEnum = z.string();
const categories = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/categories' }),
  schema: z.object({
    name: z.string(),
  }),
});
const articles = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/articles' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    category: categoryEnum,
    subcategory: z.string().optional(),
    tags: z.array(z.string()).default([]),
    author: z.string(),
    reviewedBy: z.string().optional(),
    publishDate: z.date(),
    draft: z.boolean().default(false),
    // Optional shorter title for the <title> tag / meta / JSON-LD headline
    // when the real headline (above) runs long for search snippets. Never
    // changes the on-page H1, breadcrumb, or body — see [...slug].astro.
    seoTitle: z.string().optional(),
    // Safe, non-destructive optional fields for Decap CMS uploads:
    image: z.string().optional(),
    imageAlt: z.string().optional(),
    // Unsplash attribution (populated by the n8n pipeline for AI-sourced images).
    // Optional so manually-uploaded Decap images without a credit still work fine.
    imageCredit: z.string().optional(),
    imageCreditUrl: z.string().optional(),
    imageSourceUrl: z.string().optional(),
  }),
});
const worksheets = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/worksheets' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    tier: z.enum(['free', 'paid']),
    category: z.string().default('general'),
    age: z.array(z.enum(['children', 'adults'])).default(['adults']),
    fileUrl: z.string().optional(),
    order: z.number().default(0),
    draft: z.boolean().default(false),
    // See the matching field on the articles collection above.
    seoTitle: z.string().optional(),
    // Safe, non-destructive optional fields for Decap CMS uploads:
    image: z.string().optional(),
    imageAlt: z.string().optional(),
  }),
});
const assessments = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/assessments' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    category: z.string().default('general'),
    age: z.array(z.enum(['children', 'adults'])).default(['adults']),
    pdfUrl: z.string(),
    scoringSummary: z.string(),
    sourceNote: z.string().optional(),
    order: z.number().default(0),
    draft: z.boolean().default(false),
    // See the matching field on the articles collection above.
    seoTitle: z.string().optional(),
  }),
});
const courses = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/courses' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    category: z.enum([
      'anxiety', 'depression', 'addiction-recovery', 'trauma',
      'relationships', 'stress-burnout', 'adhd', 'general',
    ]).default('general'),
    estimatedHours: z.number().default(1),
    author: z.string(),
    // Paid courses gate access to the lessons behind a manual payment-proof
    // review (see /api/courses/pay and the "Course Enrollment Requests" tab
    // in /dashboard). The certificate itself is always free either way.
    isPaid: z.boolean().default(false),
    pricePkr: z.number().min(0).optional(),
    passScorePercent: z.number().min(1).max(100).default(80),
    // Quiz questions: index of the correct option within that question's options array.
    quiz: z.array(z.object({
      question: z.string(),
      options: z.array(z.string()).min(2),
      correctIndex: z.number().int().min(0),
    })).min(1),
    order: z.number().default(0),
    draft: z.boolean().default(false),
    // Safe, non-destructive optional fields for Decap CMS uploads:
    image: z.string().optional(),
    imageAlt: z.string().optional(),
  }),
});

// Course modules: each module is its own file, matched to a course by
// `courseSlug`. Kept as a separate collection (rather than a nested list
// field on the course itself) so each module gets its own real markdown
// body — nested markdown editors inside list widgets are painful in Decap
// CMS, and this also means an existing course with zero module files just
// falls back to its old single-page behavior untouched.
const courseModules = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/course-modules' }),
  schema: z.object({
    courseSlug: z.string(),
    title: z.string(),
    type: z.enum(['text', 'video']).default('text'),
    videoUrl: z.string().optional(),
    order: z.number().default(0),
    // Optional, ungraded check-in question(s) shown at the end of the
    // module for reinforcement — these never affect the certificate score.
    questions: z.array(z.object({
      question: z.string(),
      options: z.array(z.string()).min(2),
      correctIndex: z.number().int().min(0),
    })).optional().default([]),
    draft: z.boolean().default(false),
  }),
});

export const collections = { articles, worksheets, assessments, courses, courseModules, categories };