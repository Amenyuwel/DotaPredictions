// A module of its own because `import` is hoisted: assignments written above
// the imports in a test file still run AFTER every import, so config.js would
// already have resolved the environment without them. Imported first, this
// module runs first. dotenv does not overwrite a name already present, so these
// win over the repo's own .env and the suite does not depend on what is in it --
// which is exactly what CI, with no .env at all, exposed.
process.env.SUPABASE_URL = "https://project-ref.supabase.co"
process.env.SUPABASE_SECRET_KEY = "sb_secret_test"
