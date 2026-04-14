---
name: create-skill
description: Create a new skill following the AgentSkills format
---

# Create Skill

Create well-structured skill files for yourself or other agents.

## Skill format

A skill is a folder containing `SKILL.md` with optional supporting files:

```
my-skill/
├── SKILL.md          # Required: YAML frontmatter + instructions
├── scripts/          # Optional: executable scripts
├── references/       # Optional: docs, examples
└── assets/           # Optional: templates, data
```

## SKILL.md structure

```markdown
---
name: my-skill
description: One-line description of what this skill does
---

# Skill Title

Instructions the agent follows when this skill is activated.
Include context, steps, commands, and examples.
Reference files in this directory using the absolute path shown in the skill catalog.
```

## Guidelines

- **Name**: lowercase, hyphenated (e.g. `deploy-app`, `run-tests`)
- **Description**: one line, starts with a verb (e.g. "Deploy applications to production")
- **Body**: actionable instructions, not documentation. Write for an agent, not a human.
- **Scripts**: include executable scripts the agent can run via bash tool
- **References**: include docs the agent can read on demand — don't put everything in SKILL.md

## Where to create skills

- `skills/` in the agent's repo for agent-specific skills
- `.agents/skills/` for skills installed from registries

## Example

```markdown
---
name: check-health
description: Run health checks on all homelab services
---

# Check Health

Run health checks across all services and report status.

## Steps

1. Read the service list from `knowledge/services.md`
2. For each service, run the check script:
   ```bash
   bash scripts/check.sh <service-name>
   ```
3. Collect results and report summary
4. If any service is down, notify operator via message tool
```
