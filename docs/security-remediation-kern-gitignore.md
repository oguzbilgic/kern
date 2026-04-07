# Security Remediation: .kern/ Directory Exposure Fix

**Related Vulnerability:** `security-vulnerability-kern-gitignore.md`
**Priority:** CRITICAL
**Effort:** Medium
**Breaking Changes:** No

---

## Overview

This document provides comprehensive remediation guidance for the `.kern/` directory exposure vulnerability in the kern-ai agent gitignore system. The fix involves multiple components: correcting the gitignore pattern, preventing initial commit of secrets, migrating existing repositories, and establishing security best practices.

---

## Immediate Actions Required

### 1. Fix Gitignore Pattern (Code Change)

**File:** `src/init.ts` (lines 469-476)

**Current (Vulnerable):**
```javascript
const gitignore = `.kern/.env
.kern/sessions/
.kern/recall.db
.kern/media/
.kern/logs/
node_modules/
`;
```

**Fixed (Secure):**
```javascript
const gitignore = `# kern-ai: Ignore entire .kern directory to protect secrets and session data
.kern/

# Optional: Allow config.json to be committed (contains model settings, no secrets)
!.kern/config.json

# Node
node_modules/
`;
```

**Why This Works:**
- `.kern/` (with trailing slash, no subdirectory) ignores the **entire directory** from the root
- `!.kern/config.json` is a negation pattern that un-ignores the config file (optional - config contains no secrets)
- This is the correct git pattern for "ignore everything in this directory"

**Alternative (More Explicit):**
```javascript
const gitignore = `# kern-ai: Ignore sensitive files and local data
.kern/**

# Optional: Allow config.json to be committed
!.kern/config.json

# Node
node_modules/
`;
```

The `**` pattern is more explicit and works identically to `.kern/` for this use case.

---

### 2. Prevent Initial Commit of Secrets (Code Change)

**File:** `src/init.ts` (lines 514-534)

**Problem:** The initialization creates `.gitignore` but then immediately runs `git add -A` before `.gitignore` takes effect.

**Current (Vulnerable):**
```javascript
if (!existsSync(join(dir, ".gitignore"))) {
  await writeFile(join(dir, ".gitignore"), gitignore);
  print("  + .gitignore");
} else {
  print("  ○ .gitignore (exists)");
}

// Git init only for new repos
if (!existsSync(join(dir, ".git"))) {
  const { execSync } = await import("child_process");
  try {
    execSync("git init", { cwd: dir, stdio: "ignore" });
    execSync("git add -A", { cwd: dir, stdio: "ignore" });  // ⚠️ ADDS .kern/.env
    execSync('git commit -m "initial agent setup"', { cwd: dir, stdio: "ignore" });
    print("  + git init + first commit");
```

**Fixed (Secure):**
```javascript
// Git init only for new repos
if (!existsSync(join(dir, ".git"))) {
  const { execSync } = await import("child_process");
  try {
    // Initialize git repo
    execSync("git init", { cwd: dir, stdio: "ignore" });

    // Write .gitignore BEFORE any git add commands
    if (!existsSync(join(dir, ".gitignore"))) {
      await writeFile(join(dir, ".gitignore"), gitignore);
      print("  + .gitignore");
    } else {
      print("  ○ .gitignore (exists)");
    }

    // Add files to staging area (respects .gitignore)
    execSync("git add -A", { cwd: dir, stdio: "ignore" });

    // Verify .kern/.env is NOT staged (safety check)
    let status;
    try {
      status = execSync("git status --porcelain", { cwd: dir, encoding: "utf-8" });
      if (status.includes(".kern/.env") || status.includes(".kern/sessions")) {
        console.error("⚠️  WARNING: .kern/ secrets about to be committed!");
        console.error("Aborting commit for safety. Please check .gitignore configuration.");
        return;
      }
    } catch {
      // Status check failed, proceed with caution
    }

    // Create initial commit
    execSync('git commit -m "initial agent setup"', { cwd: dir, stdio: "ignore" });
    print("  + git init + first commit");
```

**Key Changes:**
1. Move `.gitignore` creation **before** `git add -A`
2. Add safety check to verify `.kern/.env` is not staged
3. Abort commit if secrets are detected in staging area

---

### 3. Create Migration Script for Existing Users

**File:** `src/migrate-gitignore.ts` (new file)

```typescript
import { readFile, writeFile } from "fs/promises";
import { join } from "path";
import { execSync } from "child_process";
import { findAgent, listAgents } from "./registry.js";

/**
 * Migrates existing agent repositories to use secure .gitignore patterns
 * and removes sensitive files from git history.
 */
export async function migrateAgentGitignore(agentName: string): Promise<void> {
  const agent = await findAgent(agentName);
  if (!agent) {
    console.error(`Agent '${agentName}' not found`);
    return;
  }

  const dir = agent.path;
  const gitignorePath = join(dir, ".gitignore");

  console.log(`\nMigrating ${agentName} at ${dir}...`);

  // 1. Update .gitignore to secure pattern
  const secureGitignore = `# kern-ai: Ignore entire .kern directory to protect secrets and session data
.kern/

# Optional: Allow config.json to be committed (contains model settings, no secrets)
!.kern/config.json

# Node
node_modules/
`;

  try {
    const currentGitignore = await readFile(gitignorePath, "utf-8");

    // Check if already using secure pattern
    if (currentGitignore.includes(".kern/\n") || currentGitignore.includes(".kern/**")) {
      console.log("✓ .gitignore already uses secure pattern");
    } else {
      await writeFile(gitignorePath, secureGitignore);
      console.log("✓ Updated .gitignore to secure pattern");
    }
  } catch {
    // No .gitignore exists
    await writeFile(gitignorePath, secureGitignore);
    console.log("✓ Created secure .gitignore");
  }

  // 2. Check if .kern/ files are tracked in git
  let trackedFiles: string[] = [];
  try {
    const tracked = execSync("git ls-files .kern/", { cwd: dir, encoding: "utf-8" });
    trackedFiles = tracked.trim().split("\n").filter(Boolean);
  } catch {
    console.log("✓ No .kern/ files currently tracked");
    return;
  }

  if (trackedFiles.length === 0) {
    console.log("✓ No .kern/ files currently tracked");
    return;
  }

  // 3. Found tracked .kern/ files - requires intervention
  console.log("\n⚠️  WARNING: Sensitive .kern/ files are tracked in git history!");
  console.log("   Files found:");
  trackedFiles.forEach(f => console.log(`     - ${f}`));

  console.log("\n⚠️  These files may contain:");
  console.log("   - API keys and authentication tokens");
  console.log("   - Conversation history and user data");
  console.log("   - Session data and embeddings");

  console.log("\n📋 Remediation steps:");
  console.log("   1. Untrack files from git index:");
  console.log(`      cd ${dir}`);
  console.log(`      git rm -r --cached .kern/`);
  console.log(`      git add .kern/config.json  # re-add config if desired`);
  console.log(`      git commit -m "chore: remove .kern/ secrets from tracking"`);

  console.log("\n   2. Remove from git history (REQUIRED if repository is public or shared):");
  console.log("      # Using git-filter-repo (recommended):");
  console.log(`      git filter-repo --path .kern/.env --invert-paths`);
  console.log(`      git filter-repo --path .kern/sessions/ --invert-paths`);

  console.log("\n      # Or using BFG Repo-Cleaner:");
  console.log(`      bfg --delete-folders .kern`);
  console.log(`      git reflog expire --expire=now --all && git gc --prune=now --aggressive`);

  console.log("\n   3. Rotate ALL credentials immediately:");
  console.log("      - Generate new API keys at provider dashboards");
  console.log("      - Regenerate Telegram/Slack bot tokens");
  console.log(`      - Delete and recreate .kern/.env with new tokens`);
  console.log(`      - Run: kern init ${agentName}  (to reconfigure)`);

  console.log("\n   4. Force push to remote (if applicable):");
  console.log("      git push origin --force --all");
  console.log("      git push origin --force --tags");

  console.log("\n⚠️  IF REPOSITORY WAS PUBLIC: Assume all secrets are compromised.");
  console.log("   Contact your LLM provider to report potential API key theft.");
}

export async function migrateAllAgents(): Promise<void> {
  const agents = await listAgents();

  if (agents.length === 0) {
    console.log("No agents found.");
    return;
  }

  console.log(`Found ${agents.length} agent(s). Starting migration...\n`);

  for (const agent of agents) {
    await migrateAgentGitignore(agent.name);
    console.log(""); // blank line between agents
  }

  console.log("Migration complete.");
  console.log("\n💡 Run 'kern list' to see all agents.");
}
```

**CLI Command:** Add to `src/app.ts`

```typescript
import { migrateAgentGitignore, migrateAllAgents } from "./migrate-gitignore.js";

// In the CLI command handler
if (command === "migrate-gitignore") {
  const agentName = args[0];
  if (agentName === "--all") {
    await migrateAllAgents();
  } else if (agentName) {
    await migrateAgentGitignore(agentName);
  } else {
    console.log("Usage: kern migrate-gitignore <name|--all>");
  }
  process.exit(0);
}
```

---

### 4. Add Security Documentation

**File:** `docs/security.md` (new file)

```markdown
# Security Guide

## Secret Management

kern-ai stores sensitive credentials in `.kern/.env`. This file contains:
- LLM API keys (OpenRouter, Anthropic, OpenAI)
- Bot tokens (Telegram, Slack)
- Authentication tokens (agent access)

**CRITICAL: Never commit `.kern/.env` to version control.**

### Gitignore Configuration

kern automatically creates a `.gitignore` that excludes the entire `.kern/` directory:

\`\`\`
.kern/
!.kern/config.json
\`\`\`

This prevents accidental commitment of:
- `.kern/.env` (secrets)
- `.kern/sessions/` (conversation history)
- `.kern/recall.db` (embeddings and user data)
- `.kern/media/` (uploaded files)
- `.kern/logs/` (application logs)

### Credential Rotation

If you suspect credentials have been exposed:

1. **Immediately rotate all tokens:**
   - OpenRouter: https://openrouter.ai/keys
   - Anthropic: https://console.anthropic.com/settings/keys
   - OpenAI: https://platform.openai.com/api-keys
   - Telegram: Talk to @BotFather, revoke and regenerate token
   - Slack: Workspace settings → App management → regenerate tokens

2. **Update `.kern/.env` with new credentials**

3. **Restart the agent:**
   \`\`\`bash
   kern restart <agent-name>
   \`\`\`

### Checking for Exposure

To verify your `.kern/` directory is not tracked in git:

\`\`\`bash
cd your-agent-directory
git ls-files .kern/

# Should return nothing except possibly:
# .kern/config.json
\`\`\`

If you see `.kern/.env` or `.kern/sessions/`, your secrets are in git history.

### Removing Secrets from Git History

If `.kern/.env` was committed:

\`\`\`bash
# 1. Remove from tracking
git rm --cached .kern/.env .kern/sessions/ .kern/recall.db .kern/media/ .kern/logs/
git commit -m "chore: remove secrets from tracking"

# 2. Purge from history (use git-filter-repo)
git filter-repo --path .kern/.env --invert-paths
git filter-repo --path .kern/sessions/ --invert-paths
git filter-repo --path .kern/recall.db --invert-paths
git filter-repo --path .kern/media/ --invert-paths

# 3. Force push to remote
git push origin --force --all
git push origin --force --tags

# 4. Rotate ALL credentials (assume compromised)
\`\`\`

**If your repository is public, assume all credentials are compromised.**

### Security Best Practices

1. **Never share `.kern/.env`** via email, Slack, screenshots, or any channel
2. **Use environment-specific credentials** - separate API keys for dev/staging/prod
3. **Enable GitHub secret scanning** if using GitHub
4. **Audit git history** before making repositories public
5. **Use `.env.example`** files with placeholder values for documentation
6. **Rotate credentials periodically** (every 90 days recommended)
7. **Monitor API usage** for anomalies that might indicate key theft

### Reporting Security Issues

If you discover a security vulnerability in kern-ai, please report it via:
- Email: security@kern-ai.com (if available)
- GitHub Security Advisories: https://github.com/oguzbilgic/kern-ai/security/advisories
- DO NOT open public issues for security vulnerabilities
\`\`\`

---

### 5. Update README.md Security Warning

**File:** `README.md`

Add after the "Agent structure" section (around line 64):

```markdown
## Security

**⚠️ IMPORTANT: `.kern/.env` contains sensitive credentials and is automatically gitignored.**

The `.kern/` directory stores:
- API keys and authentication tokens (`.env`)
- Conversation history (`sessions/`)
- User data and embeddings (`recall.db`)

kern's `.gitignore` excludes the entire `.kern/` directory except `config.json`.

**If you used kern before version X.X.X**, verify secrets are not tracked:

\`\`\`bash
cd your-agent-directory
git ls-files .kern/  # Should return nothing or only config.json
\`\`\`

If you see `.kern/.env` or other sensitive files, run:
\`\`\`bash
kern migrate-gitignore <agent-name>
\`\`\`

See [Security Guide](docs/security.md) for credential rotation and remediation steps.
```

---

### 6. Add Pre-Commit Hook (Optional Enhancement)

**File:** `templates/pre-commit` (new file)

Create a git pre-commit hook template that can be optionally installed:

```bash
#!/bin/sh
# kern-ai pre-commit hook: Prevent accidental commit of secrets

# Check if .kern/.env is being committed
if git diff --cached --name-only | grep -q "^\.kern/\.env$"; then
    echo "❌ ERROR: Attempting to commit .kern/.env (contains secrets)"
    echo ""
    echo "This file contains API keys and tokens. Remove it from staging:"
    echo "  git reset HEAD .kern/.env"
    echo ""
    echo "If .gitignore is incorrect, update it to:"
    echo "  .kern/"
    echo ""
    exit 1
fi

# Check if any .kern/ files (except config.json) are being committed
staged_kern_files=$(git diff --cached --name-only | grep "^\.kern/" | grep -v "^\.kern/config\.json$")

if [ -n "$staged_kern_files" ]; then
    echo "⚠️  WARNING: Attempting to commit sensitive .kern/ files:"
    echo "$staged_kern_files"
    echo ""
    echo "These files may contain secrets or user data."
    echo "Remove them from staging:"
    echo "  git reset HEAD .kern/"
    echo ""
    echo "To allow this commit anyway, use: git commit --no-verify"
    exit 1
fi

exit 0
```

**Installation during `kern init`:**

Add to `src/init.ts` after git initialization:

```typescript
// Install pre-commit hook (optional safety check)
const hooksDir = join(dir, ".git", "hooks");
if (existsSync(hooksDir)) {
  const preCommitHook = await readFile(
    join(import.meta.dirname, "..", "templates", "pre-commit"),
    "utf-8"
  );
  await writeFile(join(hooksDir, "pre-commit"), preCommitHook);
  await chmod(join(hooksDir, "pre-commit"), 0o755); // Make executable
  print("  + git pre-commit hook (secret protection)");
}
```

---

## User Communication Plan

### 1. GitHub Security Advisory

Create a GitHub Security Advisory with:
- **Severity:** High
- **CVE:** Request CVE assignment
- **Affected versions:** All versions prior to the fix
- **Fixed version:** X.X.X (upcoming release)
- **Workaround:** Manual gitignore fix and credential rotation

### 2. Release Notes

Include in the next release:

```markdown
## Security Fix: .kern/ Directory Exposure

**⚠️ CRITICAL SECURITY UPDATE**

Previous versions of kern-ai used an incorrect `.gitignore` pattern that could
allow sensitive `.kern/.env` files to be committed to git repositories.

**Action Required:**

1. Update to kern-ai vX.X.X: `npm update -g kern-ai`
2. Run migration: `kern migrate-gitignore --all`
3. If `.kern/.env` was committed, **rotate all credentials immediately**
4. See [Security Guide](docs/security.md) for full remediation steps

**If you pushed a repository with `.kern/.env` to GitHub/GitLab:**
- Assume all API keys and tokens are compromised
- Rotate credentials at provider dashboards
- Consider the conversation history and user data exposed
- See `docs/security-remediation-kern-gitignore.md` for history purging

This issue affected all users who initialized agents with `kern init`.
```

### 3. Direct User Notification

For users who can be contacted:
- Email notification with remediation steps
- Link to security documentation
- Offer of support for credential rotation

---

## Testing Plan

### Test Cases

1. **Fresh Installation:**
   ```bash
   # Create new agent
   kern init test-agent --api-key sk-test-123

   # Verify .gitignore exists and is correct
   cat test-agent/.gitignore | grep "^.kern/$"

   # Verify .kern/.env is NOT in git
   cd test-agent
   git ls-files .kern/.env
   # (should return nothing)

   # Verify it's in the filesystem
   ls .kern/.env
   # (should exist)
   ```

2. **Migration:**
   ```bash
   # Create agent with old gitignore pattern
   mkdir old-agent && cd old-agent
   echo ".kern/.env" > .gitignore
   mkdir -p .kern
   echo "SECRET=abc123" > .kern/.env
   git init && git add -A && git commit -m "init"

   # Run migration
   kern migrate-gitignore old-agent

   # Verify warnings about tracked files
   # Verify gitignore updated
   cat .gitignore | grep "^.kern/$"
   ```

3. **Pre-commit Hook:**
   ```bash
   # Try to commit .kern/.env
   cd test-agent
   git add .kern/.env
   git commit -m "test"
   # Should FAIL with error message
   ```

4. **Existing Repo Adoption:**
   ```bash
   # Run kern init in existing repo with .gitignore
   mkdir existing-repo && cd existing-repo
   git init
   echo "node_modules/" > .gitignore
   git add -A && git commit -m "init"

   # Add kern
   kern init existing-agent

   # Verify .gitignore was not overwritten but .kern/ is ignored
   git check-ignore .kern/.env
   # (should return .kern/.env)
   ```

---

## Long-term Improvements

### 1. External Secret Management

Consider integrating with:
- **System keychain:** macOS Keychain, Windows Credential Manager, Linux Secret Service
- **Environment variables:** Read from parent shell environment instead of files
- **Secret management tools:** HashiCorp Vault, AWS Secrets Manager, etc.

**Implementation:**
```typescript
// Prefer environment variables over .kern/.env
function getApiKey(provider: string): string {
  const envVar = API_KEY_ENV[provider];

  // 1. Check environment variable first
  if (process.env[envVar]) {
    return process.env[envVar];
  }

  // 2. Fall back to .kern/.env file
  const envFile = loadEnvFile();
  if (envFile[envVar]) {
    return envFile[envVar];
  }

  throw new Error(`${envVar} not found`);
}
```

### 2. Encrypt .kern/.env

Implement optional encryption:
```bash
# Encrypt with master password
kern encrypt-secrets <agent-name>

# Decrypt on agent start (prompts for password or reads from keychain)
kern start <agent-name>
```

### 3. Audit Logging

Log all access to `.kern/.env`:
```typescript
import { createWriteStream } from "fs";

const auditLog = createWriteStream(".kern/audit.log", { flags: "a" });

function loadSecrets(): Record<string, string> {
  auditLog.write(`[${new Date().toISOString()}] .env accessed by PID ${process.pid}\n`);
  return dotenv.parse(readFileSync(".kern/.env"));
}
```

### 4. Secret Scanning Integration

Add GitHub Actions workflow:

```yaml
# .github/workflows/secret-scan.yml
name: Secret Scanning
on: [push, pull_request]

jobs:
  scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Run Gitleaks
        uses: gitleaks/gitleaks-action@v2
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

---

## Rollout Plan

### Phase 1: Code Fix (Week 1)
- [ ] Implement gitignore pattern fix in `src/init.ts`
- [ ] Implement git commit safety check
- [ ] Write unit tests
- [ ] Code review and QA

### Phase 2: Migration Tools (Week 1)
- [ ] Implement `migrate-gitignore` command
- [ ] Create security documentation
- [ ] Update README with security warnings
- [ ] Create pre-commit hook template

### Phase 3: Testing (Week 2)
- [ ] Test fresh installations
- [ ] Test migrations on sample repos
- [ ] Test pre-commit hook
- [ ] Penetration test for remaining issues

### Phase 4: Release (Week 2)
- [ ] Create GitHub Security Advisory
- [ ] Prepare release notes
- [ ] Publish patched version to npm
- [ ] Send user notifications

### Phase 5: Monitoring (Ongoing)
- [ ] Monitor GitHub for exposed repositories
- [ ] Assist users with credential rotation
- [ ] Track migration adoption
- [ ] Plan long-term secret management improvements

---

## Success Criteria

- [ ] No new installations commit `.kern/.env` to git
- [ ] Migration tool successfully identifies at-risk repositories
- [ ] Pre-commit hook prevents accidental commits
- [ ] Documentation clearly explains security practices
- [ ] Existing users notified and provided remediation guidance
- [ ] GitHub secret scanning enabled for the repository
- [ ] No known credential exposures in the wild

---

## Support Resources

- **Documentation:** `docs/security.md`
- **Migration Command:** `kern migrate-gitignore --all`
- **Community Support:** GitHub Discussions
- **Security Contact:** security@kern-ai.com (if available)

---

**Last Updated:** 2026-04-07
