import { defineConfig } from 'drizzle-kit';

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error('DATABASE_URL environment variable is required for drizzle-kit commands');
}

export default defineConfig({
  schema: './src/schema/!(*.test).ts',
  out: './src/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url,
  },
});
