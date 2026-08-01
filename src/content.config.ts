import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';
const categoryEnum = z.enum([
  'anxiety',
  'depression',
  'addiction-recovery',
  'trauma',
  'relationships',
  'stress-burnout',
  'adhd',
]);
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
    // Safe, non-destructive optional fields for Decap CMS uploads:
    image: z.string().optional(),
    imageAlt: z.string().optional(),
  }),
});
const worksheets = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/worksheets' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    tier: z.enum(['free', 'paid']),
    category: z.enum([
      'anxiety', 'depression', 'addiction-recovery', 'trauma',
      'relationships', 'stress-burnout', 'adhd', 'general',
    ]).default('general'),
    age: z.array(z.enum(['children', 'adults'])).default(['adults']),
    fileUrl: z.string().optional(),
    order: z.number().default(0),
    draft: z.boolean().default(false),
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
    category: z.enum([
      'anxiety', 'depression', 'addiction-recovery', 'trauma',
      'relationships', 'stress-burnout', 'adhd', 'general',
    ]).default('general'),
    age: z.array(z.enum(['children', 'adults'])).default(['adults']),
    pdfUrl: z.string(),
    scoringSummary: z.string(),
    sourceNote: z.string().optional(),
    order: z.number().default(0),
    draft: z.boolean().default(false),
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

export const collections = { articles, worksheets, assessments, courses };