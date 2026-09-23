// Git exports GIT_DIR, GIT_INDEX_FILE and similar into hooks. Fixture repositories
// created by `git -C <tmp>` would otherwise write to the repository being pushed,
// including its shared config, so every test runs without them.
for (const key of Object.keys(process.env)) if (key.startsWith('GIT_')) delete process.env[key]
